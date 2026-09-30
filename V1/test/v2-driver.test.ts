import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SolCore, planTemplates, type TaskSpec, type TaskResult } from "../src/v2/core.js";
import { ExecutionDriver } from "../src/v2/driver.js";
import { EvidenceRunner } from "../src/v2/evidence.js";
import type { HostAdapter } from "../src/v2/host.js";
import { HostCreationError } from "../src/v2/host.js";
import { WorkspaceManager } from "../src/v2/workspace.js";

const cleanups: (() => void)[] = [];
afterEach(() => { vi.useRealTimers(); cleanups.splice(0).reverse().forEach(fn => fn()); });
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
class FakeHost implements HostAdapter {
  sessions = new Map<string, Parameters<HostAdapter["createSession"]>[0]>();
  states = new Map<string, "running" | "idle" | "missing" | "unknown">();
  results = new Map<string, unknown>();
  abortFails = false;
  work: (input: Parameters<HostAdapter["prompt"]>[0]) => Promise<unknown> = async () => undefined;
  async createSession(input: Parameters<HostAdapter["createSession"]>[0]) {
    const id = `session-${this.sessions.size}`; this.sessions.set(id, input); this.states.set(id, "idle"); return id;
  }
  async prompt(input: Parameters<HostAdapter["prompt"]>[0]) {
    this.states.set(input.sessionId, "running");
    const result = await this.work(input);
    this.results.set(input.sessionId, result); this.states.set(input.sessionId, "idle"); return result;
  }
  async abort(id: string) { if (this.abortFails) throw new Error("host unavailable"); this.states.set(id, "idle"); }
  async status(id: string) { return this.states.get(id) ?? "missing"; }
  async lastResult(id: string) { return this.results.get(id); }
  async activity() {}
}
function setup(count = 1, attempts = 2) {
  const base = realpathSync(mkdtempSync(join(tmpdir(), "driver-"))), root = join(base, "project"); mkdirSync(root);
  writeFileSync(join(root, "fixture-source"), "Actual fixture source");
  const core = new SolCore(root, ":memory:");
  cleanups.push(() => { core.close(); rmSync(base, { recursive: true, force: true }); });
  const workspaces = new WorkspaceManager(root, join(base, "workspaces"));
  const evidence = new EvidenceRunner(core, join(base, "evidence"));
  const host = new FakeHost();
  const driver = new ExecutionDriver(core, host, workspaces, evidence);
  const draft = planTemplates.standard();
  draft.tasks = Array.from({ length: count }, (_, i): TaskSpec => ({ ...draft.tasks[0]!, id: `task${i}`, reads: ["**"], writes: [`file${i}`] }));
  draft.budgets = { maxAttempts: attempts, maxParallel: 4, maxDurationMs: 10_000 };
  const complete = (session: string): TaskResult => {
    const a = core.getAttemptForSession(session)!;
    const proof = evidence.observe(a.id, "fixture-source", "Inspected fixture source");
    return { schemaVersion: 2, outcome: "completed", summary: "Done", criteria: [{ id: "done", status: "satisfied", evidenceRefs: [proof.id] }], findings: [], blockers: [], artifacts: [] };
  };
  return { root, core, workspaces, evidence, host, driver, draft, complete };
}

describe("ExecutionDriver", () => {
  function inspection() {
    const s = setup();
    const operation = s.core.createOperation({ objective: "Inspect actual sources" }, "parent");
    const workspaceCalls = ["prepare", "capture", "integrate", "cleanup", "recover"].map(method =>
      vi.spyOn(s.workspaces, method as "prepare").mockImplementation(() => { throw new Error(`Inspection called ${method}`); }));
    return { ...s, operation, workspaceCalls };
  }

  it("inspects the named original Git root with actual file evidence and no workspace or checks", async () => {
    const s = inspection();
    execFileSync("git", ["init", "-b", "inspection-source", s.root], { stdio: "ignore" });
    const prepare = vi.spyOn(s.evidence, "prepare"), checks = vi.spyOn(s.evidence, "run");
    const activities: string[] = [];
    s.host.work = async input => {
      expect(input.directory).toBe(s.root);
      expect(s.host.sessions.get(input.sessionId)?.readOnly).toBe(true);
      const packet = JSON.parse(input.prompt.split("\n")[1]!);
      expect(packet).toMatchObject({ projectRoot: s.root, workspacePath: s.root, workspaceGitIsProjectState: false,
        originalGit: { branch: "inspection-source", detached: false } });
      const a = s.core.getAttemptForSession(input.sessionId)!;
      expect(a.snapshotId).toBe(`inspection:${s.operation.id}`);
      expect(s.core.assignment(a.id).task).toMatchObject({ reads: ["**"], writes: [], checks: [] });
      await expect(s.evidence.run(a.id, "invented")).rejects.toThrow();
      checks.mockClear();
      return s.complete(input.sessionId);
    };
    const result = await s.driver.run(s.operation.id, "parent", { onActivity: text => activities.push(text) });
    expect(result.outcome).toBe("completed");
    expect(result.attempts[0]).toMatchObject({ sessionId: "session-0", agent: "sol-executor", role: "executor", title: "Inspect actual sources" });
    const proof = s.core.listEvidence(result.attempts[0]!.attemptId)[0]!;
    expect(s.evidence.readObservation(proof).sourceHash).toBeTruthy();
    expect(activities.some(text => text.startsWith("completed:") && text.includes("session-0"))).toBe(true);
    expect(prepare).not.toHaveBeenCalled(); expect(checks).not.toHaveBeenCalled();
    s.workspaceCalls.forEach(spy => expect(spy).not.toHaveBeenCalled());
    expect(readFileSync(join(s.root, "fixture-source"), "utf8")).toBe("Actual fixture source");
  });

  it.each(["invalid", "failure", "cancel", "retry", "stale"])("preserves inspection root through %s", async mode => {
    const s = inspection(), entered = deferred<void>(); let calls = 0;
    s.host.work = async input => {
      calls++;
      if (mode === "cancel") { entered.resolve(); return new Promise(() => {}); }
      if (mode === "invalid") return {};
      if (mode === "failure") throw new Error("failed");
      if (mode === "retry" && calls === 1) throw new Error("temporary host failure");
      const result = s.complete(input.sessionId);
      if (mode === "stale") writeFileSync(join(s.root, "fixture-source"), "user edit");
      return result;
    };
    const running = s.driver.run(s.operation.id, "parent");
    if (mode === "cancel") { await entered.promise; await s.driver.cancel(s.operation.id); }
    const result = await running;
    expect(result.outcome).toBe(mode === "cancel" ? "cancelled" : mode === "retry" ? "completed" : "failed");
    s.workspaceCalls.forEach(spy => expect(spy).not.toHaveBeenCalled());
    expect(readFileSync(join(s.root, "fixture-source"), "utf8")).toBe(mode === "stale" ? "user edit" : "Actual fixture source");
  });

  it.each(["submitted", "missing", "idle"])("recovers a root inspection with %s session state", async state => {
    const s = inspection();
    const a = s.core.leaseAttempt(s.operation.id, s.operation.taskId, { workspacePath: s.root, snapshotId: `inspection:${s.operation.id}`, isolated: false });
    s.core.startAttempt(a.id, "old"); s.host.states.set("old", state === "missing" ? "missing" : "idle");
    if (state === "submitted") s.core.submitResult(a.id, s.complete("old"));
    s.host.work = async input => s.complete(input.sessionId);
    expect((await s.driver.recover(s.operation.id, "parent")).outcome).toBe("completed");
    s.workspaceCalls.forEach(spy => expect(spy).not.toHaveBeenCalled());
    expect(existsSync(join(s.root, "fixture-source"))).toBe(true);
  });

  it("retries a rejected inspection session creation without a workspace checkpoint", async () => {
    const s = inspection();
    vi.spyOn(s.host, "createSession").mockRejectedValueOnce(new HostCreationError("HTTP 429", "no", true));
    s.host.work = async input => s.complete(input.sessionId);
    const result = await s.driver.run(s.operation.id, "parent");
    expect(result.outcome).toBe("completed"); expect(result.attempts).toHaveLength(2);
    s.workspaceCalls.forEach(spy => expect(spy).not.toHaveBeenCalled());
  });

  it("cancels a late-created inspection child and preserves the source root", async () => {
    const s = inspection(), creation = deferred<string>(), entered = deferred<void>();
    s.host.createSession = () => { entered.resolve(); return creation.promise; };
    const abort = vi.spyOn(s.host, "abort"), prompt = vi.spyOn(s.host, "prompt");
    const run = s.driver.run(s.operation.id, "parent"); await entered.promise;
    await s.driver.cancel(s.operation.id); await run;
    creation.resolve("late-inspector");
    await vi.waitFor(() => expect(s.core.getOperation(s.operation.id).status).toBe("cancelled"));
    expect(abort).toHaveBeenCalledWith("late-inspector", s.root); expect(prompt).not.toHaveBeenCalled();
    s.workspaceCalls.forEach(spy => expect(spy).not.toHaveBeenCalled());
    expect(readFileSync(join(s.root, "fixture-source"), "utf8")).toBe("Actual fixture source");
  });

  it.each(["change", "verify"] as const)("keeps %s operations isolated with original Git provenance", async mode => {
    const s = setup();
    execFileSync("git", ["init", "-b", "original-branch", s.root], { stdio: "ignore" });
    const operation = s.core.createOperation({ objective: "Scoped work", mode, writes: mode === "change" ? ["file0"] : [],
      checks: mode === "verify" ? [{ id: "check", command: "true" }] : [] }, "parent");
    s.host.work = async input => {
      expect(input.directory).not.toBe(s.root);
      expect(JSON.parse(input.prompt.split("\n")[1]!)).toMatchObject({ projectRoot: s.root, workspacePath: input.directory,
        workspaceGitIsProjectState: false, originalGit: { branch: "original-branch", detached: false } });
      const result = s.complete(input.sessionId);
      if (mode === "verify") result.criteria[0]!.evidenceRefs.push((await s.evidence.run(s.core.getAttemptForSession(input.sessionId)!.id, "check")).id);
      return result;
    };
    expect((await s.driver.run(operation.id, "parent")).outcome).toBe("completed");
    expect(s.workspaces.list().length).toBeGreaterThan(0);
  });
  it("prepares independent local dependencies and discards declared build outputs in worker and merged validation", async () => {
    const s = setup();
    const node = (script: string) => `${JSON.stringify(process.execPath)} -e '${script}'`;
    writeFileSync(join(s.root, "package.lock"), "fixture-v1");
    writeFileSync(join(s.root, "runner.spec"), 'const fs=require("fs"); if(fs.readFileSync("package.lock","utf8")!=="fixture-v1")process.exit(1); fs.mkdirSync("dist",{recursive:true}); fs.writeFileSync("dist/output.js","compiled");');
    s.draft.tasks[0]!.environment = { generatedOutputs: ["dist/**"], prepare: { command: node('const fs=require("fs"); fs.mkdirSync("node_modules/test-runner",{recursive:true}); fs.writeFileSync("node_modules/test-runner/index.js",fs.readFileSync("runner.spec")); console.log(process.cwd());') } };
    s.draft.tasks[0]!.checks = [{ id: "npm-testish", command: node('require("./node_modules/test-runner")') }];
    const plan = s.core.createPlan(s.draft);
    const prepare = vi.spyOn(s.evidence, "prepare");
    s.host.work = async input => {
      const a = s.core.getAttemptForSession(input.sessionId)!;
      expect(existsSync(join(input.directory, "node_modules"))).toBe(false);
      writeFileSync(join(input.directory, "file0"), "implementation");
      const check = await s.evidence.run(a.id, "npm-testish");
      expect(check.exitCode).toBe(0);
      writeFileSync(join(input.directory, "dist/output.js"), "disposable rewrite");
      const result = s.complete(input.sessionId); result.criteria[0]!.evidenceRefs.push(check.id); return result;
    };
    const result = await s.driver.run(plan.id, "parent");
    expect(result.outcome).toBe("completed");
    expect(prepare).toHaveBeenCalledTimes(2);
    expect(prepare.mock.calls[1]![1]).toBeTruthy();
    expect(result.attempts[0]!.integratedCheck!.passed).toBe(true);
    expect(existsSync(join(s.root, "dist"))).toBe(false);
    expect(existsSync(join(s.root, "node_modules"))).toBe(false);
    expect(readFileSync(join(s.root, "file0"), "utf8")).toBe("implementation");
  });

  it.each([false, true])("settles preparation failure without code retries (merged=%s)", async merged => {
    const s = setup();
    s.draft.tasks[0]!.environment = { generatedOutputs: [], prepare: { command: "echo actionable-setup-error; exit 7" } };
    s.draft.tasks[0]!.checks = [{ id: "check", command: "true" }];
    const plan = s.core.createPlan(s.draft);
    if (merged) {
      const original = s.evidence.prepare.bind(s.evidence);
      vi.spyOn(s.evidence, "prepare").mockImplementation((id, directory, options) => directory ? original(id, directory, options) : Promise.resolve(undefined));
    }
    s.host.work = async input => {
      const a = s.core.getAttemptForSession(input.sessionId)!;
      writeFileSync(join(input.directory, "file0"), "preserved code");
      try {
        const check = await s.evidence.run(a.id, "check");
        const result = s.complete(input.sessionId); result.criteria[0]!.evidenceRefs.push(check.id); return result;
      } catch { return { ...s.complete(input.sessionId), outcome: "partial", blockers: [{ kind: "technical", message: "Setup failed" }] }; }
    };
    const result = await s.driver.run(plan.id, "parent");
    expect(result.attempts).toHaveLength(1);
    expect(result.attempts[0]!.status).toBe("failed");
    expect(result.attempts[0]!.summary).toMatch(/Environment preparation.*preparations.*replan/);
    expect(existsSync(result.attempts[0]!.artifactRef!)).toBe(true);
    if (merged) expect(readFileSync(join(s.root, "file0"), "utf8")).toBe("preserved code");
    expect(s.core.listAttempts(plan.id, true)).toEqual([]);
    expect(() => s.core.revisePlan(plan.id, 1, s.draft, "Correct environment preparation")).not.toThrow();
  });

  it.each([false, true])("releases confirmed no-creation failures and retries only transient rejection (%s)", async retryable => {
    const s = setup(), plan = s.core.createPlan(s.draft);
    const create = vi.spyOn(s.host, "createSession").mockRejectedValueOnce(new HostCreationError(retryable ? "HTTP 429" : "HTTP 400", "no", retryable));
    s.host.work = async input => s.complete(input.sessionId);
    const result = await s.driver.run(plan.id, "parent");
    expect(result.outcome).toBe(retryable ? "completed" : "failed");
    expect(create).toHaveBeenCalledTimes(retryable ? 2 : 1);
    expect(s.core.listAttempts(plan.id, true)).toEqual([]);
    if (!retryable) expect(() => s.core.revisePlan(plan.id, 1, s.draft, "Correct rejected creation request")).not.toThrow();
  });

  it("settles a confirmed creation rejection arriving after cancellation", async () => {
    const s = setup(), plan = s.core.createPlan(s.draft);
    let reject!: (error: Error) => void;
    vi.spyOn(s.host, "createSession").mockImplementation(() => new Promise((_, fail) => { reject = fail; }));
    const running = s.driver.run(plan.id, "parent");
    await vi.waitFor(() => expect(reject).toBeTypeOf("function"));
    await s.driver.cancel(plan.id);
    reject(new HostCreationError("HTTP 400", "no", false));
    await running;
    await vi.waitFor(() => expect(s.core.getPlan(plan.id).status).toBe("cancelled"));
    expect(s.core.listAttempts(plan.id, true)).toEqual([]);
  });

  it("fails invalid assignment preflight before creating a host session", async () => {
    const s = setup(), plan = s.core.createPlan(s.draft);
    vi.spyOn(s.core, "assignment").mockImplementation(() => { throw new Error("Invalid assignment context shape"); });
    const result = await s.driver.run(plan.id, "parent");
    expect(result.outcome).toBe("failed");
    expect(result.attempts).toHaveLength(1);
    expect(s.host.sessions.size).toBe(0);
    expect(s.core.listAttempts(plan.id, true)).toEqual([]);
  });

  it("truly overlaps disjoint writers, binds before prompting, integrates and passes dependency results", async () => {
    const s = setup(3); s.draft.tasks[2]!.dependsOn = ["task0", "task1"];
    const plan = s.core.createPlan(s.draft);
    let entered = 0, release!: () => void;
    const barrier = new Promise<void>(resolve => { release = resolve; });
    const directories = new Set<string>();
    s.host.work = async input => {
      const a = s.core.getAttemptForSession(input.sessionId)!;
      expect(a.status).toBe("running"); expect(input.agent).toBe("sol-executor");
      expect(input.schema.$schema).toContain("draft-07");
      expect(s.host.sessions.get(input.sessionId)!.metadata).toEqual({ sol: { version: 2, projectRoot: s.core.projectRoot, planId: plan.id, taskId: a.taskId, attemptId: a.id } });
      directories.add(input.directory);
      if (a.taskId !== "task2") { if (++entered === 2) release(); await barrier; }
      else {
        expect(s.core.assignment(a.id).dependencies).toHaveLength(2);
        expect(input.prompt).toContain('"integratedSnapshotId"');
        expect(readFileSync(join(input.directory, "file0"), "utf8")).toBe("task0");
      }
      writeFileSync(join(input.directory, `file${a.taskId.slice(-1)}`), a.taskId);
      return s.complete(input.sessionId);
    };
    const result = await s.driver.run(plan.id, "parent");
    expect(result.outcome).toBe("completed"); expect(directories.size).toBe(3);
    expect(readFileSync(join(s.root, "file1"), "utf8")).toBe("task1");
    expect(s.workspaces.list().every(w => w.state === "cleaned")).toBe(true);
    expect(result.attempts.every(a => Buffer.byteLength(JSON.stringify(a)) < 8192)).toBe(true);
  });

  it("preserves worker evidence and records separate merged-check receipts", async () => {
    const s = setup(); s.draft.tasks[0]!.checks = [{ id: "check", command: "test -f file0" }];
    const plan = s.core.createPlan(s.draft);
    s.host.work = async input => {
      const a = s.core.getAttemptForSession(input.sessionId)!;
      writeFileSync(join(input.directory, "file0"), "verified");
      const proof = await s.evidence.run(a.id, "check");
      const result = s.complete(input.sessionId); result.criteria[0]!.evidenceRefs.push(proof.id); return result;
    };
    const result = await s.driver.run(plan.id, "parent");
    expect(result.outcome).toBe("completed");
    expect(s.core.listEvidence(s.core.listAttempts(plan.id)[0]!.id).filter(e => e.kind === "command")).toHaveLength(1);
    const report = s.evidence.readIntegrationReport(result.attempts[0]!.integratedCheck!.artifactPath);
    expect(report.passed).toBe(true); expect(report.checks).toHaveLength(1);
  });

  it("preserves partial technical implementation and prior result references on retry", async () => {
    const s = setup(), plan = s.core.createPlan(s.draft); let first = "";
    s.host.work = async input => {
      const result = s.complete(input.sessionId);
      if (!first) {
        first = input.directory; writeFileSync(join(first, "file0"), "checkpoint");
        return { ...result, outcome: "partial", blockers: [{ kind: "technical", message: "Temporary failure" }] };
      }
      expect(input.directory).toBe(first); expect(readFileSync(join(first, "file0"), "utf8")).toBe("checkpoint");
      expect(input.prompt).toContain('"resultRef"'); return result;
    };
    expect((await s.driver.run(plan.id, "parent")).outcome).toBe("completed");
    expect(s.core.listAttempts(plan.id).map(a => a.status)).toEqual(["failed", "succeeded"]);
  });

  it("continues unrelated branches after invalid acceptance, without retrying it", async () => {
    const s = setup(2), plan = s.core.createPlan(s.draft);
    s.host.work = async input => {
      const result = s.complete(input.sessionId);
      if (s.core.getAttemptForSession(input.sessionId)!.taskId === "task0") result.criteria = [];
      return result;
    };
    const result = await s.driver.run(plan.id, "parent");
    expect(result.status).toBe("failed"); expect(result.attempts.map(a => a.status)).toEqual(["failed", "succeeded"]);
  });

  it("bounds schema corrections by core attempt budget", async () => {
    const s = setup(), plan = s.core.createPlan(s.draft); s.host.work = async () => ({ invalid: true });
    const result = await s.driver.run(plan.id, "parent");
    expect(result.status).toBe("failed"); expect(result.attempts).toHaveLength(2);
    expect(result.issues.join(" ")).toContain("Invalid task result schema");
  });

  it("rejects readonly edits and archives offending files during cleanup", async () => {
    const s = setup(); s.draft.tasks[0]!.writes = []; const plan = s.core.createPlan(s.draft);
    s.host.work = async input => { writeFileSync(join(input.directory, "file0"), "bad"); return s.complete(input.sessionId); };
    const result = await s.driver.run(plan.id, "parent");
    expect(result.status).toBe("failed"); expect(existsSync(join(s.root, "file0"))).toBe(false);
    expect(result.issues.join(" ")).toContain("outside write scopes");
    expect(s.workspaces.list()[0]!.state).toBe("cleaned");
    expect(existsSync(s.workspaces.list()[0]!.directory)).toBe(false);
    expect(existsSync(result.attempts[0]!.artifactRef!)).toBe(true);
  });

  it("preserves conflict artifact, cleans captured workspace and never overwrites main", async () => {
    const s = setup(), plan = s.core.createPlan(s.draft);
    s.host.work = async input => {
      writeFileSync(join(input.directory, "file0"), "worker"); writeFileSync(join(s.root, "file0"), "user"); return s.complete(input.sessionId);
    };
    const result = await s.driver.run(plan.id, "parent");
    expect(result.status).toBe("failed"); expect(result.issues.join(" ")).toContain("Integration conflict: file0");
    expect(result.attempts).toHaveLength(1); // A conflict without a receipt cannot authorize a fresh-main retry.
    expect(readFileSync(join(s.root, "file0"), "utf8")).toBe("user");
    expect(s.workspaces.list()[0]!.state).toBe("cleaned"); expect(existsSync(result.attempts[0]!.artifactRef!)).toBe(true);
  });

  for (const status of ["idle", "missing", "running", "unknown"] as const) {
    it(`reconciles ${status} host state without duplicate execution`, async () => {
      const s = setup(), plan = s.core.createPlan(s.draft), w = s.workspaces.prepare("checkpoint");
      const a = s.core.leaseAttempt(plan.id, "task0", { workspacePath: w.directory, snapshotId: w.baseSnapshotId, isolated: true });
      s.core.startAttempt(a.id, "old"); s.host.states.set("old", status);
      writeFileSync(join(w.directory, "file0"), "retained");
      if (status === "idle") s.host.results.set("old", s.complete("old"));
      s.host.work = async input => { expect(input.directory).toBe(w.directory); return s.complete(input.sessionId); };
      const result = await s.driver.recover(plan.id, "parent");
      if (status === "running" || status === "unknown") {
        expect(result.status).toBe("active"); expect(s.host.sessions.size).toBe(0); expect(s.core.getAttempt(a.id).status).toBe("running");
      } else {
        expect(result.status).toBe("succeeded"); expect(s.host.sessions.size).toBe(status === "missing" ? 1 : 0);
        expect(s.core.getAttempt(a.id).status).toBe(status === "missing" ? "lost" : "succeeded");
        expect(readFileSync(join(s.root, "file0"), "utf8")).toBe("retained");
      }
    });
  }

  it("retains reservations when cancellation abort fails", async () => {
    const s = setup(), plan = s.core.createPlan(s.draft), w = s.workspaces.prepare("checkpoint");
    const a = s.core.leaseAttempt(plan.id, "task0", { workspacePath: w.directory, snapshotId: w.baseSnapshotId, isolated: true });
    s.core.startAttempt(a.id, "old"); s.host.abortFails = true;
    const result = await s.driver.cancel(plan.id);
    expect(result.status).toBe("active"); expect(result.issues.join(" ")).toContain("abort unconfirmed");
    expect(s.core.listAttempts(plan.id, true)).toHaveLength(1); expect(existsSync(w.directory)).toBe(true);
    s.host.abortFails = false; expect((await s.driver.cancel(plan.id)).status).toBe("cancelled");
  });

  it("schedules shared resources serially without treating contention as failure", async () => {
    const s = setup(2); s.draft.tasks.forEach(t => { t.resources = ["shared"]; }); const plan = s.core.createPlan(s.draft);
    let running = 0;
    s.host.work = async input => { expect(++running).toBe(1); await new Promise(resolve => setTimeout(resolve, 10)); running--; return s.complete(input.sessionId); };
    const result = await s.driver.run(plan.id, "parent"); expect(result.outcome).toBe("completed"); expect(result.issues).toEqual([]);
  });

  it("does not accept or reapply an integration changed by the user", async () => {
    const s = setup(1, 1), plan = s.core.createPlan(s.draft), w = s.workspaces.prepare("checkpoint");
    const a = s.core.leaseAttempt(plan.id, "task0", { workspacePath: w.directory, snapshotId: w.baseSnapshotId, isolated: true });
    s.core.startAttempt(a.id, "old"); s.host.states.set("old", "idle");
    writeFileSync(join(w.directory, "file0"), "integrated");
    s.core.submitResult(a.id, s.complete("old")); s.workspaces.capture(w.id, ["file0"]); s.workspaces.integrate(w.id);
    writeFileSync(join(s.root, "file0"), "later user edit");
    const result = await s.driver.recover(plan.id, "parent");
    expect(result.outcome).toBe("failed"); expect(result.issues.join(" ")).toContain("no longer matches main");
    expect(s.core.getAttempt(a.id).status).toBe("failed");
    expect(s.core.listAttempts(plan.id, true)).toHaveLength(0);
    expect(readFileSync(join(s.root, "file0"), "utf8")).toBe("later user edit");
  });

  it("recovers a crash after durable integration before acceptance without applying twice", async () => {
    const s = setup(); s.draft.tasks[0]!.checks = [{ id: "check", command: "test -f file0" }];
    const plan = s.core.createPlan(s.draft), w = s.workspaces.prepare("checkpoint");
    const a = s.core.leaseAttempt(plan.id, "task0", { workspacePath: w.directory, snapshotId: w.baseSnapshotId, isolated: true });
    s.core.startAttempt(a.id, "old"); s.host.states.set("old", "idle");
    writeFileSync(join(w.directory, "file0"), "integrated");
    const proof = await s.evidence.run(a.id, "check"), result = s.complete("old"); result.criteria[0]!.evidenceRefs.push(proof.id);
    s.core.submitResult(a.id, result); s.workspaces.capture(w.id, ["file0"]);
    const receipt = s.workspaces.integrate(w.id);
    s.workspaces.integrate = () => { throw new Error("Must never reapply"); };
    const recovered = await new ExecutionDriver(s.core, s.host, s.workspaces, s.evidence).recover(plan.id, "parent");
    expect(recovered.status).toBe("succeeded"); expect(s.core.getAttempt(a.id).integratedSnapshotId).toBe(receipt.snapshotId);
    expect(recovered.attempts[0]!.integratedCheck?.passed).toBe(true);
    expect(s.host.sessions.size).toBe(0); expect(s.workspaces.list().every(w => w.state === "cleaned")).toBe(true);
  });

  it("retains prematurely cleaned submitted integration without current proof", async () => {
    const s = setup(), plan = s.core.createPlan(s.draft), w = s.workspaces.prepare("checkpoint");
    const a = s.core.leaseAttempt(plan.id, "task0", { workspacePath: w.directory, snapshotId: w.baseSnapshotId, isolated: true });
    s.core.startAttempt(a.id, "old"); s.host.states.set("old", "idle");
    s.core.submitResult(a.id, s.complete("old")); s.workspaces.capture(w.id, ["file0"]); s.workspaces.integrate(w.id); s.workspaces.cleanup(w.id);
    const result = await s.driver.recover(plan.id, "parent");
    expect(result.status).toBe("active"); expect(s.core.getAttempt(a.id).status).toBe("submitted");
    expect(result.issues.join(" ")).toContain("current worker proof unavailable");
  });

  for (const wait of ["paused", "question", "plan question"] as const) {
    it(`defers submitted acceptance while ${wait}, then recovers without another worker`, async () => {
      const s = setup(), plan = s.core.createPlan(s.draft);
      s.host.work = async input => {
        writeFileSync(join(input.directory, "file0"), "waiting");
        const result = s.complete(input.sessionId);
        if (wait === "paused") s.core.pausePlan(plan.id);
        else s.core.requestQuestion({ id: "question", planId: plan.id, taskIds: wait === "plan question" ? [] : ["task0"], header: "Decision", question: "Proceed?",
          options: [{ label: "Yes", description: "Proceed" }], multiple: false, reason: "Approval needed", material: true });
        return result;
      };
      await s.driver.run(plan.id, "parent");
      const a = s.core.listAttempts(plan.id)[0]!;
      expect(a.status).toBe("submitted"); expect(existsSync(a.workspacePath)).toBe(true);
      expect(existsSync(join(s.root, "file0"))).toBe(false);
      if (wait === "paused") s.core.resumePlan(plan.id); else s.core.answerQuestion("question", ["Yes"]);
      expect((await s.driver.recover(plan.id, "parent")).status).toBe("succeeded"); expect(s.host.sessions.size).toBe(1);
    });
  }

  it("corrects incompatible green isolated changes using a fresh snapshot of integrated main", async () => {
    const s = setup(2);
    for (const task of s.draft.tasks) task.checks = [{ id: "compatible", command:
      'test ! -f file0 || test ! -f file1 || test "$(cat file0)" = compatible || test "$(cat file1)" = compatible' }];
    const plan = s.core.createPlan(s.draft); let entered = 0, release!: () => void;
    const barrier = new Promise<void>(resolve => { release = resolve; });
    const verify = s.evidence.verifyIntegration.bind(s.evidence);
    let simultaneous = 0, sawBoth = false;
    s.evidence.verifyIntegration = async (id, directory) => {
      expect(++simultaneous).toBe(1); expect(directory).not.toBe(s.root);
      sawBoth ||= existsSync(join(directory, "file0")) && existsSync(join(directory, "file1"));
      try { return await verify(id, directory); } finally { simultaneous--; }
    };
    s.host.work = async input => {
      const a = s.core.getAttemptForSession(input.sessionId)!;
      const previous = s.core.listAttempts(plan.id).find(old => old.taskId === a.taskId && old.id !== a.id);
      if (previous) {
        expect(a.revision).toBe(previous.revision); expect(input.directory).not.toBe(previous.workspacePath);
        expect(readFileSync(join(input.directory, "file0"), "utf8")).toBe("individually valid");
        expect(readFileSync(join(input.directory, "file1"), "utf8")).toBe("individually valid");
        expect(input.prompt).toContain("merged verification failed");
        expect(input.prompt).toContain("Merged-tree checks failed");
        expect(existsSync(previous.workspacePath)).toBe(false);
      }
      writeFileSync(join(input.directory, `file${a.taskId.slice(-1)}`), previous ? "compatible" : "individually valid");
      const proof = await s.evidence.run(a.id, "compatible"); expect(proof.exitCode).toBe(0);
      if (++entered === 2) release(); await barrier;
      const result = s.complete(input.sessionId); result.criteria[0]!.evidenceRefs.push(proof.id); return result;
    };
    const result = await s.driver.run(plan.id, "parent");
    expect(sawBoth).toBe(true); expect(result.status).toBe("succeeded"); expect(result.outcome).toBe("completed");
    expect(result.attempts.map(a => a.status).sort()).toEqual(["failed", "succeeded", "succeeded"]);
    expect(result.attempts.some(a => a.integratedCheck?.passed === false)).toBe(true);
    expect(result.issues.join(" ")).toContain("merged verification failed");
    const failed = s.core.listAttempts(plan.id).find(a => a.status === "failed")!;
    const archived = s.workspaces.list().find(w => w.directory === failed.workspacePath)!;
    expect(s.workspaces.integrated(archived.id)).toBeDefined(); expect(existsSync(archived.artifactPath!)).toBe(true);
    expect(s.workspaces.list().every(w => w.state === "cleaned")).toBe(true);
    expect(s.core.listAttempts(plan.id, true)).toHaveLength(0);
    expect((await s.driver.recover(plan.id, "parent")).status).toBe("succeeded");
  });

  it("exhausts unfixable merged gates, preserves integrated progress and permits revision", async () => {
    const s = setup(); s.draft.tasks[0]!.checks = [{ id: "gate", command: "test ! -f gate-obstruction" }];
    writeFileSync(join(s.root, "user-file"), "user content");
    const plan = s.core.createPlan(s.draft), verify = s.evidence.verifyIntegration.bind(s.evidence);
    let attempts = 0;
    s.host.work = async input => {
      const a = s.core.getAttemptForSession(input.sessionId)!;
      if (attempts) {
        expect(readFileSync(join(input.directory, "file0"), "utf8")).toBe("progress 1");
        expect(input.prompt).toContain("merged verification failed");
      }
      writeFileSync(join(input.directory, "file0"), `progress ${++attempts}`);
      const proof = await s.evidence.run(a.id, "gate"); expect(proof.exitCode).toBe(0);
      const result = s.complete(input.sessionId); result.criteria[0]!.evidenceRefs.push(proof.id); return result;
    };
    s.evidence.verifyIntegration = async (id, directory, options) => {
      // Model a persistent validation-environment obstruction with a real failed
      // command and receipt; it must never modify the primary project.
      writeFileSync(join(directory, "gate-obstruction"), "unfixable gate fixture");
      return verify(id, directory, options);
    };
    const result = await s.driver.run(plan.id, "parent");
    expect(result.outcome).toBe("failed"); expect(attempts).toBe(2);
    expect(result.attempts.map(a => a.status)).toEqual(["failed", "failed"]);
    expect(s.core.listAttempts(plan.id, true)).toHaveLength(0);
    expect(readFileSync(join(s.root, "file0"), "utf8")).toBe("progress 2");
    expect(readFileSync(join(s.root, "user-file"), "utf8")).toBe("user content");
    expect(existsSync(join(s.root, "gate-obstruction"))).toBe(false);
    for (const a of s.core.listAttempts(plan.id)) {
      expect(a.revision).toBe(plan.revision);
      const w = s.workspaces.list().find(w => w.directory === a.workspacePath)!;
      expect(w.state).toBe("cleaned"); expect(s.workspaces.integrated(w.id)).toBeDefined();
      expect(existsSync(w.artifactPath!)).toBe(true);
      const receipt = result.attempts.find(summary => summary.attemptId === a.id)!.integratedCheck!;
      expect(s.evidence.readIntegrationReport(receipt.artifactPath).passed).toBe(false);
    }
    expect(s.core.revisePlan(plan.id, plan.revision, s.draft, "Repair unfixable merged gate").status).toBe("active");
    expect(s.core.listAttempts(plan.id, true)).toHaveLength(0);
  });

  it("does not fail a rejected merged gate while acceptance is paused", async () => {
    const s = setup(); s.draft.tasks[0]!.checks = [{ id: "gate", command: "true" }];
    const plan = s.core.createPlan(s.draft), verify = s.evidence.verifyIntegration.bind(s.evidence);
    s.host.work = async input => {
      const a = s.core.getAttemptForSession(input.sessionId)!;
      const proof = await s.evidence.run(a.id, "gate"), result = s.complete(input.sessionId);
      result.criteria[0]!.evidenceRefs.push(proof.id); return result;
    };
    s.evidence.verifyIntegration = async (id, directory, options) => {
      const result = await verify(id, directory, options); s.core.pausePlan(plan.id);
      return { ...result, passed: false, summary: "Deferred merged gate" };
    };
    expect((await s.driver.run(plan.id, "parent")).status).toBe("paused");
    const a = s.core.listAttempts(plan.id)[0]!;
    expect(a.status).toBe("submitted"); expect(existsSync(a.workspacePath)).toBe(true);
    s.core.resumePlan(plan.id); s.evidence.verifyIntegration = verify;
    expect((await s.driver.recover(plan.id, "parent")).status).toBe("succeeded");
    expect(s.core.listAttempts(plan.id)).toHaveLength(1);
  });

  it("serializes integration and merged gates across driver instances sharing a root", async () => {
    const s = setup(); s.draft.tasks[0]!.checks = [{ id: "check", command: "true" }];
    const first = s.core.createPlan(s.draft); s.draft.tasks[0]!.writes = ["file1"];
    const second = s.core.createPlan(s.draft);
    const other = new ExecutionDriver(s.core, s.host, s.workspaces, s.evidence);
    let entered = 0, release!: () => void, checking = false;
    const barrier = new Promise<void>(resolve => { release = resolve; });
    const verify = s.evidence.verifyIntegration.bind(s.evidence);
    s.evidence.verifyIntegration = async (id, directory, options) => {
      expect(checking).toBe(false); checking = true;
      try { await new Promise(resolve => setTimeout(resolve, 20)); return await verify(id, directory, options); }
      finally { checking = false; }
    };
    s.host.work = async input => {
      const a = s.core.getAttemptForSession(input.sessionId)!;
      writeFileSync(join(input.directory, s.core.assignment(a.id).task.writes[0]!), "change");
      const proof = await s.evidence.run(a.id, "check");
      if (++entered === 2) release(); await barrier;
      const result = s.complete(input.sessionId); result.criteria[0]!.evidenceRefs.push(proof.id); return result;
    };
    const results = await Promise.all([s.driver.run(first.id, "parent"), other.run(second.id, "parent")]);
    expect(results.map(r => r.status)).toEqual(["succeeded", "succeeded"]);
  });

  it("defers acceptance if paused during merged checks and resumes from the receipt", async () => {
    const s = setup(); s.draft.tasks[0]!.checks = [{ id: "check", command: "test -f file0" }];
    const plan = s.core.createPlan(s.draft), verify = s.evidence.verifyIntegration.bind(s.evidence);
    s.host.work = async input => {
      const a = s.core.getAttemptForSession(input.sessionId)!;
      writeFileSync(join(input.directory, "file0"), "change");
      const proof = await s.evidence.run(a.id, "check"), result = s.complete(input.sessionId);
      result.criteria[0]!.evidenceRefs.push(proof.id); return result;
    };
    s.evidence.verifyIntegration = async (id, directory, options) => {
      const result = await verify(id, directory, options); s.core.pausePlan(plan.id); return result;
    };
    expect((await s.driver.run(plan.id, "parent")).status).toBe("paused");
    const w = s.workspaces.list().find(w => w.state === "integrated")!;
    expect(w).toBeDefined(); expect(s.core.listAttempts(plan.id)[0]!.status).toBe("submitted");
    s.core.resumePlan(plan.id); s.evidence.verifyIntegration = verify;
    s.workspaces.integrate = () => { throw new Error("Already integrated"); };
    expect((await s.driver.recover(plan.id, "parent")).status).toBe("succeeded");
  });

  it("retries on effective main after main changes during merged validation", async () => {
    const s = setup(); s.draft.tasks[0]!.checks = [{ id: "check", command: "true" }];
    const plan = s.core.createPlan(s.draft), verify = s.evidence.verifyIntegration.bind(s.evidence);
    s.host.work = async input => {
      const a = s.core.getAttemptForSession(input.sessionId)!;
      if (s.core.listAttempts(plan.id).length > 1) {
        expect(readFileSync(join(input.directory, "unrelated-user-file"), "utf8")).toBe("must remain");
        expect(input.prompt).toContain("Merged project changed");
      }
      const proof = await s.evidence.run(a.id, "check"), result = s.complete(input.sessionId);
      result.criteria[0]!.evidenceRefs.push(proof.id); return result;
    };
    s.evidence.verifyIntegration = async (id, directory, options) => {
      const result = await verify(id, directory, options);
      writeFileSync(join(s.root, "unrelated-user-file"), "must remain"); return result;
    };
    const result = await s.driver.run(plan.id, "parent");
    expect(result.status).toBe("succeeded"); expect(result.attempts.map(a => a.status)).toEqual(["failed", "succeeded"]);
    expect(result.issues.join(" ")).toContain("Merged project changed");
    expect(readFileSync(join(s.root, "unrelated-user-file"), "utf8")).toBe("must remain");
  });

  it("aborts an unresponsive prompt without hanging run or releasing before confirmation", async () => {
    const s = setup(), plan = s.core.createPlan(s.draft), controller = new AbortController();
    let entered!: () => void; const started = new Promise<void>(resolve => { entered = resolve; });
    s.host.work = async () => { entered(); return new Promise(() => {}); };
    const run = s.driver.run(plan.id, "parent", { signal: controller.signal });
    await started; controller.abort();
    expect((await run).status).toBe("cancelled"); expect(s.core.listAttempts(plan.id, true)).toHaveLength(0);
  });

  it("allows readonly acceptance without integration and does not reaccept terminals", async () => {
    const s = setup(); s.draft.tasks[0]!.writes = []; const plan = s.core.createPlan(s.draft);
    s.host.work = async input => s.complete(input.sessionId);
    expect((await s.driver.run(plan.id, "parent")).status).toBe("succeeded");
    expect(s.core.listAttempts(plan.id)[0]!.integratedSnapshotId).toBeUndefined();
    expect((await s.driver.recover(plan.id, "parent")).status).toBe("succeeded"); expect(s.host.sessions.size).toBe(1);
  });

  it("bounds a hung task by the remaining duration budget", async () => {
    const s = setup(); s.draft.budgets.maxDurationMs = 50; const plan = s.core.createPlan(s.draft);
    s.host.work = async () => new Promise(() => {});
    const result = await s.driver.run(plan.id, "parent");
    expect(result.status).toBe("failed"); expect(s.core.listAttempts(plan.id, true)).toHaveLength(0);
    expect(result.attempts[0]!.summary).toContain("timed out");
  });

  it("keeps a lease without session identity uncertain during recovery and cancellation", async () => {
    const s = setup(), plan = s.core.createPlan(s.draft), w = s.workspaces.prepare("checkpoint");
    const a = s.core.leaseAttempt(plan.id, "task0", { workspacePath: w.directory, snapshotId: w.baseSnapshotId, isolated: true });
    expect((await s.driver.recover(plan.id, "parent")).outcome).toBe("refine");
    expect((await s.driver.cancel(plan.id)).status).toBe("active");
    expect(s.core.getAttempt(a.id).status).toBe("leased"); expect(s.host.sessions.size).toBe(0);
  });

  it("cancels recovered merged verification through the caller signal", async () => {
    const s = setup(); s.draft.tasks[0]!.checks = [{ id: "check", command: "true" }];
    const plan = s.core.createPlan(s.draft), w = s.workspaces.prepare("checkpoint");
    const a = s.core.leaseAttempt(plan.id, "task0", { workspacePath: w.directory, snapshotId: w.baseSnapshotId, isolated: true });
    s.core.startAttempt(a.id, "old"); s.host.states.set("old", "idle");
    const proof = await s.evidence.run(a.id, "check"), result = s.complete("old");
    result.criteria[0]!.evidenceRefs.push(proof.id); s.core.submitResult(a.id, result);
    const entered = deferred<AbortSignal>(), caller = new AbortController(), activities: string[] = [];
    s.evidence.verifyIntegration = async (_id, _directory, options) => {
      entered.resolve(options!.signal!);
      return new Promise(resolve => options!.signal!.addEventListener("abort", () =>
        resolve({ passed: false, summary: "Cancelled", artifactPath: "integrations/cancelled.json" }), { once: true }));
    };
    const recovery = s.driver.recover(plan.id, "parent", { signal: caller.signal, onActivity: text => activities.push(text) });
    const checkSignal = await entered.promise;
    expect(s.driver.activePlanIds()).toEqual([plan.id]); caller.abort();
    expect((await recovery).status).toBe("cancelled"); expect(checkSignal.aborted).toBe(true);
    expect(activities.some(text => text.includes("recovered") && text.includes(a.id))).toBe(true);
  });

  it("does not start ready workers after an abort during recovery status probing", async () => {
    const s = setup(2), plan = s.core.createPlan(s.draft), w = s.workspaces.prepare("checkpoint");
    const a = s.core.leaseAttempt(plan.id, "task0", { workspacePath: w.directory, snapshotId: w.baseSnapshotId, isolated: true });
    s.core.startAttempt(a.id, "old");
    const status = deferred<"idle">(), entered = deferred<void>(), caller = new AbortController();
    s.host.status = async () => { entered.resolve(); return status.promise; };
    const recovery = s.driver.recover(plan.id, "parent", { signal: caller.signal });
    await entered.promise; caller.abort();
    expect((await recovery).status).toBe("cancelled");
    status.resolve("idle"); await Promise.resolve();
    expect(s.host.sessions.size).toBe(0); expect(s.core.listAttempts(plan.id)).toHaveLength(1);
  });

  it("hooks an additional recovery caller's abort to an existing run", async () => {
    const s = setup(), plan = s.core.createPlan(s.draft), entered = deferred<void>();
    s.host.work = async () => { entered.resolve(); return new Promise(() => {}); };
    const first = s.driver.run(plan.id, "parent"); await entered.promise;
    const caller = new AbortController();
    const second = s.driver.recover(plan.id, "parent", { signal: caller.signal });
    caller.abort();
    expect((await first).status).toBe("cancelled"); expect((await second).status).toBe("cancelled");
    expect(s.host.sessions.size).toBe(1);
  });

  for (const cause of ["cancel", "timeout"] as const) {
    it(`reconciles session creation resolving after ${cause}, without prompting`, async () => {
      vi.useFakeTimers();
      const s = setup(), plan = s.core.createPlan(s.draft), creation = deferred<string>();
      s.host.createSession = () => creation.promise;
      const abort = vi.spyOn(s.host, "abort"), prompt = vi.spyOn(s.host, "prompt");
      const run = s.driver.run(plan.id, "parent");
      await vi.advanceTimersByTimeAsync(0);
      const a = s.core.listAttempts(plan.id)[0]!;
      if (cause === "cancel") await s.driver.cancel(plan.id);
      else await vi.advanceTimersByTimeAsync(10_001);
      expect((await run).status).toBe("active");
      expect(s.core.getAttempt(a.id).status).toBe("leased");
      expect(s.driver.activePlanIds()).toEqual([plan.id]);
      creation.resolve("late-session"); await vi.advanceTimersByTimeAsync(0);
      expect(s.core.getAttemptForSession("late-session")?.id).toBe(a.id);
      expect(abort).toHaveBeenCalledWith("late-session", a.workspacePath); expect(prompt).not.toHaveBeenCalled();
      expect(abort).toHaveBeenCalledTimes(1);
      expect(s.core.listAttempts(plan.id, true)).toHaveLength(0);
      expect(s.core.getPlan(plan.id).status).toBe(cause === "cancel" ? "cancelled" : "active");
      expect(s.driver.activePlanIds()).toEqual([]);
      if (cause === "timeout") expect(existsSync(a.workspacePath)).toBe(true);
    });
  }

  it("retries confirmed idle sessions without results in the preserved checkpoint", async () => {
    vi.useFakeTimers();
    const s = setup(), plan = s.core.createPlan(s.draft), w = s.workspaces.prepare("checkpoint");
    const a = s.core.leaseAttempt(plan.id, "task0", { workspacePath: w.directory, snapshotId: w.baseSnapshotId, isolated: true });
    s.core.startAttempt(a.id, "old"); s.host.states.set("old", "idle");
    writeFileSync(join(w.directory, "file0"), "checkpoint");
    const activities: string[] = [];
    s.host.work = async input => {
      expect(input.directory).toBe(w.directory); expect(input.prompt).toContain("Host confirmed idle without structured result");
      return s.complete(input.sessionId);
    };
    const recovery = s.driver.recover(plan.id, "parent", { onActivity: text => activities.push(text) });
    await vi.advanceTimersByTimeAsync(101);
    expect((await recovery).status).toBe("succeeded");
    expect(readFileSync(join(s.root, "file0"), "utf8")).toBe("checkpoint");
    expect(activities.some(text => text.startsWith("recovered:") && text.includes(a.id))).toBe(true);
    expect(activities.some(text => text.startsWith("completed:") && text.includes(plan.id))).toBe(true);
  });

  it("shutdown cancels owned runs but does not cancel another owner's active plan", async () => {
    const s = setup(), own = s.core.createPlan(s.draft), foreign = s.core.createPlan(s.draft), w = s.workspaces.prepare("foreign");
    const a = s.core.leaseAttempt(foreign.id, "task0", { workspacePath: w.directory, snapshotId: w.baseSnapshotId, isolated: true });
    s.core.startAttempt(a.id, "foreign-session"); s.host.states.set("foreign-session", "running");
    const entered = deferred<void>(); s.host.work = async () => { entered.resolve(); return new Promise(() => {}); };
    const abort = vi.spyOn(s.host, "abort");
    const run = s.driver.run(own.id, "parent"); await entered.promise;
    expect(s.driver.activePlanIds()).toEqual([own.id]);
    await s.driver.shutdown(); expect((await run).status).toBe("cancelled");
    expect(s.core.getAttempt(a.id).status).toBe("running");
    expect(abort.mock.calls.some(([id]) => id === "foreign-session")).toBe(false);
    expect(s.driver.activePlanIds()).toEqual([]);
    await expect(s.driver.run(own.id, "parent")).rejects.toThrow("shutting down");
  });

  it("shutdown drains creation that resolves during shutdown", async () => {
    vi.useFakeTimers();
    const s = setup(), plan = s.core.createPlan(s.draft), creation = deferred<string>();
    s.host.createSession = () => creation.promise;
    const run = s.driver.run(plan.id, "parent"); await vi.advanceTimersByTimeAsync(0);
    let done = false; const shutdown = s.driver.shutdown().then(() => { done = true; });
    await vi.advanceTimersByTimeAsync(0); expect(done).toBe(false);
    creation.resolve("late-shutdown"); await vi.advanceTimersByTimeAsync(0); await shutdown; await run;
    expect(s.core.getPlan(plan.id).status).toBe("cancelled");
    expect(s.core.getAttemptForSession("late-shutdown")?.status).toBe("cancelled");
    expect(s.driver.activePlanIds()).toEqual([]);
  });

  it("shutdown bounds unresolved creation and late resolution never touches a disposed core", async () => {
    vi.useFakeTimers();
    const s = setup(), plan = s.core.createPlan(s.draft), creation = deferred<string>();
    s.host.createSession = () => creation.promise;
    const run = s.driver.run(plan.id, "parent"); await vi.advanceTimersByTimeAsync(0);
    const shutdown = s.driver.shutdown(); await vi.advanceTimersByTimeAsync(10_001); await shutdown; await run;
    const abort = vi.spyOn(s.host, "abort");
    const get = vi.spyOn(s.core, "getAttempt").mockImplementation(() => { throw new Error("Core disposed"); });
    creation.resolve("after-disposal"); await vi.advanceTimersByTimeAsync(0);
    expect(abort).toHaveBeenCalledWith("after-disposal", expect.any(String)); expect(get).not.toHaveBeenCalled();
  });

  for (const settles of [true, false]) {
    it(`shutdown ${settles ? "waits for" : "reports"} an outstanding integration check`, async () => {
      const s = setup(); s.draft.tasks[0]!.checks = [{ id: "check", command: "true" }];
      const plan = s.core.createPlan(s.draft), entered = deferred<AbortSignal>();
      const checking = deferred<{ passed: boolean; summary: string; artifactPath: string }>();
      s.host.work = async input => {
        const a = s.core.getAttemptForSession(input.sessionId)!;
        const proof = await s.evidence.run(a.id, "check"), result = s.complete(input.sessionId);
        result.criteria[0]!.evidenceRefs.push(proof.id); return result;
      };
      s.evidence.verifyIntegration = async (_id, _directory, options) => {
        entered.resolve(options!.signal!); return checking.promise;
      };
      const run = s.driver.run(plan.id, "parent"), signal = await entered.promise;
      vi.useFakeTimers();
      const shutdown = s.driver.shutdown();
      const assertion = settles ? shutdown : expect(shutdown).rejects.toThrow("retain core");
      await vi.advanceTimersByTimeAsync(0); expect(signal.aborted).toBe(true);
      expect(s.driver.activePlanIds()).toContain(plan.id);
      if (!settles) await vi.advanceTimersByTimeAsync(10_001);
      checking.resolve({ passed: false, summary: "Stopped", artifactPath: "integrations/stopped.json" });
      await vi.advanceTimersByTimeAsync(0); await assertion;
      expect((await run).status).toBe("cancelled"); expect(s.driver.activePlanIds()).toEqual([]);
    });
  }

  it("shutdown does not abort an unknown owner's session during recovery probing", async () => {
    const s = setup(), plan = s.core.createPlan(s.draft), w = s.workspaces.prepare("foreign");
    const a = s.core.leaseAttempt(plan.id, "task0", { workspacePath: w.directory, snapshotId: w.baseSnapshotId, isolated: true });
    s.core.startAttempt(a.id, "foreign-session");
    const entered = deferred<void>(), status = deferred<"unknown">();
    s.host.status = async () => { entered.resolve(); return status.promise; };
    const abort = vi.spyOn(s.host, "abort"), recovery = s.driver.recover(plan.id, "parent");
    await entered.promise; await s.driver.shutdown();
    expect((await recovery).status).toBe("active"); expect(abort).not.toHaveBeenCalled();
    expect(s.core.getAttempt(a.id).status).toBe("running"); status.resolve("unknown");
  });

  it("corrects stale completed evidence in the same checkpoint", async () => {
    const s = setup(); s.draft.tasks[0]!.checks = [{ id: "check", command: "test -f file0" }]; const plan = s.core.createPlan(s.draft);
    let calls = 0;
    s.host.work = async input => {
      const a = s.core.getAttemptForSession(input.sessionId)!;
      if (!calls) writeFileSync(join(input.directory, "file0"), "initial");
      const proof = await s.evidence.run(a.id, "check");
      if (++calls === 1) writeFileSync(join(input.directory, "file0"), "final");
      const result = s.complete(input.sessionId); result.criteria[0]!.evidenceRefs.push(proof.id); return result;
    };
    expect((await s.driver.run(plan.id, "parent")).status).toBe("succeeded"); expect(calls).toBe(2);
    expect(readFileSync(join(s.root, "file0"), "utf8")).toBe("final");
  });
});
