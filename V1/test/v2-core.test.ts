import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DeferredAcceptanceError, SolCore, planTemplates, type PlanDraft, type TaskResult, type TaskSpec, type Question, type PlannerResult } from "../src/v2/core.js";
import { SolDatabase } from "../src/store/database.js";

const cores: SolCore[] = [];
const directories: string[] = [];
function core(root = "/project", database = ":memory:"): SolCore {
  const instance = new SolCore(root, database); cores.push(instance); return instance;
}
afterEach(() => { vi.useRealTimers(); cores.splice(0).forEach((instance) => instance.close()); directories.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })); });
function draft(readOnly = true): PlanDraft {
  return readOnly ? planTemplates.investigation() : planTemplates.fast();
}
function task(id: string, changes: Partial<TaskSpec> = {}): TaskSpec {
  return { id, title: id, role: "executor", dependsOn: [], reads: ["src/**"], writes: [], resources: [], skills: [], sourceIds: [], decisionIds: [], acceptance: ["done"], checks: [], ...changes };
}
function parallel(tasks: TaskSpec[]): PlanDraft { return planTemplates.standard({ tasks }); }
function lease(c: SolCore, planId: string, taskId = "work", isolated = false, workspacePath = "/project"): string {
  return c.leaseAttempt(planId, taskId, { workspacePath, snapshotId: "baseline", isolated }).id;
}
function start(c: SolCore, planId: string, taskId = "work"): string {
  const id = lease(c, planId, taskId); c.startAttempt(id, `session-${id}`); return id;
}
function result(refs: string[] = []): TaskResult {
  return { schemaVersion: 2, outcome: "completed", summary: "Verified objective", criteria: [{ id: "done", status: "satisfied", evidenceRefs: refs }], findings: [], blockers: [], artifacts: [] };
}
function inspection(c: SolCore, id: string): string {
  return c.recordEvidence(id, { kind: "inspection", summary: "Inspected the acceptance criterion against assigned snapshot", snapshotId: "baseline" }).id;
}
function complete(c: SolCore, planId: string, taskId = "work"): string {
  const id = start(c, planId, taskId); c.submitResult(id, result([inspection(c, id)])); c.acceptAttempt(id); return id;
}
function question(changes: Partial<Question> = {}): Question {
  return { id: "direction", taskIds: [], header: "Direction", question: "Choose direction", options: [{ label: "A", description: "First" }], multiple: false, reason: "Acceptance depends on it", material: true, ...changes };
}
function proposal(changes: Partial<PlannerResult> = {}): PlannerResult {
  return { schemaVersion: 2, summary: "Scoped implementation", plan: draft(), questions: [], reason: "Meet the requested objective", ...changes };
}
const baseline = (capturedAt = "2026-01-01T00:00:00.000Z") => ({
  capturedAt,
  gitHead: "a".repeat(40),
  documents: [{ id: "project.md", sha256: "b".repeat(64) }, { id: "stack.md", sha256: "c".repeat(64) }],
  sources: [{ path: "src/index.ts", sha256: "d".repeat(64), documentIds: ["stack.md"] }],
});
const discussionInput = () => ({
  objective: "Persist the planning context",
  grayAreas: [
    { id: "storage", title: "Storage", context: "Choose the persistence boundary", status: "proposed" as const },
    { id: "retrieval", title: "Retrieval", context: "Choose the lookup boundary", status: "proposed" as const },
  ],
});

describe("v2 deterministic core", () => {
  it("persists project-scoped planning discussions with CAS and strict bounded validation", () => {
    const dir = mkdtempSync(join(tmpdir(), "sol-v2-discussion-")); directories.push(dir);
    const path = join(dir, "state.sqlite"), c = core("/project", path), foreign = core("/other", path);
    const started = c.startDiscussion(discussionInput(), "parent-session");
    expect(started).toMatchObject({ parentSessionId: "parent-session", status: "active", revision: 1, decisions: [], specifics: [], deferred: [] });
    expect(foreign.latestDiscussionForSession("parent-session")).toBeUndefined();
    expect(() => foreign.getDiscussion(started.id)).toThrow(/Unknown/);

    const updated = c.updateDiscussion(started.id, 1, { specifics: ["Keep context compact"] });
    expect(updated.revision).toBe(2);
    expect(() => c.updateDiscussion(started.id, 1, { deferred: ["stale"] })).toThrow(/revision conflict/);
    expect(c.getDiscussion(started.id)).toEqual(updated);
    expect(core("/project", path).getDiscussion(started.id)).toEqual(updated);
    expect(c.readOnly().listDiscussions("parent-session", ["active"])).toEqual([updated]);
    expect("updateDiscussion" in c.readOnly()).toBe(false);

    expect(() => c.startDiscussion({ ...discussionInput(), transcript: "raw Q&A" } as never, "parent-session")).toThrow();
    expect(() => c.startDiscussion({ ...discussionInput(), options: ["raw option"] } as never, "parent-session")).toThrow();
    expect(() => c.updateDiscussion(started.id, 2, { canonicalRefs: [{ path: "../outside", reason: "escape" }] })).toThrow(/safe project-relative/);
    expect(() => c.updateDiscussion(started.id, 2, { grayAreas: [discussionInput().grayAreas[0]!, discussionInput().grayAreas[0]!] })).toThrow(/Duplicate/);
    expect(() => c.updateDiscussion(started.id, 2, { decisions: [{ id: "choice", areaId: "storage", statement: "SQLite", source: "user", reversibility: "reversible" }] })).toThrow(/selected gray area/);
    expect(() => c.updateDiscussion(started.id, 2, { grayAreas: [{ ...started.grayAreas[0]!, status: "selected" }, started.grayAreas[1]!],
      decisions: [{ id: "storage", areaId: "storage", statement: "SQLite", source: "user", reversibility: "reversible" }] })).toThrow(/IDs must be unique/);
    expect(c.getDiscussion(started.id).revision).toBe(2);
  });

  it("completes and retrieves ready planning context without auditing content", () => {
    const c = core(), secret = "sensitive-final-planning-wording";
    const started = c.startDiscussion(discussionInput(), "parent-session");
    expect(() => c.completeDiscussion(started.id, 1, { scopeBoundary: "Only v2 persistence",
      grayAreas: [{ ...started.grayAreas[0]!, status: "selected" }, started.grayAreas[1]!] })).toThrow(/unresolved|requires a decision/);
    const ready = c.completeDiscussion(started.id, 1, {
      scopeBoundary: "Only v2 persistence",
      grayAreas: [{ ...started.grayAreas[0]!, status: "selected" }, { ...started.grayAreas[1]!, status: "skipped" }],
      decisions: [{ id: "sqlite", areaId: "storage", statement: secret, rationale: "Project isolation", source: "user", reversibility: "reversible" }],
      canonicalRefs: [{ path: "src/v2/core.ts", reason: "Persistence owner" }],
      codeContext: { reusableAssets: [{ path: "src/store/database.ts", statement: "Reuse database wrapper" }], establishedPatterns: [], integrationPoints: [] },
      specifics: ["Use compare-and-swap revisions"], deferred: ["No plan creation"],
    });
    expect(ready).toMatchObject({ status: "ready", revision: 2, scopeBoundary: "Only v2 persistence" });
    expect(ready.completedAt).toBeTypeOf("string");
    expect(c.latestDiscussionForSession("parent-session", ["ready"])).toEqual(ready);
    expect(c.listDiscussions(undefined, ["ready"])).toEqual([ready]);
    expect(() => c.updateDiscussion(ready.id, ready.revision, { deferred: ["later"] })).toThrow(/ready discussion/);

    const audit = c.digest(undefined, 0).events.filter((event) => event.type.startsWith("discussion."));
    expect(audit.map((event) => event.type)).toEqual(["discussion.started", "discussion.ready"]);
    expect(JSON.stringify(audit)).not.toContain(secret);
    expect(JSON.stringify(audit)).not.toContain("src/v2/core.ts");
    expect(audit.every((event) => event.planId === null && Object.keys(event).sort().join(",") === "createdAt,entityId,id,planId,type")).toBe(true);
  });

  it("supports explicit no-material completion and supersedes prior ready context for the same objective", () => {
    const c = core(), first = c.startDiscussion(discussionInput(), "parent-session");
    const ready = c.completeDiscussion(first.id, first.revision, { scopeBoundary: "No implementation scope",
      grayAreas: first.grayAreas.map((area) => ({ ...area, status: "skipped" as const })), noMaterialDecisions: true });
    expect(ready.status).toBe("ready");
    expect(() => c.completeDiscussion(c.startDiscussion(discussionInput(), "other-session").id, 1, {
      scopeBoundary: "No material choices", grayAreas: first.grayAreas.map((area) => ({ ...area, status: "skipped" as const })),
    })).toThrow(/explicit no-material-decisions/);

    const replacement = c.startDiscussion(discussionInput(), "parent-session");
    expect(c.getDiscussion(first.id)).toMatchObject({ status: "superseded", revision: 3, completedAt: ready.completedAt });
    expect(c.latestDiscussionForSession("parent-session")?.id).toBe(replacement.id);
    expect(c.latestDiscussionForSession("parent-session", ["ready"])).toBeUndefined();
    expect(c.latestDiscussionForSession("other-session")?.status).toBe("active");
    expect(c.listDiscussions("parent-session").map((entry) => entry.status)).toEqual(["active", "superseded"]);
  });

  it("persists and resumes bounded project onboarding with private preferences separated", () => {
    const dir = mkdtempSync(join(tmpdir(), "sol-v2-onboarding-")); directories.push(dir);
    const path = join(dir, "state.sqlite"), c = core("/project", path);
    expect(c.getProjectOnboarding()).toMatchObject({ state: "missing", revision: 0, mappingMode: "initial", selectedFocuses: [], scopePaths: [], baseline: null, lastCompletedAt: null, createdAt: null });
    const begun = c.beginProjectOnboarding({ expectedRevision: 0, persistenceChoices: { sharedDocuments: true, privatePreferences: true } });
    const updated = c.updateProjectOnboarding({ expectedRevision: begun.revision, currentStage: "mapping", designChoice: "existing",
      completedDocumentIds: ["business-profile"], businessAnswers: [{ id: "company-stage", answer: "growth" }],
      privatePreferences: [{ id: "writing-style", answer: "concise" }] });
    const restored = core("/project", path).getProjectOnboarding();
    expect(restored).toEqual(updated);
    expect(restored.businessAnswers).toEqual([{ id: "company-stage", answer: "growth" }]);
    expect(restored.privatePreferences).toEqual([{ id: "writing-style", answer: "concise" }]);
    expect(c.readOnly().getProjectOnboarding()).toEqual(updated);
    expect("updateProjectOnboarding" in c.readOnly()).toBe(false);
  });

  it("migrates pre-baseline onboarding records without discarding ready state", () => {
    const dir = mkdtempSync(join(tmpdir(), "sol-v2-onboarding-migration-")); directories.push(dir);
    const path = join(dir, "state.sqlite"), c = core("/project", path), database = new SolDatabase(path);
    const legacy = { schemaVersion: 1, revision: 4, state: "ready", currentStage: "complete", designChoice: "not-applicable",
      persistenceChoices: { sharedDocuments: true, privatePreferences: false }, completedDocumentIds: ["index.md"],
      businessAnswers: [], privatePreferences: [], createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:01:00.000Z" };
    database.db.prepare("INSERT INTO v2_project_onboarding(root,revision,state,data) VALUES (?,?,?,?)")
      .run("/project", legacy.revision, legacy.state, JSON.stringify(legacy));

    expect(c.getProjectOnboarding()).toMatchObject({ state: "ready", revision: 4, mappingMode: "initial",
      selectedFocuses: [], scopePaths: [], baseline: null, lastCompletedAt: null });
    const persisted = JSON.parse((database.db.prepare("SELECT data FROM v2_project_onboarding WHERE root=?").get("/project") as { data: string }).data);
    expect(persisted).toMatchObject({ mappingMode: "initial", selectedFocuses: [], scopePaths: [], baseline: null, lastCompletedAt: null });
    expect(c.digest(undefined, 0).events).toEqual([]);
    expect(c.refreshProjectOnboarding({ expectedRevision: 4, mode: "full-refresh",
      selectedFocuses: ["tech", "architecture", "quality", "concerns", "project", "design", "index"], scopePaths: [] }))
      .toMatchObject({ state: "active", revision: 5, completedDocumentIds: [] });
    database.close();
  });

  it("enforces onboarding revision conflicts, transitions, project isolation and snooze/decline", () => {
    const dir = mkdtempSync(join(tmpdir(), "sol-v2-onboarding-isolation-")); directories.push(dir);
    const path = join(dir, "state.sqlite"), c = core("/project", path), foreign = core("/other", path);
    const offered = c.beginProjectOnboarding({ expectedRevision: 0, state: "offered" });
    expect(foreign.getProjectOnboarding().state).toBe("missing");
    expect(() => c.beginProjectOnboarding({ expectedRevision: 0 })).toThrow(/revision conflict/);
    const snoozed = c.snoozeProjectOnboarding({ expectedRevision: offered.revision, sessionMarker: "session-1" });
    expect(snoozed).toMatchObject({ state: "snoozed", snoozedSessionMarker: "session-1" });
    const active = c.beginProjectOnboarding({ expectedRevision: snoozed.revision,
      persistenceChoices: { sharedDocuments: true, privatePreferences: false } });
    expect(active).not.toHaveProperty("snoozedSessionMarker");
    const declined = c.declineProjectOnboarding({ expectedRevision: active.revision });
    expect(declined.state).toBe("declined");
    expect(() => c.updateProjectOnboarding({ expectedRevision: declined.revision, currentStage: "business" })).toThrow(/transition/);
    expect(foreign.getProjectOnboarding().state).toBe("missing");
  });

  it("keeps onboarding secrets out of audit events and requires documents before ready", () => {
    const c = core(), begun = c.beginProjectOnboarding({ expectedRevision: 0,
      persistenceChoices: { sharedDocuments: true, privatePreferences: true } });
    const secret = "secret-token-that-must-not-be-audited";
    const updated = c.updateProjectOnboarding({ expectedRevision: begun.revision, currentStage: "review",
      businessAnswers: [{ id: "explicit-answer", answer: secret }], privatePreferences: [{ id: "private-choice", answer: secret }] });
    expect(() => c.markProjectOnboardingReady({ expectedRevision: updated.revision, completedDocumentIds: [] })).toThrow();
    const ready = c.markProjectOnboardingReady({ expectedRevision: updated.revision, completedDocumentIds: ["project.md", "stack.md"],
      baseline: baseline(), lastCompletedAt: "2026-01-01T00:01:00.000Z" });
    expect(ready).toMatchObject({ state: "ready", currentStage: "complete", completedDocumentIds: ["project.md", "stack.md"] });
    expect(ready.designChoice).toBeUndefined();
    expect(() => c.snoozeProjectOnboarding({ expectedRevision: ready.revision, sessionMarker: "later" })).toThrow(/transition/);
    const audit = c.digest(undefined, 0).events.filter((event) => event.type.startsWith("onboarding."));
    expect(audit.map((event) => event.type)).toEqual(["onboarding.began", "onboarding.updated", "onboarding.ready"]);
    expect(JSON.stringify(audit)).not.toContain(secret);
    expect(JSON.stringify(audit)).not.toContain(ready.baseline!.sources[0]!.sha256);
    expect(JSON.stringify(audit)).not.toContain(ready.baseline!.sources[0]!.path);
    expect(audit.every((event) => event.entityId === "project-onboarding" && event.planId === null)).toBe(true);
  });

  it("persists ready to incremental refresh lifecycle without discarding prior mapping data", () => {
    const c = core(), begun = c.beginProjectOnboarding({ expectedRevision: 0,
      persistenceChoices: { sharedDocuments: true, privatePreferences: true } });
    const answered = c.updateProjectOnboarding({ expectedRevision: begun.revision, currentStage: "review",
      businessAnswers: [{ id: "market", answer: "teams" }], privatePreferences: [{ id: "tone", answer: "direct" }] });
    const ready = c.markProjectOnboardingReady({ expectedRevision: answered.revision, completedDocumentIds: ["project.md", "stack.md"],
      baseline: baseline(), lastCompletedAt: "2026-01-01T00:01:00.000Z" });
    const refreshing = c.refreshProjectOnboarding({ expectedRevision: ready.revision, mode: "incremental",
      selectedFocuses: ["tech", "quality"], scopePaths: ["src/index.ts"] });
    expect(refreshing).toMatchObject({ state: "active", currentStage: "mapping", mappingMode: "incremental",
      selectedFocuses: ["tech", "quality"], scopePaths: ["src/index.ts"], completedDocumentIds: ["project.md"],
      baseline: ready.baseline, lastCompletedAt: ready.lastCompletedAt, businessAnswers: answered.businessAnswers,
      privatePreferences: answered.privatePreferences, persistenceChoices: answered.persistenceChoices });
    expect(() => c.refreshProjectOnboarding({ expectedRevision: ready.revision, mode: "incremental", selectedFocuses: [], scopePaths: [] })).toThrow(/revision conflict/);
    const replacement = baseline("2026-01-02T00:00:00.000Z");
    replacement.sources[0]!.sha256 = "e".repeat(64);
    const completed = c.markProjectOnboardingReady({ expectedRevision: refreshing.revision, completedDocumentIds: ["stack.md"],
      baseline: replacement, lastCompletedAt: "2026-01-02T00:01:00.000Z" });
    expect(completed).toMatchObject({ state: "ready", mappingMode: "incremental", completedDocumentIds: ["stack.md"],
      baseline: replacement, lastCompletedAt: "2026-01-02T00:01:00.000Z" });
    expect(c.digest(undefined, 0).events.filter((event) => event.type.startsWith("onboarding.")).map((event) => event.type))
      .toEqual(["onboarding.began", "onboarding.updated", "onboarding.ready", "onboarding.refreshed", "onboarding.ready"]);
  });

  it("rejects invalid mapping modes, focuses, scopes and baselines", () => {
    const c = core(), begun = c.beginProjectOnboarding({ expectedRevision: 0,
      persistenceChoices: { sharedDocuments: true, privatePreferences: false } });
    expect(() => c.updateProjectOnboarding({ expectedRevision: begun.revision, mappingMode: "partial" as never })).toThrow();
    expect(() => c.updateProjectOnboarding({ expectedRevision: begun.revision, selectedFocuses: ["tech", "tech"] })).toThrow(/Duplicate/);
    expect(() => c.updateProjectOnboarding({ expectedRevision: begun.revision, selectedFocuses: ["security"] as never })).toThrow();
    expect(() => c.updateProjectOnboarding({ expectedRevision: begun.revision, scopePaths: ["../outside"] })).toThrow(/safe project-relative/);
    expect(() => c.updateProjectOnboarding({ expectedRevision: begun.revision, scopePaths: ["src/**", "src/**"] })).toThrow(/Duplicate/);
    expect(() => c.markProjectOnboardingReady({ expectedRevision: begun.revision, completedDocumentIds: ["stack.md"], baseline: {
      ...baseline(), sources: [{ path: "/absolute", sha256: "d".repeat(64), documentIds: ["stack.md"] }],
    }, lastCompletedAt: "2026-01-01T00:01:00.000Z" })).toThrow(/safe project-relative/);
    expect(c.getProjectOnboarding().revision).toBe(begun.revision);
  });

  it("runs inspection operations through the engine without replacing or exposing a user plan", () => {
    const c = core(), p = c.createPlan(draft());
    c.bindPlanSession(p.id, "primary");
    const input = { objective: "Explain the source layout" };
    const op = c.createOperation(input, "primary", "request-1");
    expect(op).toMatchObject({ objective: input.objective, mode: "inspect", status: "active", taskId: "work" });
    expect(c.readOnly().operationForSession("primary")).toEqual(op);
    expect(c.readOnly().isInspection(op.id)).toBe(true);
    expect(c.isInspection(p.id)).toBe(false);
    expect(c.planForSession("primary")?.id).toBe(p.id);
    expect(c.listPlans().map(p => p.id)).toEqual([p.id]);
    expect(c.digest().plans.map(p => p.id)).toEqual([p.id]);
    expect(c.getPlan(op.id).tasks[0]).toMatchObject({ role: "executor", reads: ["**"], writes: [], checks: [], acceptance: ["done"] });
    expect(() => c.revisePlan(op.id, 1, draft(), "revise")).toThrow(/explicit operations/);
    expect(() => c.proposePlan(proposal(), "primary", op.id, 1)).toThrow(/explicit operations/);
    expect(() => c.bindPlanSession(op.id, "primary")).toThrow(/explicit operations/);
    complete(c, op.id);
    expect(c.getOperation(op.id).status).toBe("succeeded");
    expect(c.createOperation(input, "primary", "request-1")).toEqual(c.getOperation(op.id));
    expect(c.createOperation(input, "primary")).toEqual(c.getOperation(op.id));
    expect(c.readyTasks(op.id)).toEqual([]);
    expect(c.listAttempts(op.id)).toHaveLength(1);
    expect(() => c.createOperation({ objective: "Different" }, "primary", "request-1")).toThrow(/conflict/);
    expect(() => c.createOperation(input, "other", "request-1")).toThrow(/conflict/);
  });

  it("persists operation identity, isolates roots and derives terminal states from the engine", () => {
    const dir = mkdtempSync(join(tmpdir(), "v2-operations-")); directories.push(dir);
    const db = join(dir, "store.sqlite"), c = core("/project", db);
    const op = c.createOperation({ objective: "Check types", mode: "verify", checks: [{ id: "types", command: "tsc --noEmit" }] }, "primary");
    expect(c.isInspection(op.id)).toBe(false);
    const attempt = start(c, op.id);
    c.failAttempt(attempt, "Failed verification", false);
    const reopened = core("/project", db);
    expect(reopened.operationForSession("primary")).toMatchObject({ id: op.id, status: "failed" });
    expect(reopened.listPlans()).toEqual([]);
    const other = core("/other", db);
    expect(other.operationForSession("primary")).toBeUndefined();
    expect(() => other.getOperation(op.id)).toThrow(/Unknown operation/);
    const change = c.createOperation({ objective: "Update source", mode: "change", writes: ["src/**"] }, "primary");
    c.cancelPlan(change.id);
    expect(c.getOperation(change.id).status).toBe("cancelled");
    expect(c.planForSession("primary")).toBeUndefined();
  });

  it("rejects unscoped requests before allocating any work", () => {
    const c = core(), d = draft();
    d.tasks[0]!.reads = []; d.tasks[0]!.instructions = "Inspect the project";
    expect(() => c.createPlan(d)).toThrow(/explicit reads/);
    expect(() => c.createOperation({ objective: "Inspect", reads: [] }, "primary")).toThrow(/scope/);
    expect(c.listPlans()).toEqual([]);
    expect(c.listAttempts()).toEqual([]);
    expect(c.operationForSession("primary")).toBeUndefined();
  });

  it("requires normal named-check and integration evidence for verify and change operations", () => {
    const c = core();
    const verify = c.createOperation({ objective: "Verify source", mode: "verify", reads: ["src/**"], checks: [{ id: "test", command: "npm test" }] }, "primary");
    const attempt = start(c, verify.id);
    const evidence = c.recordEvidence(attempt, { kind: "command", checkId: "test", command: "npm test", exitCode: 0, durationMs: 100, summary: "Tests passed", snapshotId: "baseline" });
    c.submitResult(attempt, result([evidence.id])); c.acceptAttempt(attempt);
    expect(c.getOperation(verify.id).status).toBe("succeeded");
    const change = c.createOperation({ objective: "Update source", mode: "change", writes: ["src/**"] }, "primary");
    const writer = start(c, change.id);
    c.submitResult(writer, result([inspection(c, writer)]));
    expect(() => c.acceptAttempt(writer)).toThrow(/integratedSnapshotId/);
    c.acceptAttempt(writer, { integratedSnapshotId: "integrated" });
    expect(c.getOperation(change.id).status).toBe("succeeded");
    expect(c.operationForSession("primary")?.id).toBe(change.id);
    expect(c.listPlans()).toEqual([]);
    expect(c.digest().plans).toEqual([]);
  });
  it("keeps large accepted dependency results recoverable through bounded lossless pages", () => {
    const c = core(), d = parallel([task("up"), task("other"), task("down", { dependsOn: ["up"] })]);
    d.tasks[2]!.sourceIds = ["source"];
    d.constraints = ["Keep exact acceptance"];
    d.sources = [{ id: "source", path: "src/example.ts", reason: "Required source" }];
    const p = c.createPlan(d), up = start(c, p.id, "up");
    const full = result([inspection(c, up)]);
    full.summary = "界".repeat(4000);
    full.next = "Follow through";
    full.findings = Array.from({ length: 32 }, (_, i) => ({ statement: `${i}:` + "界".repeat(1990), source: "界".repeat(512), kind: "fact" as const }));
    full.artifacts = ["src/example.ts"];
    expect(Buffer.byteLength(JSON.stringify(full))).toBeGreaterThan(32768);
    c.submitResult(up, full); c.acceptAttempt(up);
    const other = complete(c, p.id, "other"), down = lease(c, p.id, "down");
    const packet = c.assignment(down);
    expect(Buffer.byteLength(JSON.stringify(packet))).toBeLessThanOrEqual(32768);
    expect(packet.dependencies[0]?.summary.length).toBe(240);
    expect(packet.dependencyRefs).toEqual([{ taskId: "up", attemptId: up, resultRef: up }]);
    expect(packet.dependencies[0]).not.toHaveProperty("result");
    expect(packet.acceptance).toEqual(d.acceptance);
    expect(packet.constraints).toEqual(d.constraints);
    expect(packet.sources).toEqual(d.sources);
    for (const section of ["summary", "findings", "criteria", "artifacts", "blockers"] as const) {
      const restored: unknown[] = [], fragments = new Map<number, string[]>();
      let offset = 0;
      for (;;) {
        const page = c.readOnly().dependencyResult(down, up, { section, offset });
        expect(Buffer.byteLength(JSON.stringify(page))).toBeLessThanOrEqual(8192);
        expect(c.dependencyResult(down, up, { section, offset })).toEqual(page);
        for (const item of page.items) {
          if ("value" in item) restored[item.itemIndex] = item.value;
          else {
            const parts = fragments.get(item.itemIndex) ?? [];
            expect(parts[item.part]).toBeUndefined();
            parts[item.part] = item.json; fragments.set(item.itemIndex, parts);
            if (item.part === item.parts - 1) restored[item.itemIndex] = JSON.parse(parts.join(""));
          }
        }
        if (page.nextOffset === undefined) break;
        expect(page.nextOffset).toBeGreaterThan(offset); offset = page.nextOffset;
      }
      expect(restored).toEqual(section === "summary" ? [{ schemaVersion: 2, outcome: full.outcome, summary: full.summary, next: full.next }] : full[section]);
    }
    expect(() => c.dependencyResult(down, other, { section: "summary" })).toThrow(/unrelated/);
    expect(() => c.dependencyResult(down, "unknown", { section: "summary" })).toThrow(/Unknown/);
    expect(() => c.dependencyResult(down, up, { section: "findings", offset: -1 })).toThrow(/offset/);
    c.failAttempt(down, "retry", true);
    expect(() => c.dependencyResult(down, up, { section: "summary" })).toThrow(/state/);
  });

  it("retains all direct refs with bounded summaries at maximum fan-in", () => {
    const c = core(), parents = Array.from({ length: 63 }, (_, i) => task(`parent-${i}`));
    const p = c.createPlan(parallel([...parents, task("join", { dependsOn: parents.map(task => task.id) })]));
    for (const parent of parents) complete(c, p.id, parent.id);
    const packet = c.assignmentForTask(p.id, "join");
    expect(packet.dependencies).toHaveLength(8);
    expect(packet.dependencyRefs).toHaveLength(63);
    expect(packet.dependencySummariesOmitted).toBe(55);
    expect(Buffer.byteLength(JSON.stringify(packet))).toBeLessThanOrEqual(32768);
  });

  it("invalidates completed tasks and descendants for new scoped material proposal answers, preserving unrelated work", () => {
    const c = core();
    const d = parallel([task("affected"), task("descendant", { dependsOn: ["affected"] }), task("unrelated")]);
    const p = c.createPlan(d);
    complete(c, p.id, "affected"); complete(c, p.id, "descendant"); complete(c, p.id, "unrelated");
    expect(c.getPlan(p.id).status).toBe("succeeded");
    const proposed = c.proposePlan(proposal({ plan: d, questions: [question({ planId: p.id, taskIds: ["affected"] })] }), "parent", p.id, 1);
    const answers = ["  Use the corrected interpretation  "];
    c.answerQuestion(proposed.questionIds[0]!, answers);
    c.refineProposal(proposed.id, proposal({ plan: d, addressedQuestionIds: proposed.questionIds }));
    const revised = c.applyProposal(proposed.id);
    expect(revised.draft).toEqual(p.draft);
    expect(revised.tasks.map((task) => task.status)).toEqual(["queued", "queued", "succeeded"]);
    expect(revised.status).toBe("active");
    const a = lease(c, p.id, "affected");
    expect(c.assignment(a).answeredQuestions[0]?.answers).toEqual(answers);
    expect(c.getRevision(p.id, 1).draft).toEqual(d);
    expect(c.applyProposal(proposed.id).revision).toBe(2);
  });

  it("invalidates all completed work for newly linked unscoped material answers", () => {
    const c = core(), d = parallel([task("a"), task("b")]), p = c.createPlan(d);
    complete(c, p.id, "a"); complete(c, p.id, "b");
    const proposed = c.proposePlan(proposal({ plan: d, questions: [question()] }), "parent", p.id, 1);
    c.answerQuestion(proposed.questionIds[0]!, ["New interpretation applies everywhere"]);
    c.refineProposal(proposed.id, proposal({ plan: d, addressedQuestionIds: proposed.questionIds }));
    expect(c.applyProposal(proposed.id).tasks.map((task) => task.status)).toEqual(["queued", "queued"]);
  });

  it("retains scoped successful work when proposal answers are explicitly nonmaterial", () => {
    const c = core(), d = draft(), p = c.createPlan(d);
    complete(c, p.id);
    const proposed = c.proposePlan(proposal({ plan: d, questions: [question({ planId: p.id, taskIds: ["work"], material: false })] }), "parent", p.id, 1);
    c.answerQuestion(proposed.questionIds[0]!, ["Informational only"]);
    c.refineProposal(proposed.id, proposal({ plan: d, addressedQuestionIds: proposed.questionIds }));
    expect(c.applyProposal(proposed.id).status).toBe("succeeded");
  });

  it("settles exhausted running budgets as failed and gives revisions an explicit fresh duration budget", () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    const c = core(), d = parallel([task("a"), task("b")]); d.budgets.maxDurationMs = 100;
    const p = c.createPlan(d), a = start(c, p.id, "a");
    vi.advanceTimersByTime(101);
    c.failAttempt(a, "Runner exhausted its duration allowance", true);
    expect(c.getPlan(p.id).status).toBe("failed");
    expect(c.readyTasks(p.id)).toEqual([]);
    expect(c.runningDurationMs(p.id)).toBe(101);
    const revised = c.revisePlan(p.id, 1, d, "Explicit new execution budget");
    expect(revised.status).toBe("active");
    expect(c.runningDurationMs(p.id)).toBe(0);
    expect(c.getAttempt(a).runningDurationMs).toBe(101);
    expect(c.readyTasks(p.id).map((task) => task.id)).toEqual(["a", "b"]);
    const retry = start(c, p.id, "a"); vi.advanceTimersByTime(20);
    c.submitResult(retry, result([inspection(c, retry)])); c.acceptAttempt(retry);
    expect(c.runningDurationMs(p.id)).toBe(20);
    expect(c.readyTasks(p.id).map((task) => task.id)).toEqual(["b"]);
  });

  it.each(["leased", "running", "submitted"] as const)("retains %s reservations until cancellation receives stopped-worker confirmation", (status) => {
    const c = core(), p = c.createPlan(draft(false)), id = lease(c, p.id);
    if (status !== "leased") c.startAttempt(id, "worker");
    if (status === "submitted") c.submitResult(id, result([inspection(c, id)]));
    const other = c.createPlan(draft(false));
    const before = c.getAttempt(id), cursor = c.digest(p.id).cursor;
    expect(() => c.cancelPlan(p.id)).toThrow(/workersStopped/);
    expect(() => c.cancelPlan(p.id, { workersStopped: false })).toThrow(/workersStopped/);
    expect(c.getAttempt(id)).toEqual(before);
    expect(c.getPlan(p.id).status).toBe("active");
    expect(c.digest(p.id).cursor).toBe(cursor);
    expect(() => lease(c, other.id)).toThrow(/reservation/);
    expect(c.cancelPlan(p.id, { workersStopped: true }).status).toBe("cancelled");
    expect(c.getAttempt(id).status).toBe("cancelled");
    expect(lease(c, other.id)).toBeTypeOf("string");
    expect(c.cancelPlan(p.id).status).toBe("cancelled");
  });

  it("reports paused and material-question acceptance as typed deferrals without mutations", () => {
    const c = core(), p = c.createPlan(draft()), id = start(c, p.id);
    c.submitResult(id, result([inspection(c, id)]));
    c.pausePlan(p.id);
    const before = c.getAttempt(id), cursor = c.digest(p.id).cursor;
    expect(() => c.validateAcceptance(id)).toThrow(DeferredAcceptanceError);
    expect(() => c.acceptAttempt(id)).toThrow(DeferredAcceptanceError);
    try { c.acceptAttempt(id); } catch (error) {
      expect(error).toMatchObject({ code: "ACCEPTANCE_DEFERRED", reason: "paused", attemptId: id });
    }
    expect(c.getAttempt(id)).toEqual(before);
    expect(c.digest(p.id).cursor).toBe(cursor);
    c.resumePlan(p.id);
    c.requestQuestion(question({ planId: p.id, taskIds: ["work"] }));
    expect(() => c.validateAcceptance(id)).toThrow(DeferredAcceptanceError);
    try { c.validateAcceptance(id); } catch (error) {
      expect(error).toMatchObject({ reason: "pending_question", attemptId: id });
    }
    c.answerQuestion("direction", ["A"]);
    expect(() => c.validateAcceptance(id)).not.toThrow();
    c.acceptAttempt(id);
  });
  it("exposes a read-only actor through trusted method selection, not mutation arguments", () => {
    const c = core(), p = c.proposePlan(proposal(), "parent"), actor = c.readOnly();
    expect(actor.latestProposalForSession("parent")).toEqual(p);
    expect(Object.isFrozen(actor)).toBe(true);
    expect("applyProposal" in actor).toBe(false);
    expect("refineProposal" in actor).toBe(false);
    expect("recoverLeasedOrphans" in actor).toBe(false);
    const snapshot = actor.getProposal(p.id); snapshot.reason = "Local mutation";
    expect(actor.getProposal(p.id).reason).toBe(p.reason);
  });

  it("blocks all plan tasks for unscoped material questions, including dispatch and acceptance", () => {
    const c = core(), p = c.createPlan(parallel([task("a"), task("b")]));
    const a = start(c, p.id, "a"), b = lease(c, p.id, "b");
    c.requestQuestion(question({ planId: p.id }));
    expect(() => c.startAttempt(b, "b-session")).toThrow(/blocked/);
    c.submitResult(a, result([inspection(c, a)]));
    expect(() => c.acceptAttempt(a)).toThrow(/blocked/);
    c.answerQuestion("direction", ["A"]);
    c.acceptAttempt(a); c.startAttempt(b, "b-session");
    expect(c.getAttempt(b).status).toBe("running");
  });

  it("separates submitted results from trusted acceptance and requires writer integration", () => {
    const c = core(), plan = c.createPlan(draft(false));
    const id = start(c, plan.id), submitted = result([inspection(c, id)]);
    c.submitResult(id, submitted);
    expect(c.getPlan(plan.id).status).toBe("active");
    expect(c.getAttempt(id).status).toBe("submitted");
    expect(() => c.acceptAttempt(id)).toThrow(/integratedSnapshotId/);
    c.acceptAttempt(id, { integratedSnapshotId: "merged-snapshot" });
    expect(c.getPlan(plan.id).status).toBe("succeeded");
    expect(c.getAttempt(id).integratedSnapshotId).toBe("merged-snapshot");
    expect(c.submitResult(id, submitted).status).toBe("succeeded");
  });

  it("makes creation and identical submissions idempotent, rejects changed duplicates and stale results", () => {
    const c = core(), plan = c.createPlan(draft(), "request-1");
    expect(c.createPlan(draft(), "request-1").id).toBe(plan.id);
    expect(() => c.createPlan({ ...draft(), title: "Different" }, "request-1")).toThrow(/conflict/);
    const id = start(c, plan.id), submitted = result([inspection(c, id)]);
    c.submitResult(id, submitted);
    const cursor = c.digest(plan.id).cursor;
    expect(c.submitResult(id, submitted).status).toBe("submitted");
    expect(c.digest(plan.id).cursor).toBe(cursor);
    expect(() => c.submitResult(id, { ...submitted, summary: "changed" })).toThrow(/duplicate/);
    c.acceptAttempt(id);
    c.revisePlan(plan.id, 1, { ...draft(), objective: "Changed objective" }, "New scope");
    expect(() => c.submitResult(id, submitted)).toThrow(/Stale/);
  });

  it("enforces revision CAS and preserves only unchanged succeeded dependency closures", () => {
    const c = core();
    const original = parallel([task("a"), task("b", { dependsOn: ["a"] }), task("c", { dependsOn: ["b"] }), task("independent")]);
    const plan = c.createPlan(original);
    complete(c, plan.id, "a"); complete(c, plan.id, "b"); complete(c, plan.id, "independent");
    const change = { ...original, tasks: original.tasks.map((task) => task.id === "a" ? { ...task, instructions: "New approach" } : task) };
    const revised = c.revisePlan(plan.id, 1, change, "Change upstream implementation");
    expect(revised.revision).toBe(2);
    expect(revised.tasks.map((task) => task.status)).toEqual(["queued", "queued", "queued", "succeeded"]);
    expect(() => c.revisePlan(plan.id, 1, change, "stale write")).toThrow(/Revision conflict/);
    lease(c, plan.id, "a");
    expect(() => c.revisePlan(plan.id, 2, change, "during lease")).toThrow(/active attempts/);
    expect(c.getPlan(plan.id).revision).toBe(2);
  });

  it("bounds retries, rejects late results and never duplicates a live task lease", () => {
    const c = core(), plan = c.createPlan(draft());
    const first = start(c, plan.id);
    expect(() => lease(c, plan.id)).toThrow(/not ready/);
    c.failAttempt(first, "Temporary failure", true);
    expect(c.readyTasks(plan.id).map((task) => task.id)).toEqual(["work"]);
    const second = start(c, plan.id);
    expect(() => c.submitResult(first, { ...result(), criteria: [] })).toThrow(/state/);
    c.failAttempt(second, "Still failing", true);
    expect(c.getPlan(plan.id).status).toBe("failed");
    expect(c.readyTasks(plan.id)).toEqual([]);
    expect(() => lease(c, plan.id)).toThrow(/not ready/);
  });

  it("rejects missing evidence, cross-attempt references, unknown criteria and failed evidence", () => {
    const c = core(), plan = c.createPlan(parallel([task("a"), task("b")]));
    const a = start(c, plan.id, "a"), b = start(c, plan.id, "b");
    const ev = inspection(c, a);
    expect(() => c.submitResult(a, result())).toThrow(/requires evidence/);
    expect(() => c.submitResult(b, result([ev]))).toThrow(/provenance/);
    expect(() => c.submitResult(a, { ...result([ev]), criteria: [{ id: "outside", status: "satisfied", evidenceRefs: [ev] }] })).toThrow(/outside/);
    expect(() => c.recordEvidence(a, { kind: "inspection", summary: "wrong baseline", snapshotId: "other" })).toThrow(/baseline/);
    const failed = c.recordEvidence(a, { kind: "command", command: "false", exitCode: 1, durationMs: 2, summary: "failed check", snapshotId: "baseline" });
    expect(() => c.submitResult(a, result([failed.id]))).toThrow(/Failed evidence/);
    c.submitResult(a, { ...result(), criteria: [] });
    expect(() => c.acceptAttempt(a)).toThrow(/coverage/);
  });

  it("requires named check coverage, not a count of arbitrary successful commands", () => {
    const c = core(), d = draft();
    d.tasks[0]!.checks = [{ id: "test", command: "npm test", timeoutMs: 1000 }];
    const p = c.createPlan(d), id = start(c, p.id);
    expect(() => c.recordEvidence(id, { checkId: "test", kind: "command", command: "true", exitCode: 0, durationMs: 1, summary: "not the check", snapshotId: "baseline" })).toThrow(/mismatched/);
    c.recordEvidence(id, { checkId: "test", kind: "command", command: "npm test", exitCode: 1, durationMs: 10, summary: "test failure", snapshotId: "baseline" });
    const unrelated = c.recordEvidence(id, { kind: "command", command: "true", exitCode: 0, durationMs: 1, summary: "irrelevant success", snapshotId: "baseline" });
    c.submitResult(id, result([unrelated.id]));
    expect(() => c.acceptAttempt(id)).toThrow(/check coverage/);
    c.failAttempt(id, "Re-run checks", true);
    const retry = start(c, p.id);
    const passing = c.recordEvidence(retry, { checkId: "test", kind: "command", command: "npm test", exitCode: 0, durationMs: 10, summary: "all pass", snapshotId: "baseline" });
    c.submitResult(retry, result([passing.id])); c.acceptAttempt(retry);
    expect(c.getPlan(p.id).status).toBe("succeeded");
  });

  it("does not allow a later failed named check to hide behind earlier passing evidence", () => {
    const c = core(), d = draft(); d.tasks[0]!.checks = [{ id: "test", command: "verify" }];
    const p = c.createPlan(d), id = start(c, p.id);
    const passing = c.recordEvidence(id, { kind: "command", checkId: "test", command: "verify", exitCode: 0, durationMs: 1, snapshotId: "baseline", summary: "passed earlier" });
    c.recordEvidence(id, { kind: "command", checkId: "test", command: "verify", exitCode: 1, durationMs: 1, snapshotId: "baseline", summary: "now fails" });
    c.submitResult(id, result([passing.id]));
    expect(() => c.acceptAttempt(id)).toThrow(/failed check/);
  });

  it("persists questions, gates only linked material tasks, answers once, and bounds pending batches", () => {
    const c = core(), p = c.createPlan(parallel([task("a"), task("b")]));
    const q = { id: "direction", planId: p.id, taskIds: ["a"], header: "Direction", question: "Choose direction", options: [{ label: "A", description: "First" }], multiple: false, reason: "Acceptance depends on it", material: true };
    c.requestQuestion(q);
    expect(c.readyTasks(p.id).map((task) => task.id)).toEqual(["b"]);
    c.requestQuestion({ ...q, id: "info", taskIds: ["b"], material: false });
    c.requestQuestion({ ...q, id: "third", taskIds: [] });
    expect(() => c.requestQuestion({ ...q, id: "fourth" })).toThrow(/three/);
    expect(c.getPlan(p.id).status).toBe("active");
    expect(c.answerQuestion(q.id, [["Custom native answer"]]).answers).toEqual(["Custom native answer"]);
    expect(() => c.answerQuestion(q.id, ["A"])).toThrow(/already answered/);
    expect(c.readyTasks(p.id)).toEqual([]);
    c.answerQuestion("third", ["A"]);
    expect(c.readyTasks(p.id).map((task) => task.id)).toEqual(["a", "b"]);
    expect(c.pendingQuestions(p.id)).toHaveLength(1);
  });

  it("blocks acceptance for a question added during execution, and cancellation releases leases", () => {
    const c = core(), p = c.createPlan(draft(false)), id = start(c, p.id);
    c.requestQuestion({ id: "q", planId: p.id, taskIds: ["work"], header: "Scope", question: "Include this?", options: [{ label: "yes", description: "Include" }], multiple: false, reason: "New decision", material: true });
    c.submitResult(id, result([inspection(c, id)]));
    expect(() => c.acceptAttempt(id, { integratedSnapshotId: "merged" })).toThrow(/blocked/);
    expect(() => c.cancelPlan(p.id)).toThrow(/workersStopped/);
    c.cancelPlan(p.id, { workersStopped: true });
    expect(c.getAttempt(id).status).toBe("cancelled");
    expect(c.pendingQuestions(p.id)).toEqual([]);
    expect(() => c.answerQuestion("q", ["yes"])).toThrow(/cancelled/);
    expect(lease(c, c.createPlan(draft(false)).id)).toBeTypeOf("string");
  });

  it("enforces project-wide resource and shared path reservations, but allows readers and isolated writers", () => {
    const c = core();
    const reader1 = c.createPlan(draft()), reader2 = c.createPlan(draft());
    const r1 = lease(c, reader1.id), r2 = lease(c, reader2.id);
    const writer = c.createPlan(draft(false));
    expect(() => lease(c, writer.id)).toThrow(/reservation/);
    c.failAttempt(r1, "done", false); c.failAttempt(r2, "done", false);
    const w1 = lease(c, writer.id, "work", true, "/worktrees/one");
    const writer2 = c.createPlan(draft(false));
    expect(() => lease(c, writer2.id, "work", true, "/worktrees/one")).toThrow(/reservation/);
    const w2 = lease(c, writer2.id, "work", true, "/worktrees/two");
    expect(w2).not.toBe(w1);
    const resourcePlan = parallel([task("one", { reads: ["src/one.ts"], resources: ["simulator"] }), task("two", { reads: ["src/two.ts"], resources: ["simulator"] })]);
    const rp = c.createPlan(resourcePlan);
    lease(c, rp.id, "one", true, "/worktrees/three");
    expect(() => lease(c, rp.id, "two", true, "/worktrees/four")).toThrow(/Resource/);
  });

  it("holds reservations through submission and handles glob and directory overlap conservatively", () => {
    const c = core(), p = c.createPlan(parallel([task("a", { writes: ["src/lib"] }), task("b", { reads: ["src/lib/deep/*.ts"] })]));
    const id = start(c, p.id, "a"); c.submitResult(id, result([inspection(c, id)]));
    expect(() => lease(c, p.id, "b")).toThrow(/reservation/);
    c.acceptAttempt(id, { integratedSnapshotId: "merged" });
    expect(lease(c, p.id, "b")).toBeTypeOf("string");
  });

  it("recovers only confirmed dead sessions, never live/unknown sessions or submitted results", () => {
    const c = core(), p = c.createPlan(parallel([task("live"), task("dead"), task("unknown"), task("submitted")]));
    const live = start(c, p.id, "live"), dead = start(c, p.id, "dead"), unknown = lease(c, p.id, "unknown"), submitted = start(c, p.id, "submitted");
    c.submitResult(submitted, result([inspection(c, submitted)]));
    const recovered = c.recoverAttempts((sessionId) => sessionId !== `session-${dead}` && sessionId !== `session-${submitted}`);
    expect(recovered.recovered).toEqual([dead]);
    expect(recovered.uncertain).toEqual([live, unknown, submitted]);
    expect(c.getAttempt(dead).status).toBe("lost");
    expect(c.getPlan(p.id).tasks.find((task) => task.id === "dead")?.status).toBe("queued");
    expect(c.recoverAttempts(() => { throw new Error("unavailable"); }).recovered).toEqual([]);
  });

  it("enforces concurrency/duration budgets without inferring death from heartbeat age", () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    const c = core(), d = parallel([task("a"), task("b")]); d.budgets.maxParallel = 1; d.budgets.maxDurationMs = 100;
    const p = c.createPlan(d), id = start(c, p.id, "a");
    expect(() => lease(c, p.id, "b")).toThrow(/budget/);
    vi.advanceTimersByTime(1000);
    expect(c.recoverAttempts(() => true).uncertain).toEqual([id]);
    c.failAttempt(id, "duration elapsed", true);
    expect(c.readyTasks(p.id)).toEqual([]);
    expect(c.getPlan(p.id).tasks[0]?.status).toBe("failed");
  });

  it("gives assignments only own criteria and direct accepted dependency results, throwing on mandatory overflow", () => {
    const c = core();
    const d = planTemplates.standard({
      tasks: [task("a", { acceptance: ["first"] }), task("b", { acceptance: ["second"], dependsOn: ["a"] })],
      acceptance: [{ id: "first", description: "First criterion" }, { id: "second", description: "Second criterion" }],
    });
    const p = c.createPlan(d), a = start(c, p.id, "a"), ev = inspection(c, a);
    c.submitResult(a, { ...result(), criteria: [{ id: "first", status: "satisfied", evidenceRefs: [ev] }] }); c.acceptAttempt(a);
    const b = lease(c, p.id, "b"), packet = c.assignment(b);
    expect(packet.acceptance.map((entry) => entry.id)).toEqual(["second"]);
    expect(packet.dependencies.map((entry) => entry.taskId)).toEqual(["a"]);
    expect(packet.task.id).toBe("b");
    const huge = draft(); huge.acceptance = Array.from({ length: 20 }, (_, i) => ({ id: `criterion-${i}`, description: "x".repeat(2000) }));
    huge.tasks[0]!.acceptance = huge.acceptance.map((entry) => entry.id);
    const hp = c.createPlan(huge);
    expect(() => c.assignmentForTask(hp.id, huge.tasks[0]!.id)).toThrow(/Assignment budget/);
    expect(() => lease(c, hp.id)).toThrow(/Assignment budget/);
    expect(c.listAttempts(hp.id)).toEqual([]);
  });

  it("bounds digests to 8KB, excludes unrelated historic work, and pages events without cursor gaps", () => {
    const c = core();
    for (let i = 0; i < 35; i++) c.cancelPlan(c.createPlan({ ...draft(), title: `Historic ${i}` }).id);
    const p = c.createPlan({ ...draft(), title: "Current" }), id = start(c, p.id);
    const before = c.digest().cursor;
    for (let i = 0; i < 80; i++) c.heartbeat(id);
    const digest = c.digest();
    expect(Buffer.byteLength(JSON.stringify(digest))).toBeLessThanOrEqual(8192);
    expect(digest.plans.map((plan) => plan.title)).toEqual(["Current"]);
    expect(digest.events.every((event) => event.planId === p.id)).toBe(true);
    expect(digest.events.at(-1)?.id).toBe(digest.cursor);
    let cursor = before;
    const seen: number[] = [];
    for (;;) {
      const page = c.digest(p.id, cursor);
      expect(Buffer.byteLength(JSON.stringify(page))).toBeLessThanOrEqual(8192);
      if (!page.events.length) break;
      seen.push(...page.events.map((event) => event.id)); cursor = page.cursor;
    }
    expect(seen).toHaveLength(80);
    expect(new Set(seen).size).toBe(80);
  });

  it("preserves transaction atomicity, connection and project isolation, and revisions", () => {
    const dir = mkdtempSync(join(tmpdir(), "sol-v2-core-")); directories.push(dir);
    const path = join(dir, "state.sqlite");
    const c = core("/project", path), second = core("/project", path), foreign = core("/elsewhere", path);
    const p = c.createPlan(draft(false)); lease(c, p.id);
    expect(() => lease(second, p.id)).toThrow(/not ready/);
    expect(() => lease(second, second.createPlan(draft(false)).id)).toThrow(/reservation/);
    expect(foreign.listPlans()).toEqual([]);
    expect(() => foreign.getPlan(p.id)).toThrow(/Unknown/);
    expect(lease(foreign, foreign.createPlan(draft(false)).id)).toBeTypeOf("string");
    const before = second.digest(p.id).cursor;
    expect(() => c.revisePlan(p.id, 1, draft(false), "busy")).toThrow();
    expect(second.digest(p.id).cursor).toBe(before);
    c.cancelPlan(p.id, { workersStopped: true });
    const audit = c.createPlan(draft()); c.revisePlan(audit.id, 1, { ...draft(), title: "New" }, "rename");
    expect(c.listRevisions(audit.id)).toHaveLength(2);
  });

  it("persists explicit primary session bindings and attempt session lookup without latest-plan fallback", () => {
    const dir = mkdtempSync(join(tmpdir(), "sol-v2-session-")); directories.push(dir);
    const path = join(dir, "state.sqlite");
    const c = core("/project", path), p = c.createPlan(draft());
    c.bindPlanSession(p.id, "primary");
    const id = start(c, p.id);
    const other = c.createPlan(draft());
    const restored = core("/project", path);
    expect(restored.planForSession("primary")?.id).toBe(p.id);
    expect(restored.planForSession("unbound")).toBeUndefined();
    expect(restored.getAttemptForSession(`session-${id}`)?.id).toBe(id);
    expect(restored.getAttemptForSession("primary")).toBeUndefined();
    expect(restored.listAttempts(p.id, true).map((attempt) => attempt.id)).toEqual([id]);
    c.failAttempt(id, "done", false);
    expect(restored.listAttempts(p.id, true)).toEqual([]);
    expect(restored.listAttempts(p.id)).toHaveLength(1);
    restored.bindPlanSession(other.id, "primary");
    expect(c.planForSession("primary")?.id).toBe(other.id);
    const foreign = core("/elsewhere", path);
    expect(foreign.planForSession("primary")).toBeUndefined();
    expect(foreign.getAttemptForSession(`session-${id}`)).toBeUndefined();
  });

  it("makes question request/answer retries idempotent, retaining exact scoped answers in assignments", () => {
    const c = core(), p = c.createPlan(parallel([task("a"), task("b")]));
    const q = question({ planId: p.id, taskIds: ["a"] });
    c.requestQuestion(q);
    const requestedCursor = c.digest(p.id).cursor;
    expect(c.requestQuestion(q)).toEqual(c.getQuestion(q.id));
    expect(c.digest(p.id).cursor).toBe(requestedCursor);
    expect(() => c.requestQuestion({ ...q, material: false })).toThrow(/payload conflict/);
    const answers = ["  Exact human wording\nwith spacing  "];
    const answered = c.answerQuestion(q.id, answers);
    const answeredCursor = c.digest(p.id).cursor;
    expect(c.answerQuestion(q.id, [answers])).toEqual(answered);
    expect(c.requestQuestion(q)).toEqual(answered);
    expect(c.digest(p.id).cursor).toBe(answeredCursor);
    expect(() => c.answerQuestion(q.id, ["different"])).toThrow(/differently/);
    expect(c.listQuestions(p.id)).toEqual([answered]);
    expect(c.assignment(lease(c, p.id, "a")).answeredQuestions[0]?.answers).toEqual(answers);
    expect(c.assignment(lease(c, p.id, "b")).answeredQuestions).toEqual([]);
  });

  it("persists planner artifacts, questions and exact answers, applies atomically and binds the parent session", () => {
    const dir = mkdtempSync(join(tmpdir(), "sol-v2-proposal-")); directories.push(dir);
    const path = join(dir, "state.sqlite");
    const c = core("/project", path);
    const proposed = c.proposePlan(proposal({ questions: [question()] }), "parent");
    expect(c.listPlans()).toEqual([]);
    expect(proposed.questionIds[0]).toMatch(new RegExp(`^${proposed.id}:`));
    expect(() => c.applyProposal(proposed.id)).toThrow(/unanswered/);
    const restored = core("/project", path);
    expect(restored.getProposal(proposed.id)).toEqual(proposed);
    expect(restored.proposalQuestions(proposed.id)).toHaveLength(1);
    restored.answerQuestion(proposed.questionIds[0]!, [["Use the small implementation"]]);
    expect(() => restored.applyProposal(proposed.id)).toThrow(/refined/);
    restored.refineProposal(proposed.id, proposal({ plan: { ...draft(), objective: "Use the small implementation" }, addressedQuestionIds: proposed.questionIds }));
    const applied = restored.applyProposal(proposed.id);
    expect(c.getProposal(proposed.id)).toMatchObject({ status: "applied", planId: applied.id, appliedRevision: 1 });
    expect(c.planForSession("parent")?.id).toBe(applied.id);
    expect(c.applyProposal(proposed.id).id).toBe(applied.id);
    expect(c.listPlans()).toHaveLength(1);
    const packet = c.assignment(lease(c, applied.id));
    expect(packet.answeredQuestions[0]?.answers).toEqual(["Use the small implementation"]);
    expect(c.listQuestions(applied.id)[0]?.status).toBe("answered");
  });

  it("applies technical proposals without confirmation, rejects no-plan proposals and protects revision CAS", () => {
    const c = core();
    const initial = c.proposePlan(proposal(), "parent");
    const p = c.applyProposal(initial.id);
    const next = { ...draft(), title: "Revised", sourceMessageRefs: ["opaque:message:123"] };
    const revision = c.proposePlan(proposal({ plan: next }), "parent", p.id, 1);
    const stale = c.proposePlan(proposal({ plan: { ...draft(), title: "Other" } }), "parent", p.id, 1);
    expect(c.applyProposal(revision.id).revision).toBe(2);
    expect(c.getRevision(p.id, 1).draft.title).toBe(p.draft.title);
    expect(c.getRevision(p.id, 2).draft.sourceMessageRefs).toEqual(["opaque:message:123"]);
    expect(c.listRevisions(p.id).map((entry) => entry.revision)).toEqual([2, 1]);
    expect(() => c.applyProposal(stale.id)).toThrow(/Revision conflict/);
    expect(c.getProposal(stale.id).status).toBe("proposed");
    const noPlan = c.proposePlan({ schemaVersion: 2, summary: "Need clarification", questions: [], reason: "Not enough scope" }, "parent");
    expect(() => c.applyProposal(noPlan.id)).toThrow(/no plan/);
    expect(() => c.proposePlan(proposal(), "parent", p.id)).toThrow(/together/);
  });

  it("refines questions-only proposals durably, preserves exact answers and requires fresh complete acknowledgments", () => {
    const dir = mkdtempSync(join(tmpdir(), "sol-v2-refine-")); directories.push(dir);
    const path = join(dir, "state.sqlite"), c = core("/project", path);
    const p = c.proposePlan(proposal({ plan: undefined, questions: [question()] }), "parent");
    expect(c.latestProposalForSession("missing")).toBeUndefined();
    expect(() => c.refineProposal(p.id, proposal({ addressedQuestionIds: p.questionIds }))).toThrow(/answered/);
    const exact = ["  Custom answer\nretain whitespace  "];
    c.answerQuestion(p.questionIds[0]!, exact);
    expect(() => c.refineProposal(p.id, proposal({ addressedQuestionIds: ["direction"] }))).toThrow(/exact/);
    const refined = c.refineProposal(p.id, proposal({ addressedQuestionIds: p.questionIds,
      questions: [question({ id: "duplicate" }), question({ id: "extra", question: "Which additional constraint?" })] }));
    expect(refined.revision).toBe(2);
    expect(refined.questionIds).toHaveLength(2);
    expect(refined.questionIds[0]).toBe(p.questionIds[0]);
    expect(c.pendingQuestions()).toHaveLength(1);
    expect(() => c.applyProposal(p.id)).toThrow(/unanswered/);
    c.answerQuestion(refined.questionIds[1]!, ["Additional constraint"]);
    expect(() => c.applyProposal(p.id)).toThrow(/refined/);
    c.refineProposal(p.id, proposal()); // Omitting acknowledgment must not retain an earlier one.
    expect(() => c.applyProposal(p.id)).toThrow(/refined/);
    const final = c.refineProposal(p.id, proposal({ addressedQuestionIds: [...refined.questionIds].reverse() }));
    const restored = core("/project", path);
    expect(restored.latestProposalForSession("parent")).toEqual(final);
    expect(core("/elsewhere", path).latestProposalForSession("parent")).toBeUndefined();
    expect(restored.proposalQuestions(p.id)[0]?.answers).toEqual(exact);
    const applied = restored.applyProposal(p.id);
    expect(c.assignment(lease(c, applied.id)).answeredQuestions[0]?.answers).toEqual(exact);
    expect(() => c.refineProposal(p.id, proposal())).toThrow(/applied/);
    const newest = c.proposePlan(proposal(), "parent");
    expect(restored.latestProposalForSession("parent")?.id).toBe(newest.id);
  });

  it("rolls back refinement when a new question exceeds the pending budget", () => {
    const c = core(), p = c.proposePlan(proposal(), "parent");
    c.requestQuestion(question({ id: "one" })); c.requestQuestion(question({ id: "two" }));
    const before = c.digest().cursor;
    expect(() => c.refineProposal(p.id, proposal({ questions: [question({ question: "First?" }), question({ id: "second", question: "Second?" })] }))).toThrow(/three/);
    expect(c.getProposal(p.id)).toEqual(p);
    expect(c.pendingQuestions()).toHaveLength(2);
    expect(c.digest().cursor).toBe(before);
  });

  it("invalidates only affected criterion/context dependency closures", () => {
    const c = core(), d = parallel([task("a"), task("child", { dependsOn: ["a"] }), task("other")]);
    d.acceptance.push({ id: "other", description: "Unrelated criterion" });
    d.tasks[2]!.acceptance = ["other"];
    d.sources = [{ id: "selected", path: "src/a.ts", reason: "Required" }];
    d.decisions = [{ id: "selected", statement: "Required decision", source: "human" }];
    d.tasks[0]!.sourceIds = ["selected"]; d.tasks[0]!.decisionIds = ["selected"];
    const p = c.createPlan(d);
    const finish = (id: string, criterion = "done") => {
      const attempt = start(c, p.id, id), ev = inspection(c, attempt);
      c.submitResult(attempt, { ...result(), criteria: [{ id: criterion, status: "satisfied", evidenceRefs: [ev] }] }); c.acceptAttempt(attempt);
    };
    finish("a"); finish("child"); finish("other", "other");
    let changed = structuredClone(d);
    changed.title = "Metadata edit";
    changed.sources.push({ id: "unused", path: "src/unrelated.ts", reason: "New unrelated source" });
    expect(c.revisePlan(p.id, 1, changed, "Unrelated metadata").tasks.every((t) => t.status === "succeeded")).toBe(true);
    changed.acceptance[0]!.description = "Changed criterion";
    expect(c.revisePlan(p.id, 2, changed, "Criterion edit").tasks.map((t) => t.status)).toEqual(["queued", "queued", "succeeded"]);
    finish("a"); finish("child");
    changed = structuredClone(changed); changed.sources[0]!.reason = "Changed selected source";
    expect(c.revisePlan(p.id, 3, changed, "Selected source").tasks.map((t) => t.status)).toEqual(["queued", "queued", "succeeded"]);
    finish("a"); finish("child");
    changed = structuredClone(changed); changed.decisions[0]!.statement = "Changed selected decision";
    expect(c.revisePlan(p.id, 4, changed, "Selected decision").tasks.map((t) => t.status)).toEqual(["queued", "queued", "succeeded"]);
    finish("a"); finish("child");
    changed = { ...changed, constraints: ["Global constraint"] };
    expect(c.revisePlan(p.id, 5, changed, "Global change").tasks.every((t) => t.status === "queued")).toBe(true);
    start(c, p.id, "other");
    expect(() => c.revisePlan(p.id, 6, changed, "Unrelated running task still requires settling")).toThrow(/active attempts/);
  });

  it("recovers stale orphan leases only with trusted ownership/no-session confirmation and race checks", () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    const c = core(), p = c.createPlan(parallel([task("owned"), task("unknown"), task("racing"), task("fresh")]));
    const owned = lease(c, p.id, "owned"), unknown = lease(c, p.id, "unknown"), racing = lease(c, p.id, "racing");
    vi.advanceTimersByTime(1000);
    const fresh = lease(c, p.id, "fresh");
    const cutoff = new Date().toISOString();
    expect(c.recoverAttempts(() => false).recovered).toEqual([]);
    const recovered = c.recoverLeasedOrphans(cutoff, (attempt) => {
      if (attempt.id === racing) c.startAttempt(racing, "racing-session");
      return attempt.id !== unknown;
    });
    expect(recovered).toEqual({ recovered: [owned], uncertain: [unknown, racing] });
    expect(c.getAttempt(owned).status).toBe("lost");
    expect(c.getAttempt(racing).status).toBe("running");
    expect(c.getAttempt(fresh).status).toBe("leased");
    expect(c.readyTasks(p.id).map((t) => t.id)).toContain("owned");
    expect(c.recoverLeasedOrphans(cutoff, () => { throw new Error("unknown"); }).recovered).toEqual([]);
    expect(() => c.recoverLeasedOrphans("invalid", () => true)).toThrow(/cutoff/);
  });

  it("rolls back proposal questions/events when the pending batch budget fails midway", () => {
    const c = core();
    c.requestQuestion(question({ id: "existing1" })); c.requestQuestion(question({ id: "existing2" }));
    const cursor = c.digest().cursor;
    expect(() => c.proposePlan(proposal({ questions: [question({ id: "q1" }), question({ id: "q2" })] }), "parent")).toThrow(/three/);
    expect(c.pendingQuestions().map((question) => question.id)).toEqual(["existing1", "existing2"]);
    expect(c.digest().cursor).toBe(cursor);
    expect(() => c.proposePlan(proposal({ questions: [question({ planId: "nonexistent", taskIds: ["work"] })] }), "parent")).toThrow(/normalize/);
  });

  it("pauses dispatch and acceptance but retains reporting/recovery and idempotent resume", () => {
    const c = core(), p = c.createPlan(parallel([task("a"), task("b")]));
    const id = start(c, p.id, "a");
    c.pausePlan(p.id);
    expect(c.pausePlan(p.id).status).toBe("paused");
    expect(c.readyTasks(p.id)).toEqual([]);
    c.heartbeat(id);
    c.submitResult(id, result([inspection(c, id)]));
    expect(() => c.validateAcceptance(id)).toThrow(/paused/);
    expect(() => c.acceptAttempt(id)).toThrow(/paused/);
    expect(c.resumePlan(p.id).status).toBe("active");
    expect(c.resumePlan(p.id).status).toBe("active");
    c.acceptAttempt(id);
    expect(c.readyTasks(p.id).map((task) => task.id)).toEqual(["b"]);
    const b = start(c, p.id, "b"); c.pausePlan(p.id);
    expect(c.recoverAttempts(() => false).recovered).toEqual([b]);
    expect(c.getPlan(p.id).status).toBe("paused");
    c.resumePlan(p.id);
    expect(c.readyTasks(p.id).map((task) => task.id)).toEqual(["b"]);
  });

  it("does not charge overnight conversation, leased or submitted waits against running duration", () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    const c = core(), d = parallel([task("a"), task("b", { dependsOn: ["a"] })]); d.budgets.maxDurationMs = 100;
    const p = c.createPlan(d);
    vi.advanceTimersByTime(86_400_000);
    const a = lease(c, p.id, "a");
    vi.advanceTimersByTime(86_400_000);
    c.startAttempt(a, "a"); vi.advanceTimersByTime(30);
    c.submitResult(a, result([inspection(c, a)]));
    vi.advanceTimersByTime(86_400_000);
    c.validateAcceptance(a); c.acceptAttempt(a);
    c.pausePlan(p.id); vi.advanceTimersByTime(86_400_000); c.resumePlan(p.id);
    expect(c.runningDurationMs(p.id)).toBe(30);
    const b = start(c, p.id, "b"); vi.advanceTimersByTime(40);
    c.submitResult(b, result([inspection(c, b)])); c.acceptAttempt(b);
    expect(c.getPlan(p.id).status).toBe("succeeded");
    expect(c.runningDurationMs(p.id)).toBe(70);
  });

  it("keeps independent queued branches runnable after technical failure, settling only when work is exhausted", () => {
    const c = core(), p = c.createPlan(parallel([task("broken"), task("dependent", { dependsOn: ["broken"] }), task("independent")]));
    c.failAttempt(start(c, p.id, "broken"), "Technical blocker", false);
    expect(c.getPlan(p.id).status).toBe("active");
    expect(c.readyTasks(p.id).map((task) => task.id)).toEqual(["independent"]);
    c.requestQuestion(question({ planId: p.id, taskIds: ["independent"] }));
    expect(c.readyTasks(p.id)).toEqual([]);
    expect(c.getPlan(p.id).status).toBe("active");
    c.answerQuestion("direction", ["A"]);
    complete(c, p.id, "independent");
    expect(c.getPlan(p.id).status).toBe("failed");
    expect(c.getPlan(p.id).tasks.find((task) => task.id === "independent")?.status).toBe("succeeded");
  });

  it("preflights acceptance without mutation/integration and scopes skills, sources and decisions", () => {
    const c = core(), d = draft(false);
    d.sources = [{ id: "one", path: "src/a.ts", reason: "Needed" }, { id: "two", path: "src/b.ts", reason: "Unrelated" }];
    d.decisions = [{ id: "chosen", statement: "Selected approach", source: "human" }, { id: "other", statement: "Other context", source: "human" }];
    d.tasks[0]!.skills = ["typescript"];
    d.tasks[0]!.sourceIds = ["one"]; d.tasks[0]!.decisionIds = ["chosen"];
    const p = c.createPlan(d), id = start(c, p.id);
    const packet = c.assignment(id);
    expect(packet.task.skills).toEqual(["typescript"]);
    expect(packet.sources.map((source) => source.id)).toEqual(["one"]);
    expect(packet.decisions.map((decision) => decision.id)).toEqual(["chosen"]);
    expect(() => c.validateAcceptance(id)).toThrow(/state/);
    c.submitResult(id, result([inspection(c, id)]));
    const before = c.getAttempt(id), cursor = c.digest(p.id).cursor;
    c.validateAcceptance(id);
    expect(c.getAttempt(id)).toEqual(before);
    expect(c.digest(p.id).cursor).toBe(cursor);
    expect(() => c.acceptAttempt(id)).toThrow(/integratedSnapshotId/);
    c.acceptAttempt(id, { integratedSnapshotId: "merged" });
  });
});
