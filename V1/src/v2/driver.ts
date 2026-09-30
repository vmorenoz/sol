import { randomUUID } from "node:crypto";
import { z } from "zod";
import { SolCore } from "./core.js";
import { compileAssignmentContext } from "./context.js";
import { EnvironmentPreparationError, EvidenceRunner, fingerprint } from "./evidence.js";
import type { HostAdapter } from "./host.js";
import { HostCreationError, HostExecutionError } from "./host.js";
import { DeferredAcceptanceError, taskResultSchema, type AttemptRecord, type TaskSpec } from "./protocol.js";
import { WorkspaceManager, type WorkspaceRecord } from "./workspace.js";
import { captureProjectGit } from "./queries.js";

export interface ExecutionResult {
  planId: string;
  status: ReturnType<SolCore["getPlan"]>["status"];
  outcome: "completed" | "failed" | "refine" | "pending" | "cancelled";
  attempts: { attemptId: string; taskId: string; sessionId?: string; agent: string; role: TaskSpec["role"]; title: string; status: AttemptRecord["status"]; summary?: string | undefined; resultRef?: string; artifactRef?: string; integratedCheck?: IntegrationVerification }[];
  issues: string[];
}
export interface RunOptions { signal?: AbortSignal; onActivity?: (message: string) => void }
export type IntegrationVerification = Awaited<ReturnType<EvidenceRunner["verifyIntegration"]>>;
// Shared by driver instances, and held across asynchronous merged-tree checks.
const integrationQueues = new Map<string, Promise<void>>();
const active = (a: AttemptRecord) => ["leased", "running", "submitted"].includes(a.status);
const message = (error: unknown) => (error instanceof Error ? error.message : String(error)).slice(0, 1000);
const schema = z.toJSONSchema(taskResultSchema, { target: "draft-7" });

/** A timeout does not prove that an external operation stopped. Callers retain leases until abort is confirmed. */
function bounded<T>(operation: Promise<T>, ms = 10_000, signal?: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => finish(() => reject(new Error("Execution aborted")));
    const timer = setTimeout(() => finish(() => reject(new Error("Host operation timed out"))), Math.max(1, ms));
    const finish = (fn: () => void) => { clearTimeout(timer); signal?.removeEventListener("abort", abort); fn(); };
    operation.then(value => finish(() => resolve(value)), error => finish(() => reject(error)));
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
  });
}

export class ExecutionDriver {
  private readonly runs = new Map<string, Promise<ExecutionResult>>();
  private readonly controllers = new Map<string, AbortController>();
  private readonly cancellations = new Map<string, Promise<ExecutionResult>>();
  private readonly stopping = new Set<string>();
  private readonly notes = new Map<string, string[]>();
  private readonly integratedChecks = new Map<string, IntegrationVerification>();
  private readonly observers = new Map<string, Set<(message: string) => void>>();
  private readonly parents = new Map<string, string>();
  private readonly ownedAttempts = new Set<string>();
  private readonly sessions = new Map<string, string>();
  private readonly stoppedSessions = new Map<string, string>();
  private readonly notCreated = new Set<string>();
  private readonly creations = new Map<string, { planId: string; promise: Promise<void> }>();
  private readonly checks = new Map<Promise<unknown>, string>();
  private closing = false;
  private disposed = false;
  private shutdownPromise?: Promise<void>;

  constructor(private readonly core: SolCore, private readonly host: HostAdapter,
    private readonly workspaces: WorkspaceManager, private readonly evidence: EvidenceRunner) {}

  private note(planId: string, text: string): void {
    const notes = this.notes.get(planId) ?? [];
    if (!notes.includes(text)) notes.push(text.slice(0, 1500));
    this.notes.set(planId, notes.slice(-32));
  }
  activePlanIds(): string[] {
    return [...new Set([...this.runs.keys(), ...[...this.creations.values()].map(c => c.planId), ...this.checks.values()])];
  }
  private activity(a: AttemptRecord, state: string): void {
    if (this.disposed) return;
    const task = this.core.getPlan(a.planId).draft.tasks.find(t => t.id === a.taskId)!;
    const sessionId = a.sessionId ?? this.sessions.get(a.id);
    const text = `${state}: task ${a.taskId}, attempt ${a.id}, plan ${a.planId}, agent sol-${task.role}, title ${task.title}${sessionId ? `, session ${sessionId}` : ""}`;
    for (const observer of this.observers.get(a.planId) ?? []) {
      try { observer(text); } catch { /* Observers cannot break execution. */ }
    }
    const parentSessionId = this.parents.get(a.planId);
    if (!parentSessionId) return;
    void bounded(Promise.resolve().then(() => this.host.activity({ parentSessionId,
      planId: a.planId, taskId: a.taskId, ...(sessionId ? { sessionId } : {}), agent: `sol-${task.role}`, role: task.role, title: task.title, state, message: text }))).catch(() => {});
  }
  private workspace(a: AttemptRecord): WorkspaceRecord {
    const record = this.workspaces.list().find(w => w.directory === a.workspacePath);
    if (!record || record.baseSnapshotId !== a.snapshotId) throw new Error("Missing owned workspace checkpoint");
    return record;
  }
  private result(planId: string): ExecutionResult {
    const plan = this.core.getPlan(planId);
    const records = this.workspaces.list();
    const issues = this.notes.get(planId) ?? [];
    return { planId, status: plan.status,
      outcome: plan.status === "succeeded" ? "completed" : plan.status === "cancelled" ? "cancelled" :
        plan.status === "failed" ? "failed" : issues.length ? "refine" : "pending",
      attempts: this.core.listAttempts(planId).map(a => ({ attemptId: a.id, taskId: a.taskId, status: a.status,
        ...(a.sessionId ?? this.sessions.get(a.id) ? { sessionId: (a.sessionId ?? this.sessions.get(a.id))! } : {}),
        agent: `sol-${plan.draft.tasks.find(t => t.id === a.taskId)!.role}`,
        role: plan.draft.tasks.find(t => t.id === a.taskId)!.role,
        title: plan.draft.tasks.find(t => t.id === a.taskId)!.title,
        summary: (a.reason ?? a.result?.summary)?.slice(0, 1000),
        ...(a.result ? { resultRef: a.id } : {}),
        ...(this.integratedChecks.has(a.id) ? { integratedCheck: this.integratedChecks.get(a.id)! } : {}),
        ...(records.find(w => w.directory === a.workspacePath)?.artifactPath ?
          { artifactRef: records.find(w => w.directory === a.workspacePath)!.artifactPath } : {}) })), issues };
  }
  private cleanup(a: AttemptRecord): void {
    if (this.core.isInspection(a.planId)) return;
    try {
      const w = this.workspace(a);
      if (w.state === "cleaned") return;
      this.workspaces.cleanup(w.id, this.core.getPlan(a.planId).draft.tasks.find(task => task.id === a.taskId)?.environment?.generatedOutputs);
    } catch (error) { this.note(a.planId, `Checkpoint retained for ${a.id}: ${message(error)}`); }
  }
  private fail(a: AttemptRecord, reason: string, retry: boolean): void {
    if (!active(this.core.getAttempt(a.id)) || this.stopping.has(a.planId)) return;
    this.core.failAttempt(a.id, reason.slice(0, 1000), retry);
    this.activity(a, "failed");
    if (this.core.isInspection(a.planId)) return;
    // Once applied, main is the checkpoint. Archive the obsolete isolated tree
    // even when core grants a corrective attempt; never replay it onto main.
    if (this.workspaces.integrated(this.workspace(a).id) ||
      this.core.getPlan(a.planId).tasks.find(t => t.id === a.taskId)?.status !== "queued") this.cleanup(a);
  }

  private deferred(a: AttemptRecord): boolean {
    return this.core.getPlan(a.planId).status === "paused" ||
      this.core.pendingQuestions(a.planId).some(q => q.material && (!q.taskIds.length || q.taskIds.includes(a.taskId)));
  }

  private finish(a: AttemptRecord, raw: unknown): Promise<void> {
    if (this.core.isInspection(a.planId)) {
      if (this.disposed || this.stopping.has(a.planId)) return Promise.resolve();
      return this.finishExclusive(this.core.getAttempt(a.id), raw);
    }
    const root = this.core.projectRoot;
    const previous = integrationQueues.get(root) ?? Promise.resolve();
    const next = previous.then(() => {
      if (this.disposed || this.stopping.has(a.planId)) return;
      return this.finishExclusive(this.core.getAttempt(a.id), raw);
    });
    const tail = next.catch(() => {});
    integrationQueues.set(root, tail);
    void tail.then(() => { if (integrationQueues.get(root) === tail) integrationQueues.delete(root); });
    return bounded(next, 86_400_000, this.controllers.get(a.planId)?.signal);
  }

  private async verifyMerged(a: AttemptRecord): Promise<boolean> {
    if (!this.evidence.verifyIntegration) throw new Error("EvidenceRunner.verifyIntegration(attemptId, directory) is required for merged-tree checks");
    const before = fingerprint(this.core.projectRoot);
    const validation = this.workspaces.prepare(randomUUID());
    const controller = new AbortController();
    const signal = this.controllers.get(a.planId)?.signal;
    const abort = () => controller.abort();
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
    let settled = false;
    const checking = Promise.resolve().then(() => this.evidence.verifyIntegration(a.id, validation.directory, { signal: controller.signal }));
    // A timed-out external runner may still be writing its isolated directory.
    const tracked = checking.finally(() => { settled = true; });
    this.checks.set(tracked, a.planId);
    void tracked.then(() => this.checks.delete(tracked), () => this.checks.delete(tracked));
    try {
      const task = this.core.assignment(a.id).task;
      const checks = task.checks;
      const remaining = this.core.getPlan(a.planId).draft.budgets.maxDurationMs - this.core.runningDurationMs(a.planId);
      const timeout = Math.min(remaining, checks.reduce((ms, check) => ms + (check.timeoutMs ?? 120_000), 10_000 + (task.environment?.prepare ? task.environment.prepare.timeoutMs ?? 120_000 : 0)));
      const result = await bounded(tracked, timeout, signal);
      const compact = { passed: result.passed === true, summary: result.summary.slice(0, 1000), artifactPath: result.artifactPath };
      this.integratedChecks.set(a.id, compact);
      if (!compact.passed) { this.note(a.planId, `${a.id}: merged verification failed: ${compact.summary}`); return false; }
      this.workspaces.capture(validation.id, [], task.environment?.generatedOutputs ?? []);
      if (fingerprint(this.core.projectRoot) !== before) throw new Error("Merged project changed during integration verification; revalidation required");
      return true;
    } finally {
      controller.abort();
      signal?.removeEventListener("abort", abort);
      const cleanup = () => {
        if (this.disposed) return;
        try { this.workspaces.cleanup(validation.id, this.core.getPlan(a.planId).draft.tasks.find(task => task.id === a.taskId)?.environment?.generatedOutputs); }
        catch (error) { this.note(a.planId, `Validation workspace retained: ${message(error)}`); }
      };
      if (settled) cleanup(); else void tracked.then(cleanup, cleanup);
    }
  }

  private async finishExclusive(a: AttemptRecord, raw: unknown): Promise<void> {
    if (!active(this.core.getAttempt(a.id)) || this.stopping.has(a.planId)) return;
    const inspection = this.core.isInspection(a.planId);
    const checkpoint = inspection ? undefined : this.workspace(a);
    if (checkpoint && (checkpoint.state === "integrating" || checkpoint.state === "cleaned")) {
      this.note(a.planId, `Attempt ${a.id}: workspace is ${checkpoint.state}; ${checkpoint.state === "cleaned" ? "current worker proof unavailable" : "integration journal recovery required"}; submission retained.`);
      return;
    }
    let stage = "environment";
    try {
      this.evidence.assertEnvironment(a.id);
      stage = "schema";
      const result = taskResultSchema.parse(raw);
      stage = "submission";
      if (a.status !== "submitted") this.core.submitResult(a.id, result);
      if (this.deferred(a)) return;
      if (result.outcome !== "completed") {
        this.fail(a, `${result.outcome}: ${result.summary}`, result.blockers.length > 0 && result.blockers.every(b => b.kind === "technical"));
        return;
      }
      stage = "proof";
      this.evidence.verifyCurrent(a.id);
      stage = "acceptance";
      this.core.validateAcceptance(a.id);
      if (inspection) {
        stage = "accept";
        this.core.acceptAttempt(a.id);
        this.activity(a, "completed");
        return;
      }
      const task = this.core.assignment(a.id).task;
      const w = this.workspace(a);
      let integration = this.workspaces.integrated(w.id);
      if (!integration) {
        stage = "capture";
        this.workspaces.capture(w.id, task.writes, task.environment?.generatedOutputs ?? []);
        stage = "integration";
        integration = task.writes.length ? this.workspaces.integrate(w.id) : undefined;
      }
      stage = "merged verification";
      if (integration && !this.workspaces.integrationMatches(w.id)) throw new Error("Persisted integration no longer matches main; corrective attempt must preserve current main");
      if (task.checks.length && !await this.verifyMerged(a)) {
        throw new Error(`merged verification failed: ${this.integratedChecks.get(a.id)?.summary ?? "Merged gate did not pass"}`);
      }
      if (this.disposed || this.stopping.has(a.planId) || !active(this.core.getAttempt(a.id)) || this.deferred(a)) return;
      this.evidence.verifyCurrent(a.id);
      this.core.validateAcceptance(a.id);
      if (integration && !this.workspaces.integrationMatches(w.id)) throw new Error("Persisted integration no longer matches main; corrective attempt must preserve current main");
      stage = "accept";
      this.core.acceptAttempt(a.id, integration ? { integratedSnapshotId: integration.snapshotId } : {});
      this.activity(a, "completed");
      this.cleanup(a);
    } catch (error) {
      if (this.disposed || this.stopping.has(a.planId)) return;
      if (error instanceof DeferredAcceptanceError || this.deferred(a)) return;
      const reason = `${stage}: ${stage === "schema" ? "Invalid task result schema" : message(error)}`;
      this.note(a.planId, `${a.id}: ${reason}`);
      if (inspection) {
        this.fail(a, reason, stage === "schema");
        return;
      }
      // An apply may already be durable even when its response/acceptance failed.
      const state = this.workspace(a).state;
      if (stage === "merged verification" && state !== "integrating") {
        // The worker has ended. Core bounds correction by task/revision budget.
        // Applied progress stays on main; no rollback, and no stranded submission.
        this.fail(a, reason, !(error instanceof EnvironmentPreparationError));
        return;
      }
      if (stage === "accept" || state === "integrated" || state === "integrating") return;
      this.fail(a, reason, stage === "schema" || (stage === "proof" && /Stale check/.test(message(error))));
    }
  }

  run(planId: string, parentSessionId: string, options: RunOptions = {}): Promise<ExecutionResult> {
    return this.launch(planId, parentSessionId, options, false);
  }
  private launch(planId: string, parent: string, options: RunOptions, recovery: boolean): Promise<ExecutionResult> {
    if (this.closing) return Promise.reject(new Error("Execution driver is shutting down"));
    let operation = this.runs.get(planId);
    if (!operation) {
      const controller = new AbortController();
      this.controllers.set(planId, controller);
      this.parents.set(planId, parent);
      // Register ownership and cancellation before invoking any external operation.
      operation = Promise.resolve().then(async () => {
        if (recovery && !controller.signal.aborted) await this.reconcile(planId, controller.signal);
        return this.schedule(planId, parent, controller.signal, options);
      }).finally(() => {
        this.runs.delete(planId); this.controllers.delete(planId);
        this.observers.delete(planId); this.parents.delete(planId);
      });
      this.runs.set(planId, operation);
    }
    const observers = this.observers.get(planId) ?? new Set();
    if (options.onActivity) observers.add(options.onActivity);
    this.observers.set(planId, observers);
    const abort = () => { void this.cancel(planId).catch(error => { if (!this.disposed) this.note(planId, message(error)); }); };
    options.signal?.addEventListener("abort", abort, { once: true });
    if (options.signal?.aborted) abort();
    return operation.finally(() => {
      options.signal?.removeEventListener("abort", abort);
      if (options.onActivity) observers.delete(options.onActivity);
    });
  }
  private async schedule(planId: string, parent: string, signal: AbortSignal, options: RunOptions): Promise<ExecutionResult> {
    const pending = new Set<Promise<void>>();
    const skipped = new Set<string>();
    while (!signal.aborted && !this.stopping.has(planId)) {
      for (const task of this.core.readyTasks(planId)) {
        if (skipped.has(task.id) || signal.aborted || this.stopping.has(planId)) continue;
        // readyTasks is a snapshot; recheck capacity after each lease.
        if (!this.core.readyTasks(planId).some(t => t.id === task.id)) continue;
        let w: WorkspaceRecord | undefined;
        let a: AttemptRecord;
        try {
          if (this.core.isInspection(planId)) {
            a = this.core.leaseAttempt(planId, task.id, { workspacePath: this.core.projectRoot, snapshotId: `inspection:${planId}`, isolated: false });
          } else {
          const previous = this.core.listAttempts(planId).findLast(old => old.taskId === task.id && old.revision === this.core.getPlan(planId).revision);
          const priorWorkspace = previous ? this.workspace(previous) : undefined;
          const applied = priorWorkspace && this.workspaces.integrated(priorWorkspace.id);
          w = !priorWorkspace || applied ? this.workspaces.prepare(randomUUID()) : priorWorkspace;
          if (!["ready", "captured"].includes(w.state)) throw new Error("Retry checkpoint unavailable; refine task instead of restarting from zero");
          a = this.core.leaseAttempt(planId, task.id, { workspacePath: w.directory, snapshotId: w.baseSnapshotId, isolated: true });
          }
          this.ownedAttempts.add(a.id);
        } catch (error) {
          skipped.add(task.id);
          if (!/Resource reserved|Path reservation conflict|not ready or budget exhausted/.test(message(error))) this.note(planId, `${task.id}: ${message(error)}`);
          // Unleased fresh workspaces have no worker and can be safely captured/removed.
          if (w && !this.core.listAttempts(planId).some(old => old.workspacePath === w!.directory)) {
            try { this.workspaces.capture(w.id, []); this.workspaces.cleanup(w.id); } catch (failure) { this.note(planId, message(failure)); }
          }
          continue;
        }
        const job = this.execute(a, task, parent, signal, options).catch(error => this.note(planId, `${a.id}: ${message(error)}`));
        pending.add(job);
        void job.finally(() => pending.delete(job));
      }
      if (!pending.size) break; // Reservations held by another driver require an explicit later run.
      await Promise.race(pending);
      skipped.clear();
    }
    await Promise.all(pending);
    const cancellation = this.cancellations.get(planId);
    if (cancellation) await cancellation;
    if (this.disposed) throw new Error("Execution driver is shut down");
    return this.result(planId);
  }
  private async execute(a: AttemptRecord, task: TaskSpec, parent: string, signal: AbortSignal, options: RunOptions): Promise<void> {
    this.notCreated.add(a.id);
    const prior = this.core.listAttempts(a.planId).filter(old => old.taskId === a.taskId && old.revision === a.revision && old.id !== a.id);
    let session: string | undefined;
    let creating = false;
    try {
      // Resolve the assignment before charging for a host session.
      const context = compileAssignmentContext(this.core, a.id);
      const inspection = this.core.isInspection(a.planId);
      const provenance = { projectRoot: this.core.projectRoot, workspacePath: a.workspacePath,
        workspaceGitIsProjectState: false, originalGit: captureProjectGit(this.core.projectRoot) };
      if (prior.length) await bounded(new Promise(resolve => setTimeout(resolve, Math.min(100 * 2 ** (prior.length - 1), 2000))), 3000, signal);
      if (signal.aborted) return;
      this.notCreated.delete(a.id);
      creating = true;
      let abandoned = false;
      const creation = Promise.resolve().then(() => this.host.createSession({ parentSessionId: parent, agent: `sol-${task.role}`, directory: a.workspacePath,
        ...(inspection ? { readOnly: true } : {}),
        title: task.title, metadata: { sol: { version: 2, projectRoot: this.core.projectRoot, planId: a.planId, taskId: a.taskId, attemptId: a.id } } }));
      const observed = creation.then(async id => {
        this.sessions.set(a.id, id);
        if (abandoned || signal.aborted || this.closing || this.stopping.has(a.planId)) await this.retireLateSession(a, id);
      }).catch(async error => {
        if (this.disposed) return;
        if (error instanceof HostCreationError && error.created === "no") {
          this.notCreated.add(a.id);
          if (this.stopping.has(a.planId)) {
            await this.cancellations.get(a.planId);
            if (!this.disposed) await this.cancelInternal(a.planId, this.closing);
          } else this.fail(a, message(error), error.retryable);
        } else this.note(a.planId, `Session creation reconciliation: ${message(error)}`);
      });
      this.creations.set(a.id, { planId: a.planId, promise: observed });
      void observed.then(() => this.creations.delete(a.id));
      try { session = await bounded(creation, 10_000, signal); }
      catch (error) { abandoned = true; throw error; }
      creating = false;
      if (signal.aborted || this.closing || this.stopping.has(a.planId)) return;
      this.core.startAttempt(a.id, session); // Persist child-session binding before any prompt/tools.
      const prompt = JSON.stringify(context) + "\n" +
        JSON.stringify(provenance) + "\n" +
        "originalGit facts are original-project provenance. Do not report temporary worktree branch, index or caches as the user's Git state. A detached worker does not mean the user's branch is detached.\n" +
        (inspection ? "Read-only inspection in the original project. Use only read, glob, grep, sol_observe and StructuredOutput. Observe actual files with sol_observe and cite evidence IDs. Do not edit, execute shell commands, prepare environments, run checks or auto-discover/run test suites. Return the taskResultSchema structured result.\n" :
          "Return the taskResultSchema structured result. Use native tools, sol_assignment, sol_check and sol_observe. Produce named checks with sol_check against final files; cite evidence IDs. Do not commit.\n") +
        JSON.stringify({ previousAttempts: prior.map(old => ({ attemptId: old.id, resultRef: old.result ? old.id : undefined,
          failure: old.reason, summary: [old.reason, old.result?.summary].filter(Boolean).join("; ").slice(0, 1000) })),
          checkpoint: inspection ? "Observe current original-project files and refresh evidence for this attempt." : "Previous implementation is preserved. After a durable integration, this is a fresh snapshot of effective main including integrated progress and user edits. Correct the prior failure within your write scopes; refresh evidence for this attempt." });
      this.activity(a, "started");
      const remaining = this.core.getPlan(a.planId).draft.budgets.maxDurationMs - this.core.runningDurationMs(a.planId);
      const raw = await bounded(this.host.prompt({ sessionId: session, agent: `sol-${task.role}`, directory: a.workspacePath, prompt, schema, signal }), remaining, signal);
      await this.finish(this.core.getAttempt(a.id), raw);
    } catch (error) {
      if (this.disposed) return;
      if (this.stopping.has(a.planId)) return;
      if (creating && !session) {
        if (error instanceof HostCreationError && error.created === "no") {
          this.notCreated.add(a.id); this.fail(a, message(error), error.retryable);
        } else this.note(a.planId, `${a.id}: session creation uncertain; lease retained for host reconciliation`);
        return;
      }
      if (session) {
        try { await bounded(this.host.abort(session, a.workspacePath)); this.stoppedSessions.set(a.id, session); }
        catch (failure) { this.note(a.planId, `${a.id}: abort unconfirmed; reservation retained: ${message(failure)}`); return; }
      }
      this.fail(a, message(error), !session || error instanceof EnvironmentPreparationError ? false : error instanceof HostExecutionError ? error.retryable :
        /timeout|timed out|temporary|transient|ECONN|EAI_AGAIN|fetch failed|429|503/i.test(message(error)));
    }
  }

  private async retireLateSession(a: AttemptRecord, sessionId: string): Promise<void> {
    if (!this.disposed) {
      const current = this.core.getAttempt(a.id);
      if (current.status === "leased" && this.core.getPlan(a.planId).status === "active") {
        try { this.core.startAttempt(a.id, sessionId); }
        catch { /* Paused/budget exhausted: tracked session identity still permits confirmed abort. */ }
      }
    }
    try { await bounded(this.host.abort(sessionId, a.workspacePath)); }
    catch (error) { if (!this.disposed) this.note(a.planId, `${a.id}: late session abort unconfirmed; reservation retained`); return; }
    if (this.disposed) return;
    this.stoppedSessions.set(a.id, sessionId);
    this.activity(a, "recovered late session; stopped");
    if (this.stopping.has(a.planId)) {
      // A prior cancellation may have observed the lease before this identity existed.
      const cancelling = this.cancellations.get(a.planId);
      if (cancelling) await cancelling;
      if (!this.disposed) await this.cancelInternal(a.planId, this.closing);
    } else if (active(this.core.getAttempt(a.id))) this.fail(a, "Session creation timed out; late session confirmed stopped", true);
  }

  recover(planId: string, parentSessionId: string, options: RunOptions = {}): Promise<ExecutionResult> {
    return this.launch(planId, parentSessionId, options, true);
  }
  private async reconcile(planId: string, signal: AbortSignal): Promise<void> {
    const journal = this.core.isInspection(planId) ? { conflicts: [] } : this.workspaces.recover();
    for (const conflict of journal.conflicts) this.note(planId, `Integration recovery conflict: ${conflict}`);
    for (const a of this.core.listAttempts(planId, true)) {
      if (signal.aborted || this.disposed) break;
      if (!a.sessionId) { this.note(planId, `${a.id}: leased without session; creation is uncertain, safe host proof required`); continue; }
      try {
        const status = await bounded(this.host.status(a.sessionId, a.workspacePath), 10_000, signal);
        if (signal.aborted || this.disposed) break;
        if (status === "running" || status === "unknown") { this.note(planId, `${a.id}: host ${status}; reservation retained`); continue; }
        this.ownedAttempts.add(a.id);
        this.activity(a, "recovered");
        if (a.status === "submitted") { await this.finish(a, a.result); continue; }
        if (status === "missing") {
          // Restrict the core's project-wide reconciliation callback to this exact session.
          this.core.recoverAttempts(id => { if (id === a.sessionId) return false; throw new Error("Not probed"); });
          if (this.core.getPlan(planId).tasks.find(t => t.id === a.taskId)?.status !== "queued") this.cleanup(a);
          continue;
        }
        const raw = await bounded(this.host.lastResult(a.sessionId, a.workspacePath), 10_000, signal);
        if (signal.aborted || this.disposed) break;
        if (raw !== undefined) await this.finish(a, raw);
        else this.fail(a, "Host confirmed idle without structured result", true);
      } catch (error) { if (!signal.aborted && !this.disposed) this.note(planId, `${a.id}: ${message(error)}`); }
    }
  }

  cancel(planId: string): Promise<ExecutionResult> {
    return this.cancelInternal(planId, false);
  }
  private cancelInternal(planId: string, ownedOnly: boolean): Promise<ExecutionResult> {
    if (this.disposed) return Promise.reject(new Error("Execution driver is shut down"));
    const existing = this.cancellations.get(planId);
    if (existing) return existing;
    this.stopping.add(planId);
    this.controllers.get(planId)?.abort();
    const operation = this.cancelOwned(planId, ownedOnly).finally(() => { this.cancellations.delete(planId); });
    this.cancellations.set(planId, operation);
    return operation;
  }
  private async cancelOwned(planId: string, ownedOnly: boolean): Promise<ExecutionResult> {
    const attempts = this.core.listAttempts(planId, true);
    const confirmed = await Promise.all(attempts.map(async a => {
      if (ownedOnly && !this.ownedAttempts.has(a.id)) return false;
      if (this.notCreated.has(a.id)) return true;
      const session = a.sessionId ?? this.sessions.get(a.id);
      if (!session) { this.note(planId, `${a.id}: no session identity; cancellation uncertain, reservation retained`); return false; }
      if (this.stoppedSessions.get(a.id) === session) return true;
      try { await bounded(this.host.abort(session, a.workspacePath)); this.stoppedSessions.set(a.id, session); return true; }
      catch (error) { this.note(planId, `${a.id}: abort unconfirmed; reservation retained: ${message(error)}`); return false; }
    }));
    if (this.disposed) throw new Error("Execution driver is shut down");
    if (confirmed.every(Boolean) && this.core.getPlan(planId).status !== "succeeded") {
      if (this.core.listAttempts(planId, true).some(a => !attempts.some(confirmed => confirmed.id === a.id))) {
        this.note(planId, "New attempt appeared during cancellation; reservation retained until its host abort is confirmed");
        return this.result(planId);
      }
      this.core.cancelPlan(planId, { workersStopped: true });
      for (const a of attempts) { this.activity(a, "cancelled"); this.cleanup(a); }
    }
    return this.result(planId);
  }

  shutdown(): Promise<void> {
    if (this.shutdownPromise) return this.shutdownPromise;
    this.closing = true;
    this.shutdownPromise = (async () => {
      const plans = this.activePlanIds();
      const cancellations = plans.map(id => this.cancelInternal(id, true));
      const drain = async () => {
        await Promise.allSettled(cancellations);
        await Promise.allSettled([...this.runs.values(), ...[...this.creations.values()].map(c => c.promise), ...this.checks.keys()]);
      };
      try { await bounded(drain(), 10_000); }
      catch { /* Unresolved external creation is uncertain; late callbacks only abort the host after disposal. */ }
      this.disposed = true;
      // EvidenceRunner owns its asynchronous store accesses; callers must retain
      // the core if an uncooperative verifier has not settled after cancellation.
      if (this.checks.size) throw new Error("Shutdown incomplete: integration checks still settling; retain core until activePlanIds() is empty");
    })();
    return this.shutdownPromise;
  }
}
