import { randomUUID } from "node:crypto";
import { isAbsolute, relative, resolve } from "node:path";
import { SolDatabase } from "../store/database.js";
import {
  DeferredAcceptanceError, evidenceInputSchema, planDraftSchema, plannerResultSchema, questionSchema, taskResultSchema,
  beginProjectOnboardingSchema, declineProjectOnboardingSchema, markProjectOnboardingReadySchema, projectOnboardingSchema,
  refreshProjectOnboardingSchema, snoozeProjectOnboardingSchema, updateProjectOnboardingSchema,
  completePlanningDiscussionSchema, planningDiscussionSchema, planningDiscussionStatusSchema,
  startPlanningDiscussionSchema, updatePlanningDiscussionPatchSchema,
  operationSchema, operationWorkSpec, type OperationInput, type OperationRecord, type OperationSpec,
  type AssignmentPacket, type AttemptRecord, type Digest, type EventRecord, type EvidenceInput,
  type EvidenceRecord, type PlanDraft, type PlanRecord, type Question, type QuestionRecord, type TaskResult, type TaskSpec,
   type PlannerResult, type ProposalRecord, type RevisionRecord, type DependencySummary,
    type DependencyResultOptions, type DependencyResultPage, type DependencyResultItem, type DependencyResultEntry,
    type BeginProjectOnboardingInput, type DeclineProjectOnboardingInput, type MarkProjectOnboardingReadyInput,
      type ProjectOnboarding, type RefreshProjectOnboardingInput, type SnoozeProjectOnboardingInput, type UpdateProjectOnboardingInput,
      type CompletePlanningDiscussionInput, type PlanningDiscussion, type PlanningDiscussionStatus,
      type StartPlanningDiscussionInput, type UpdatePlanningDiscussionPatch,
} from "./protocol.js";
export * from "./protocol.js";

const now = () => new Date().toISOString();
const activeAttempt = (attempt: AttemptRecord) => ["leased", "running", "submitted"].includes(attempt.status);
const encode = (value: unknown) => JSON.stringify(value);
const mappingOutputs: Record<string, string[]> = {
  tech: ["stack.md", "integrations.md"], architecture: ["architecture.md", "structure.md"],
  quality: ["conventions.md", "testing.md"], concerns: ["concerns.md"], project: ["project.md"],
  design: ["design.md"], index: ["index.md"], entrypoint: ["SOL.md"],
};
const canonicalMappingOutputs = new Set(Object.values(mappingOutputs).flat());
const readMethods = ["runtimeSummary", "getProjectOnboarding", "getDiscussion", "latestDiscussionForSession", "listDiscussions", "getPlan", "planForSession", "getOperation", "operationForSession", "isInspection", "getRevision", "listRevisions", "listPlans", "readyTasks",
  "getAttempt", "getAttemptForSession", "listAttempts", "listEvidence", "runningDurationMs", "assignment", "assignmentForTask", "dependencyResult",
  "getQuestion", "listQuestions", "pendingQuestions", "getProposal", "latestProposalForSession", "proposalQuestions", "digest"] as const;
export type ReadonlyCore = Readonly<Pick<SolCore, typeof readMethods[number]>>;
export interface RuntimeSummary {
  storage: { database: string; classification: "runtime-external" | "project-local" };
  v2: {
    plans: { total: number; byStatus: Record<string, number> };
    directOperations: { total: number; byStatus: Record<string, number>; classification: "legacy-direct-sol" };
    attempts: { total: number; byStatus: Record<string, number> };
    evidence: { total: number; byKind: Record<string, number> };
    questions: { total: number; byStatus: Record<string, number> };
    proposals: { total: number; byStatus: Record<string, number> };
    revisions: { total: number };
    events: { total: number; byType: Record<string, number> };
  };
  recentWork: { kind: "plan" | "direct-operation"; id: string; status: string; revision: number; createdAt: string; updatedAt: string }[];
  recentAudit: { id: number; type: string; planId: string | null; createdAt: string }[];
  legacyV1: { scope: "project"; classification: "legacy-sol-not-pulso"; counts: Record<string, number> };
}
function boundedString(value: string, max = 4000): void {
  if (typeof value !== "string" || !value.trim() || value.length > max) throw new Error("Invalid or oversized string");
}
function limit(value: number, max: number): number {
  if (!Number.isSafeInteger(value) || value < 1) throw new Error("Invalid limit");
  return Math.min(value, max);
}
function zDiscussionStatuses(value: PlanningDiscussionStatus[]): PlanningDiscussionStatus[] {
  if (!Array.isArray(value) || !value.length || value.length > 3) throw new Error("Invalid discussion statuses");
  const statuses = value.map((status) => planningDiscussionStatusSchema.parse(status));
  if (new Set(statuses).size !== statuses.length) throw new Error("Duplicate discussion statuses");
  return statuses;
}
// Prefix overlap is deliberately conservative for glob scopes: uncertainty reserves
// the enclosing directory, rather than allowing a writer through a pattern hole.
function scopePrefix(scope: string): string {
  const wildcard = scope.search(/[?*\[\]{}()!]/);
  if (wildcard < 0) return scope.replace(/\/$/, "");
  const prefix = scope.slice(0, wildcard);
  return prefix.slice(0, prefix.lastIndexOf("/"));
}
function overlaps(a: string, b: string): boolean {
  const x = scopePrefix(a), y = scopePrefix(b);
  return !x || !y || x === y || x.startsWith(`${y}/`) || y.startsWith(`${x}/`);
}

/** Trusted runtime API. All mutations and their compact audit events share a write transaction. */
export class SolCore {
  readonly projectRoot: string;
  private readonly store: SolDatabase;
  private transactionDepth = 0;
  constructor(projectRoot: string, databasePath?: string) {
    boundedString(projectRoot);
    this.projectRoot = resolve(projectRoot);
    this.store = new SolDatabase(databasePath);
    this.store.db.exec(`
      CREATE TABLE IF NOT EXISTS v2_plans (root TEXT NOT NULL, id TEXT NOT NULL, status TEXT NOT NULL, revision INTEGER NOT NULL, data TEXT NOT NULL, idem TEXT, original TEXT NOT NULL, PRIMARY KEY(root,id), UNIQUE(root,idem));
      CREATE TABLE IF NOT EXISTS v2_revisions (root TEXT NOT NULL, plan_id TEXT NOT NULL, revision INTEGER NOT NULL, data TEXT NOT NULL, reason TEXT NOT NULL, PRIMARY KEY(root,plan_id,revision));
      CREATE TABLE IF NOT EXISTS v2_attempts (root TEXT NOT NULL, id TEXT NOT NULL, plan_id TEXT NOT NULL, task_id TEXT NOT NULL, status TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY(root,id));
      CREATE UNIQUE INDEX IF NOT EXISTS v2_active_task ON v2_attempts(root,plan_id,task_id) WHERE status IN ('leased','running','submitted');
      CREATE INDEX IF NOT EXISTS v2_attempt_plan ON v2_attempts(root,plan_id);
      CREATE TABLE IF NOT EXISTS v2_evidence (root TEXT NOT NULL, id TEXT NOT NULL, attempt_id TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY(root,id));
      CREATE INDEX IF NOT EXISTS v2_evidence_attempt ON v2_evidence(root,attempt_id);
      CREATE TABLE IF NOT EXISTS v2_questions (root TEXT NOT NULL, id TEXT NOT NULL, plan_id TEXT, status TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY(root,id));
      CREATE TABLE IF NOT EXISTS v2_events (id INTEGER PRIMARY KEY AUTOINCREMENT, root TEXT NOT NULL, plan_id TEXT, type TEXT NOT NULL, entity_id TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS v2_event_root ON v2_events(root,id);
      CREATE TABLE IF NOT EXISTS v2_plan_sessions (root TEXT NOT NULL, session_id TEXT NOT NULL, plan_id TEXT NOT NULL, PRIMARY KEY(root,session_id));
      CREATE TABLE IF NOT EXISTS v2_operations (root TEXT NOT NULL, id TEXT NOT NULL, session_id TEXT, spec TEXT NOT NULL, idem TEXT, created_at TEXT NOT NULL, PRIMARY KEY(root,id), UNIQUE(root,idem));
      CREATE INDEX IF NOT EXISTS v2_operation_session ON v2_operations(root,session_id);
      CREATE TABLE IF NOT EXISTS v2_proposals (root TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY(root,id));
      CREATE TABLE IF NOT EXISTS v2_question_requests (root TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY(root,id));
      CREATE TABLE IF NOT EXISTS v2_project_onboarding (root TEXT PRIMARY KEY, revision INTEGER NOT NULL, state TEXT NOT NULL, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS v2_planning_discussions (root TEXT NOT NULL, id TEXT NOT NULL, parent_session_id TEXT NOT NULL, objective TEXT NOT NULL, status TEXT NOT NULL, revision INTEGER NOT NULL, data TEXT NOT NULL, PRIMARY KEY(root,id));
      CREATE INDEX IF NOT EXISTS v2_discussion_session ON v2_planning_discussions(root,parent_session_id,status);
    `);
  }
  private transaction<T>(fn: () => T): T {
    const depth = this.transactionDepth;
    const savepoint = `v2_nested_${depth}`;
    this.store.db.exec(depth ? `SAVEPOINT ${savepoint}` : "BEGIN IMMEDIATE");
    this.transactionDepth++;
    try { const result = fn(); this.store.db.exec(depth ? `RELEASE ${savepoint}` : "COMMIT"); return result; }
    catch (error) {
      this.store.db.exec(depth ? `ROLLBACK TO ${savepoint}` : "ROLLBACK");
      if (depth) this.store.db.exec(`RELEASE ${savepoint}`);
      throw error;
    } finally { this.transactionDepth--; }
  }
  /** Trusted host selects this capability surface for read-only actors. No model
   * argument can upgrade it, and bound methods never expose the underlying core.
   */
  readOnly(): ReadonlyCore {
    return Object.freeze(Object.fromEntries(readMethods.map((name) => [name, this[name].bind(this)]))) as ReadonlyCore;
  }
  /** Fresh, project-scoped aggregates. Serialized objectives, prompts, answers and payloads never leave storage. */
  runtimeSummary(): RuntimeSummary {
    const grouped = (sql: string, key: string): { total: number; grouped: Record<string, number> } => {
      const rows = this.store.db.prepare(sql).all(this.projectRoot) as Record<string, unknown>[];
      const result: Record<string, number> = {};
      let total = 0;
      for (const row of rows) {
        const count = Number(row.count ?? 0), value = String(row[key] ?? "unknown");
        result[value] = count; total += count;
      }
      return { total, grouped: result };
    };
    const plans = grouped(`SELECT status,COUNT(*) AS count FROM v2_plans WHERE root=? AND NOT EXISTS
      (SELECT 1 FROM v2_operations WHERE root=v2_plans.root AND id=v2_plans.id) GROUP BY status`, "status");
    const operations = grouped(`SELECT p.status,COUNT(*) AS count FROM v2_operations o JOIN v2_plans p ON p.root=o.root AND p.id=o.id
      WHERE o.root=? GROUP BY p.status`, "status");
    const attempts = grouped("SELECT status,COUNT(*) AS count FROM v2_attempts WHERE root=? GROUP BY status", "status");
    const evidence = grouped("SELECT COALESCE(json_extract(data,'$.kind'),'unknown') AS kind,COUNT(*) AS count FROM v2_evidence WHERE root=? GROUP BY kind", "kind");
    const questions = grouped("SELECT status,COUNT(*) AS count FROM v2_questions WHERE root=? GROUP BY status", "status");
    const proposals = grouped("SELECT COALESCE(json_extract(data,'$.status'),'unknown') AS status,COUNT(*) AS count FROM v2_proposals WHERE root=? GROUP BY status", "status");
    const events = grouped("SELECT type,COUNT(*) AS count FROM v2_events WHERE root=? GROUP BY type", "type");
    const scalar = (table: string): number => Number((this.store.db.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE root=?`).get(this.projectRoot) as { count: number }).count);
    const recentWork = this.store.db.prepare(`SELECT CASE WHEN o.id IS NULL THEN 'plan' ELSE 'direct-operation' END AS kind,
      p.id,p.status,p.revision,json_extract(p.data,'$.createdAt') AS createdAt,json_extract(p.data,'$.updatedAt') AS updatedAt
      FROM v2_plans p LEFT JOIN v2_operations o ON o.root=p.root AND o.id=p.id WHERE p.root=? ORDER BY p.rowid DESC LIMIT 8`).all(this.projectRoot) as RuntimeSummary["recentWork"];
    const recentAudit = this.store.db.prepare("SELECT id,type,plan_id AS planId,created_at AS createdAt FROM v2_events WHERE root=? ORDER BY id DESC LIMIT 24")
      .all(this.projectRoot) as RuntimeSummary["recentAudit"];

    const legacyCounts: Record<string, number> = {};
    const existing = new Set((this.store.db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[]).map(row => row.name));
    // Sol v1 related most records through projects.id rather than storing a root
    // on each table. Keep this compatibility inventory fixed and count-only.
    if (existing.has("projects")) {
      const project = this.store.db.prepare("SELECT id FROM projects WHERE root=?").get(this.projectRoot) as { id: string } | undefined;
      if (project) {
        const direct = ["work_items", "events", "message_usage", "decisions", "debts", "sessions", "worktrees"] as const;
        for (const table of direct) if (existing.has(table)) {
          legacyCounts[table] = Number((this.store.db.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE project_id=?`).get(project.id) as { count: number }).count);
        }
        if (existing.has("tasks") && existing.has("work_items")) legacyCounts.tasks = Number((this.store.db.prepare(
          "SELECT COUNT(*) AS count FROM tasks t JOIN work_items w ON w.id=t.work_item_id WHERE w.project_id=?").get(project.id) as { count: number }).count);
        if (existing.has("evidence") && existing.has("tasks") && existing.has("work_items")) legacyCounts.evidence = Number((this.store.db.prepare(
          "SELECT COUNT(*) AS count FROM evidence e JOIN tasks t ON t.id=e.task_id JOIN work_items w ON w.id=t.work_item_id WHERE w.project_id=?").get(project.id) as { count: number }).count);
      }
    }
    return {
      storage: { database: this.store.path, classification: this.store.path !== ":memory:" && !relative(this.projectRoot, this.store.path).startsWith("..") && !isAbsolute(relative(this.projectRoot, this.store.path)) ? "project-local" : "runtime-external" },
      v2: {
        plans: { total: plans.total, byStatus: plans.grouped },
        directOperations: { total: operations.total, byStatus: operations.grouped, classification: "legacy-direct-sol" },
        attempts: { total: attempts.total, byStatus: attempts.grouped }, evidence: { total: evidence.total, byKind: evidence.grouped },
        questions: { total: questions.total, byStatus: questions.grouped }, proposals: { total: proposals.total, byStatus: proposals.grouped },
        revisions: { total: scalar("v2_revisions") }, events: { total: events.total, byType: events.grouped },
      },
      recentWork, recentAudit,
      legacyV1: { scope: "project", classification: "legacy-sol-not-pulso", counts: legacyCounts },
    };
  }
  private event(type: string, planId: string | null, entityId: string): void {
    this.store.db.prepare("INSERT INTO v2_events(root,plan_id,type,entity_id,created_at) VALUES (?,?,?,?,?)").run(this.projectRoot, planId, type, entityId, now());
  }
  getProjectOnboarding(): ProjectOnboarding {
    const row = this.store.db.prepare("SELECT data FROM v2_project_onboarding WHERE root=?").get(this.projectRoot) as { data: string } | undefined;
    if (row) {
      const stored = JSON.parse(row.data) as Record<string, unknown>;
      const parsed = projectOnboardingSchema.parse(stored);
      const legacy = ["mappingMode", "selectedFocuses", "scopePaths", "baseline", "lastCompletedAt"].some(key => !(key in stored));
      if (legacy) this.store.db.prepare("UPDATE v2_project_onboarding SET data=? WHERE root=?").run(encode(parsed), this.projectRoot);
      return parsed;
    }
    return projectOnboardingSchema.parse({ schemaVersion: 1, revision: 0, state: "missing", currentStage: "consent",
      persistenceChoices: { sharedDocuments: false, privatePreferences: false }, completedDocumentIds: [], businessAnswers: [], privatePreferences: [],
      mappingMode: "initial", selectedFocuses: [], scopePaths: [], baseline: null, lastCompletedAt: null,
      createdAt: null, updatedAt: null });
  }
  private saveProjectOnboarding(record: ProjectOnboarding, eventType: string): ProjectOnboarding {
    const parsed = projectOnboardingSchema.parse(record);
    this.store.db.prepare(`INSERT INTO v2_project_onboarding(root,revision,state,data) VALUES (?,?,?,?)
      ON CONFLICT(root) DO UPDATE SET revision=excluded.revision,state=excluded.state,data=excluded.data`)
      .run(this.projectRoot, parsed.revision, parsed.state, encode(parsed));
    // Onboarding answers and preferences are deliberately excluded from audit rows.
    this.event(eventType, null, "project-onboarding");
    return parsed;
  }
  private changeProjectOnboarding(expectedRevision: number, allowed: ProjectOnboarding["state"][], eventType: string,
      change: (current: ProjectOnboarding, timestamp: string) => ProjectOnboarding): ProjectOnboarding {
    return this.transaction(() => {
      const current = this.getProjectOnboarding();
      if (current.revision !== expectedRevision) throw new Error("Onboarding revision conflict");
      if (!allowed.includes(current.state)) throw new Error(`Invalid onboarding transition from ${current.state}`);
      return this.saveProjectOnboarding(change(current, now()), eventType);
    });
  }
  beginProjectOnboarding(input: BeginProjectOnboardingInput): ProjectOnboarding {
    const parsed = beginProjectOnboardingSchema.parse(input);
    return this.changeProjectOnboarding(parsed.expectedRevision, ["missing", "offered", "snoozed", "declined"], "onboarding.began", (current, timestamp) => {
      const { offeredSessionMarker: _offered, snoozedSessionMarker: _marker, snoozedUntil: _until, ...rest } = current;
      const choices = parsed.persistenceChoices ?? current.persistenceChoices;
      if (parsed.state === "active" && !choices.sharedDocuments) throw new Error("Project initialization requires consent to repository-resident project documents");
      return { ...rest, schemaVersion: 1, revision: current.revision + 1, state: parsed.state, currentStage: "consent",
        ...(parsed.state === "offered" && parsed.sessionMarker ? { offeredSessionMarker: parsed.sessionMarker } : {}),
        persistenceChoices: choices, completedDocumentIds: choices.sharedDocuments ? current.completedDocumentIds : [],
        businessAnswers: choices.sharedDocuments ? current.businessAnswers : [], privatePreferences: choices.privatePreferences ? current.privatePreferences : [],
        baseline: choices.sharedDocuments ? current.baseline : null, lastCompletedAt: choices.sharedDocuments ? current.lastCompletedAt : null,
        createdAt: current.createdAt ?? timestamp, updatedAt: timestamp };
    });
  }
  updateProjectOnboarding(input: UpdateProjectOnboardingInput): ProjectOnboarding {
    const parsed = updateProjectOnboardingSchema.parse(input);
    return this.changeProjectOnboarding(parsed.expectedRevision, ["active"], "onboarding.updated", (current, timestamp) => {
      const stages: ProjectOnboarding["currentStage"][] = ["consent", "business", "design", "mapping", "review", "complete"];
      if (parsed.currentStage && stages.indexOf(parsed.currentStage) < stages.indexOf(current.currentStage)) throw new Error("Onboarding stage cannot regress");
      const { expectedRevision: _expected, ...changes } = parsed;
      const next = { ...current, ...changes, persistenceChoices: parsed.persistenceChoices ?? current.persistenceChoices,
        revision: current.revision + 1, updatedAt: timestamp };
      if (!next.persistenceChoices.sharedDocuments) { next.completedDocumentIds = []; next.businessAnswers = []; next.baseline = null; next.lastCompletedAt = null; }
      if (!next.persistenceChoices.privatePreferences) next.privatePreferences = [];
      return projectOnboardingSchema.parse(next);
    });
  }
  refreshProjectOnboarding(input: RefreshProjectOnboardingInput): ProjectOnboarding {
    const parsed = refreshProjectOnboardingSchema.parse(input);
    return this.changeProjectOnboarding(parsed.expectedRevision, ["ready"], "onboarding.refreshed", (current, timestamp) => {
      const invalidated = new Set(parsed.selectedFocuses.flatMap(focus => mappingOutputs[focus] ?? []));
      const completedDocumentIds = parsed.mode === "full-refresh" ? [] : current.completedDocumentIds
        .filter(document => canonicalMappingOutputs.has(document) && !invalidated.has(document));
      return { ...current, revision: current.revision + 1, state: "active", currentStage: "mapping", mappingMode: parsed.mode,
        selectedFocuses: parsed.selectedFocuses, scopePaths: parsed.scopePaths, completedDocumentIds, updatedAt: timestamp };
    });
  }
  markProjectOnboardingReady(input: MarkProjectOnboardingReadyInput): ProjectOnboarding {
    const parsed = markProjectOnboardingReadySchema.parse(input);
    return this.changeProjectOnboarding(parsed.expectedRevision, ["active"], "onboarding.ready", (current, timestamp) => ({
      ...current, revision: current.revision + 1, state: "ready", currentStage: "complete",
      completedDocumentIds: parsed.completedDocumentIds, baseline: parsed.baseline, lastCompletedAt: parsed.lastCompletedAt,
      ...(parsed.designChoice ? { designChoice: parsed.designChoice } : {}), updatedAt: timestamp,
    }));
  }
  snoozeProjectOnboarding(input: SnoozeProjectOnboardingInput): ProjectOnboarding {
    const parsed = snoozeProjectOnboardingSchema.parse(input);
    return this.changeProjectOnboarding(parsed.expectedRevision, ["offered", "active"], "onboarding.snoozed", (current, timestamp) => {
      const { offeredSessionMarker: _offered, ...rest } = current;
      return { ...rest, revision: current.revision + 1, state: "snoozed", ...(parsed.sessionMarker ? { snoozedSessionMarker: parsed.sessionMarker } : {}),
        ...(parsed.until ? { snoozedUntil: parsed.until } : {}), updatedAt: timestamp };
    });
  }
  declineProjectOnboarding(input: DeclineProjectOnboardingInput): ProjectOnboarding {
    const parsed = declineProjectOnboardingSchema.parse(input);
    return this.changeProjectOnboarding(parsed.expectedRevision, ["offered", "active", "snoozed"], "onboarding.declined", (current, timestamp) => {
      const { offeredSessionMarker: _offered, snoozedSessionMarker: _marker, snoozedUntil: _until, ...rest } = current;
      return { ...rest, revision: current.revision + 1, state: "declined", updatedAt: timestamp };
    });
  }
  startDiscussion(input: StartPlanningDiscussionInput, parentSessionId: string): PlanningDiscussion {
    const fields = startPlanningDiscussionSchema.parse(input);
    boundedString(parentSessionId, 256);
    return this.transaction(() => {
      const timestamp = now();
      const previous = this.store.db.prepare("SELECT data FROM v2_planning_discussions WHERE root=? AND parent_session_id=? AND objective=? AND status='ready' ORDER BY rowid DESC")
        .all(this.projectRoot, parentSessionId, fields.objective) as { data: string }[];
      for (const row of previous) {
        const discussion = planningDiscussionSchema.parse(JSON.parse(row.data));
        discussion.status = "superseded"; discussion.revision++; discussion.updatedAt = timestamp;
        this.saveDiscussion(discussion); this.event("discussion.superseded", null, discussion.id);
      }
      const discussion = planningDiscussionSchema.parse({ ...fields, id: randomUUID(), parentSessionId, status: "active", revision: 1,
        createdAt: timestamp, updatedAt: timestamp });
      this.store.db.prepare("INSERT INTO v2_planning_discussions(root,id,parent_session_id,objective,status,revision,data) VALUES (?,?,?,?,?,?,?)")
        .run(this.projectRoot, discussion.id, parentSessionId, discussion.objective, discussion.status, discussion.revision, encode(discussion));
      this.event("discussion.started", null, discussion.id);
      return discussion;
    });
  }
  getDiscussion(id: string): PlanningDiscussion {
    return planningDiscussionSchema.parse(this.row<PlanningDiscussion>("v2_planning_discussions", id));
  }
  latestDiscussionForSession(sessionId: string, statuses?: PlanningDiscussionStatus[]): PlanningDiscussion | undefined {
    boundedString(sessionId, 256);
    const parsedStatuses = statuses === undefined ? undefined : zDiscussionStatuses(statuses);
    const statusSql = parsedStatuses ? ` AND status IN (${parsedStatuses.map(() => "?").join(",")})` : "";
    const row = this.store.db.prepare(`SELECT data FROM v2_planning_discussions WHERE root=? AND parent_session_id=?${statusSql} ORDER BY rowid DESC LIMIT 1`)
      .get(this.projectRoot, sessionId, ...(parsedStatuses ?? [])) as { data: string } | undefined;
    return row ? planningDiscussionSchema.parse(JSON.parse(row.data)) : undefined;
  }
  listDiscussions(sessionId?: string, statuses?: PlanningDiscussionStatus[], count = 100): PlanningDiscussion[] {
    if (sessionId !== undefined) boundedString(sessionId, 256);
    const parsedStatuses = statuses === undefined ? undefined : zDiscussionStatuses(statuses);
    const sessionSql = sessionId === undefined ? "" : " AND parent_session_id=?";
    const statusSql = parsedStatuses ? ` AND status IN (${parsedStatuses.map(() => "?").join(",")})` : "";
    const rows = this.store.db.prepare(`SELECT data FROM v2_planning_discussions WHERE root=?${sessionSql}${statusSql} ORDER BY rowid DESC LIMIT ?`)
      .all(this.projectRoot, ...(sessionId === undefined ? [] : [sessionId]), ...(parsedStatuses ?? []), limit(count, 100)) as { data: string }[];
    return rows.map((row) => planningDiscussionSchema.parse(JSON.parse(row.data)));
  }
  updateDiscussion(id: string, expectedRevision: number, patch: UpdatePlanningDiscussionPatch): PlanningDiscussion {
    const changes = updatePlanningDiscussionPatchSchema.parse(patch);
    return this.changeDiscussion(id, expectedRevision, "discussion.updated", (current, timestamp) =>
      planningDiscussionSchema.parse({ ...current, ...changes, revision: current.revision + 1, updatedAt: timestamp }));
  }
  completeDiscussion(id: string, expectedRevision: number, finalFields: CompletePlanningDiscussionInput): PlanningDiscussion {
    const changes = completePlanningDiscussionSchema.parse(finalFields);
    return this.changeDiscussion(id, expectedRevision, "discussion.ready", (current, timestamp) =>
      planningDiscussionSchema.parse({ ...current, ...changes, status: "ready", revision: current.revision + 1,
        updatedAt: timestamp, completedAt: timestamp }));
  }
  private changeDiscussion(id: string, expectedRevision: number, eventType: string,
      change: (current: PlanningDiscussion, timestamp: string) => PlanningDiscussion): PlanningDiscussion {
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1) throw new Error("Invalid expected revision");
    return this.transaction(() => {
      const current = this.getDiscussion(id);
      if (current.revision !== expectedRevision) throw new Error("Discussion revision conflict");
      if (current.status !== "active") throw new Error(`Cannot change ${current.status} discussion`);
      const next = change(current, now());
      this.saveDiscussion(next); this.event(eventType, null, id); return next;
    });
  }
  private saveDiscussion(discussion: PlanningDiscussion): void {
    const parsed = planningDiscussionSchema.parse(discussion);
    this.store.db.prepare("UPDATE v2_planning_discussions SET status=?,revision=?,data=? WHERE root=? AND id=?")
      .run(parsed.status, parsed.revision, encode(parsed), this.projectRoot, parsed.id);
  }
  private row<T>(table: string, id: string): T {
    const row = this.store.db.prepare(`SELECT data FROM ${table} WHERE root=? AND id=?`).get(this.projectRoot, id) as { data: string } | undefined;
    if (!row) throw new Error(`Unknown ${table} record: ${id}`);
    return JSON.parse(row.data) as T;
  }
  private savePlan(plan: PlanRecord): void {
    plan.updatedAt = now();
    this.store.db.prepare("UPDATE v2_plans SET data=?,status=?,revision=? WHERE root=? AND id=?").run(encode(plan), plan.status, plan.revision, this.projectRoot, plan.id);
  }
  private saveAttempt(attempt: AttemptRecord): void {
    attempt.updatedAt = now();
    this.store.db.prepare("UPDATE v2_attempts SET data=?,status=? WHERE root=? AND id=?").run(encode(attempt), attempt.status, this.projectRoot, attempt.id);
  }
  private attempts(planId?: string, activeOnly = false): AttemptRecord[] {
    const rows = this.store.db.prepare(`SELECT data FROM v2_attempts WHERE root=?${planId ? " AND plan_id=?" : ""}${activeOnly ? " AND status IN ('leased','running','submitted')" : ""} ORDER BY rowid`).all(this.projectRoot, ...(planId ? [planId] : [])) as { data: string }[];
    return rows.map((row) => JSON.parse(row.data) as AttemptRecord);
  }
  listAttempts(planId?: string, activeOnly = false): AttemptRecord[] {
    if (planId !== undefined) this.getPlan(planId);
    return this.attempts(planId, activeOnly);
  }
  getAttemptForSession(sessionId: string): AttemptRecord | undefined {
    boundedString(sessionId, 256);
    const row = this.store.db.prepare("SELECT data FROM v2_attempts WHERE root=? AND json_extract(data,'$.sessionId')=? ORDER BY rowid DESC LIMIT 1").get(this.projectRoot, sessionId) as { data: string } | undefined;
    return row ? JSON.parse(row.data) as AttemptRecord : undefined;
  }
  private current(attempt: AttemptRecord, statuses: AttemptRecord["status"][]): PlanRecord {
    const plan = this.getPlan(attempt.planId);
    if (plan.revision !== attempt.revision || !["active", "paused"].includes(plan.status)) throw new Error("Stale attempt or inactive plan");
    const task = plan.tasks.find((task) => task.id === attempt.taskId);
    if (!statuses.includes(attempt.status) || !task || task.status !== attempt.status) throw new Error("Invalid attempt state");
    return plan;
  }
  private task(plan: PlanRecord, taskId: string): PlanRecord["tasks"][number] {
    const task = plan.tasks.find((task) => task.id === taskId);
    if (!task) throw new Error(`Unknown task ${taskId}`);
    return task;
  }
  private blocked(planId: string, taskId: string): boolean {
    return this.pendingQuestions(planId).some((question) => question.material && (!question.taskIds.length || question.taskIds.includes(taskId)));
  }
  private expired(plan: PlanRecord): boolean {
    return this.runningDurationMs(plan.id) >= plan.draft.budgets.maxDurationMs;
  }
  /** Aggregate worker running time in the CURRENT revision, matching maxAttempts.
   * A new revision gets a fresh maxDurationMs budget. Prior attempts retain their
   * recorded durations for audit. Queued/leased/submitted/conversation time is free.
   */
  runningDurationMs(planId: string): number {
    const plan = this.getPlan(planId);
    return this.attempts(planId).filter((attempt) => attempt.revision === plan.revision).reduce((total, attempt) => total + (attempt.runningDurationMs ?? 0) +
      (attempt.status === "running" ? Math.max(0, Date.now() - Date.parse(attempt.startedAt ?? attempt.updatedAt)) : 0), 0);
  }
  private stopClock(attempt: AttemptRecord): void {
    if (attempt.status === "running") attempt.runningDurationMs = (attempt.runningDurationMs ?? 0) + Math.max(0, Date.now() - Date.parse(attempt.startedAt ?? attempt.updatedAt));
  }
  private settlePlan(plan: PlanRecord): void {
    if (plan.tasks.every((task) => task.status === "succeeded")) { plan.status = "succeeded"; return; }
    if (this.attempts(plan.id, true).length) return;
    // Questions can delay otherwise viable work. They must not turn a partial
    // failure into a plan failure while an independent branch can still proceed.
    const viable = plan.tasks.some((task) => task.status === "queued" &&
      task.dependsOn.every((dep) => this.task(plan, dep).status === "succeeded"));
    if (this.expired(plan) || (!viable && plan.tasks.some((task) => task.status === "failed"))) plan.status = "failed";
  }
  createPlan(input: PlanDraft, idempotencyKey?: string): PlanRecord {
    const draft = planDraftSchema.parse(input);
    if (idempotencyKey !== undefined) boundedString(idempotencyKey, 256);
    return this.transaction(() => {
      if (idempotencyKey !== undefined) {
        const existing = this.store.db.prepare("SELECT id,original FROM v2_plans WHERE root=? AND idem=?").get(this.projectRoot, idempotencyKey) as { id: string; original: string } | undefined;
        if (existing) {
          if (existing.original !== encode(draft)) throw new Error("Idempotency key payload conflict");
          return this.getPlan(existing.id);
        }
      }
      const timestamp = now();
      const plan: PlanRecord = { schemaVersion: 2, id: randomUUID(), revision: 1, status: "active", draft, tasks: draft.tasks.map((task) => ({ ...task, status: "queued" })), createdAt: timestamp, updatedAt: timestamp };
      this.store.db.prepare("INSERT INTO v2_plans VALUES (?,?,?,?,?,?,?)").run(this.projectRoot, plan.id, plan.status, 1, encode(plan), idempotencyKey ?? null, encode(draft));
      this.store.db.prepare("INSERT INTO v2_revisions VALUES (?,?,?,?,?)").run(this.projectRoot, plan.id, 1, encode(draft), "created");
      this.event("plan.created", plan.id, plan.id);
      return plan;
    });
  }
  /** Operation IDs are private engine plan IDs, not user-revisable plans. */
  createOperation(input: OperationInput, sessionId: string, idempotencyKey?: string): OperationRecord {
    const spec = operationSchema.parse(input);
    boundedString(sessionId, 256);
    if (idempotencyKey !== undefined) boundedString(idempotencyKey, 256);
    return this.transaction(() => {
      const existing = idempotencyKey !== undefined
        ? this.store.db.prepare("SELECT id,spec,session_id FROM v2_operations WHERE root=? AND idem=?").get(this.projectRoot, idempotencyKey) as { id: string; spec: string; session_id: string } | undefined
        : this.store.db.prepare("SELECT id,spec,session_id FROM v2_operations WHERE root=? AND session_id=? AND spec=? ORDER BY rowid DESC LIMIT 1").get(this.projectRoot, sessionId, encode(spec)) as { id: string; spec: string; session_id: string } | undefined;
      if (existing) {
        if (existing.spec !== encode(spec) || existing.session_id !== sessionId) throw new Error("Idempotency key payload conflict");
        return this.getOperation(existing.id);
      }
      const plan = this.createPlan(operationWorkSpec(spec));
      this.store.db.prepare("INSERT INTO v2_operations(root,id,session_id,spec,idem,created_at) VALUES (?,?,?,?,?,?)").run(this.projectRoot, plan.id, sessionId, encode(spec), idempotencyKey ?? null, plan.createdAt);
      this.event("operation.created", plan.id, plan.id);
      return this.getOperation(plan.id);
    });
  }
  getOperation(id: string): OperationRecord {
    const row = this.store.db.prepare("SELECT spec FROM v2_operations WHERE root=? AND id=?").get(this.projectRoot, id) as { spec: string } | undefined;
    if (!row) throw new Error(`Unknown operation: ${id}`);
    const spec = JSON.parse(row.spec) as OperationSpec, plan = this.getPlan(id);
    return { id, objective: spec.objective, mode: spec.mode, status: plan.status, taskId: plan.tasks[0]!.id, createdAt: plan.createdAt };
  }
  operationForSession(sessionId: string): OperationRecord | undefined {
    boundedString(sessionId, 256);
    const row = this.store.db.prepare("SELECT id FROM v2_operations WHERE root=? AND session_id=? ORDER BY rowid DESC LIMIT 1").get(this.projectRoot, sessionId) as { id: string } | undefined;
    return row ? this.getOperation(row.id) : undefined;
  }
  private isOperation(id: string): boolean {
    return !!this.store.db.prepare("SELECT 1 FROM v2_operations WHERE root=? AND id=?").get(this.projectRoot, id);
  }
  isInspection(planId: string): boolean {
    return this.isOperation(planId) && this.getOperation(planId).mode === "inspect";
  }
  private requireUserPlan(id: string): void {
    if (this.isOperation(id)) throw new Error("Use explicit operations; operations cannot be revised or bound as user plans through Planner.");
  }
  getPlan(id: string): PlanRecord { return this.row<PlanRecord>("v2_plans", id); }
  bindPlanSession(planId: string, sessionId: string): PlanRecord {
    this.requireUserPlan(planId);
    boundedString(sessionId, 256);
    return this.transaction(() => {
      const plan = this.getPlan(planId);
      if (this.planForSession(sessionId)?.id === planId) return plan;
      this.store.db.prepare("INSERT INTO v2_plan_sessions(root,session_id,plan_id) VALUES (?,?,?) ON CONFLICT(root,session_id) DO UPDATE SET plan_id=excluded.plan_id").run(this.projectRoot, sessionId, planId);
      this.event("plan.session_bound", planId, planId); return plan;
    });
  }
  planForSession(sessionId: string): PlanRecord | undefined {
    boundedString(sessionId, 256);
    const row = this.store.db.prepare("SELECT plan_id FROM v2_plan_sessions WHERE root=? AND session_id=?").get(this.projectRoot, sessionId) as { plan_id: string } | undefined;
    return row ? this.getPlan(row.plan_id) : undefined;
  }
  getRevision(planId: string, revision: number): RevisionRecord {
    this.getPlan(planId);
    const row = this.store.db.prepare("SELECT data,reason FROM v2_revisions WHERE root=? AND plan_id=? AND revision=?").get(this.projectRoot, planId, revision) as { data: string; reason: string } | undefined;
    if (!row) throw new Error("Unknown revision");
    return { schemaVersion: 2, planId, revision, draft: planDraftSchema.parse(JSON.parse(row.data)), reason: row.reason };
  }
  listRevisions(planId: string, count = 100): RevisionRecord[] {
    this.getPlan(planId);
    const rows = this.store.db.prepare("SELECT revision FROM v2_revisions WHERE root=? AND plan_id=? ORDER BY revision DESC LIMIT ?").all(this.projectRoot, planId, limit(count, 100)) as { revision: number }[];
    return rows.map((row) => this.getRevision(planId, row.revision));
  }
  pausePlan(id: string): PlanRecord {
    return this.transaction(() => {
      const plan = this.getPlan(id);
      if (plan.status === "paused") return plan;
      if (plan.status !== "active") throw new Error("Only active plans can be paused");
      plan.status = "paused"; this.savePlan(plan); this.event("plan.paused", id, id); return plan;
    });
  }
  resumePlan(id: string): PlanRecord {
    return this.transaction(() => {
      const plan = this.getPlan(id);
      if (plan.status === "active") return plan;
      if (plan.status !== "paused") throw new Error("Only paused plans can be resumed");
      plan.status = "active"; this.settlePlan(plan); this.savePlan(plan); this.event("plan.resumed", id, id); return plan;
    });
  }
  listPlans(count = 20): PlanRecord[] {
    const rows = this.store.db.prepare("SELECT data FROM v2_plans WHERE root=? AND NOT EXISTS (SELECT 1 FROM v2_operations WHERE root=v2_plans.root AND id=v2_plans.id) ORDER BY rowid DESC LIMIT ?").all(this.projectRoot, limit(count, 100)) as { data: string }[];
    return rows.map((row) => JSON.parse(row.data) as PlanRecord);
  }
  revisePlan(id: string, expectedRevision: number, input: PlanDraft, reason: string): PlanRecord {
    return this.reviseWithAnswers(id, expectedRevision, input, reason, []);
  }
  private reviseWithAnswers(id: string, expectedRevision: number, input: PlanDraft, reason: string, incomingAnswers: QuestionRecord[]): PlanRecord {
    this.requireUserPlan(id);
    const draft = planDraftSchema.parse(input); boundedString(reason);
    return this.transaction(() => {
      const plan = this.getPlan(id);
      if (plan.revision !== expectedRevision) throw new Error("Revision conflict");
      // Attempts use the plan-wide revision in current(); even unrelated active
      // work must settle before revision until per-task revisions are supported.
      if (plan.status === "cancelled" || this.attempts(id, true).length) throw new Error("Cannot revise cancelled plan or active attempts");
      if (this.pendingQuestions(id).some((question) => question.taskIds.some((taskId) => !draft.tasks.some((task) => task.id === taskId)))) throw new Error("Revision would orphan a pending question");
      const previous = plan.draft;
      const preserved = new Set<string>();
      const fingerprint = (context: PlanDraft, taskId: string, answers: QuestionRecord[]) => {
        const spec = context.tasks.find((task) => task.id === taskId);
        return encode({ spec, objective: context.objective, constraints: context.constraints,
          acceptance: context.acceptance.filter((entry) => spec?.acceptance.includes(entry.id)),
          sources: context.sources.filter((entry) => spec?.sourceIds?.includes(entry.id)),
          decisions: context.decisions.filter((entry) => spec?.decisionIds?.includes(entry.id)),
          // Apply uses the post-link scope (removed links become unscoped). New
          // material answers are semantic changes even if the draft text is identical.
          incomingAnswers: answers.filter((question) => question.material && (!question.taskIds.length || question.taskIds.includes(taskId)))
            .map((question) => ({ id: question.id, answers: question.answers })) });
      };
      {
        let changed = true;
        while (changed) {
          changed = false;
          for (const task of draft.tasks) {
            if (!preserved.has(task.id) && plan.tasks.some((old) => old.id === task.id && old.status === "succeeded") &&
                fingerprint(previous, task.id, []) === fingerprint(draft, task.id, incomingAnswers) && task.dependsOn.every((dep) => preserved.has(dep))) {
              preserved.add(task.id); changed = true;
            }
          }
        }
      }
      plan.revision++; plan.draft = draft;
      plan.tasks = draft.tasks.map((task) => ({ ...task, status: preserved.has(task.id) ? "succeeded" : "queued" }));
      plan.status = plan.tasks.every((task) => task.status === "succeeded") ? "succeeded" : plan.status === "paused" ? "paused" : "active";
      this.savePlan(plan);
      this.store.db.prepare("INSERT INTO v2_revisions VALUES (?,?,?,?,?)").run(this.projectRoot, id, plan.revision, encode(draft), reason);
      this.event("plan.revised", id, id); return plan;
    });
  }
  readyTasks(planId: string): TaskSpec[] {
    const plan = this.getPlan(planId);
    if (plan.status !== "active" || this.expired(plan) || this.attempts(planId, true).length >= plan.draft.budgets.maxParallel) return [];
    const attempts = this.attempts(planId);
    return plan.tasks.filter((task) => task.status === "queued" && !this.blocked(planId, task.id) &&
      attempts.filter((attempt) => attempt.taskId === task.id && attempt.revision === plan.revision).length < plan.draft.budgets.maxAttempts &&
      task.dependsOn.every((dep) => this.task(plan, dep).status === "succeeded")).map(({ status: _status, ...task }) => task);
  }
  leaseAttempt(planId: string, taskId: string, workspace: { workspacePath: string; snapshotId: string; isolated: boolean }): AttemptRecord {
    boundedString(workspace.workspacePath); boundedString(workspace.snapshotId, 256);
    if (!isAbsolute(workspace.workspacePath) || typeof workspace.isolated !== "boolean") throw new Error("Invalid workspace");
    return this.transaction(() => {
      const plan = this.getPlan(planId);
      const task = this.readyTasks(planId).find((task) => task.id === taskId);
      if (!task) throw new Error("Task is not ready or budget exhausted");
      for (const held of this.attempts(undefined, true)) {
        const other = this.task(this.getPlan(held.planId), held.taskId);
        if (task.resources.some((resource) => other.resources.includes(resource))) throw new Error("Resource reserved");
        const separate = workspace.isolated && held.isolated && resolve(workspace.workspacePath) !== resolve(held.workspacePath);
        if (!separate && (task.writes.some((write) => [...other.reads, ...other.writes].some((scope) => overlaps(write, scope))) ||
            other.writes.some((write) => task.reads.some((scope) => overlaps(write, scope))))) throw new Error("Path reservation conflict");
      }
      const timestamp = now();
      const attempt: AttemptRecord = { schemaVersion: 2, id: randomUUID(), planId, taskId, revision: plan.revision, status: "leased", isolated: workspace.isolated, snapshotId: workspace.snapshotId, workspacePath: resolve(workspace.workspacePath), createdAt: timestamp, updatedAt: timestamp };
      this.buildAssignment(plan, task, attempt);
      this.store.db.prepare("INSERT INTO v2_attempts VALUES (?,?,?,?,?,?)").run(this.projectRoot, attempt.id, planId, taskId, attempt.status, encode(attempt));
      this.task(plan, taskId).status = "leased"; this.savePlan(plan);
      this.event("attempt.leased", planId, attempt.id); return attempt;
    });
  }
  getAttempt(id: string): AttemptRecord { return this.row<AttemptRecord>("v2_attempts", id); }
  startAttempt(id: string, sessionId: string): AttemptRecord {
    boundedString(sessionId, 256);
    return this.transaction(() => {
      const attempt = this.getAttempt(id), plan = this.current(attempt, ["leased"]);
      if (plan.status !== "active" || this.blocked(plan.id, attempt.taskId) || this.expired(plan)) throw new Error("Task paused, blocked or duration budget exhausted");
      if (this.getAttemptForSession(sessionId)) throw new Error("Session already belongs to an attempt");
      attempt.sessionId = sessionId; attempt.startedAt = now(); attempt.status = "running"; this.saveAttempt(attempt);
      this.task(plan, attempt.taskId).status = "running"; this.savePlan(plan);
      this.event("attempt.started", plan.id, id); return attempt;
    });
  }
  heartbeat(id: string): void {
    this.transaction(() => {
      const attempt = this.getAttempt(id); this.current(attempt, ["leased", "running", "submitted"]);
      this.saveAttempt(attempt); this.event("attempt.heartbeat", attempt.planId, id);
    });
  }
  listEvidence(attemptId: string): EvidenceRecord[] {
    this.getAttempt(attemptId);
    const rows = this.store.db.prepare("SELECT data FROM v2_evidence WHERE root=? AND attempt_id=? ORDER BY rowid").all(this.projectRoot, attemptId) as { data: string }[];
    return rows.map((row) => JSON.parse(row.data) as EvidenceRecord);
  }
  recordEvidence(attemptId: string, input: EvidenceInput): EvidenceRecord {
    const data = evidenceInputSchema.parse(input);
    return this.transaction(() => {
      const attempt = this.getAttempt(attemptId), plan = this.current(attempt, ["running"]);
      if (data.snapshotId !== attempt.snapshotId) throw new Error("Evidence snapshot does not match assigned baseline");
      if (this.listEvidence(attemptId).length >= 128) throw new Error("Evidence budget exhausted");
      if (data.checkId !== undefined) {
        const check = this.task(plan, attempt.taskId).checks.find((check) => check.id === data.checkId);
        if (!check || check.command !== data.command) throw new Error("Unknown or mismatched named check");
      }
      const evidence: EvidenceRecord = { ...data, schemaVersion: 2, id: randomUUID(), attemptId, planId: attempt.planId, taskId: attempt.taskId, revision: attempt.revision, createdAt: now() };
      this.store.db.prepare("INSERT INTO v2_evidence VALUES (?,?,?,?)").run(this.projectRoot, evidence.id, attemptId, encode(evidence));
      this.event("evidence.recorded", plan.id, evidence.id); return evidence;
    });
  }
  private validateResult(attempt: AttemptRecord, plan: PlanRecord, result: TaskResult, accepting: boolean): void {
    const task = this.task(plan, attempt.taskId);
    const evidence = this.listEvidence(attempt.id);
    for (const criterion of result.criteria) {
      if (!task.acceptance.includes(criterion.id)) throw new Error("Criterion is outside assigned acceptance");
      for (const ref of criterion.evidenceRefs) {
        const entry = evidence.find((entry) => entry.id === ref);
        if (!entry || entry.revision !== attempt.revision || entry.snapshotId !== attempt.snapshotId) throw new Error("Invalid evidence provenance");
        if (criterion.status === "satisfied" && entry.kind === "command" && entry.exitCode !== 0) throw new Error("Failed evidence cannot satisfy a criterion");
      }
      if (criterion.status === "satisfied" && !criterion.evidenceRefs.length) throw new Error("Satisfied criterion requires evidence");
    }
    if (result.blockers.some((blocker) => blocker.criterionId && !task.acceptance.includes(blocker.criterionId))) throw new Error("Blocker references unassigned criterion");
    if (!accepting) return;
    if (result.outcome !== "completed" || result.blockers.length || task.acceptance.some((id) => !result.criteria.some((criterion) => criterion.id === id && criterion.status === "satisfied"))) throw new Error("Incomplete acceptance coverage");
    const referenced = new Set(result.criteria.flatMap((criterion) => criterion.evidenceRefs));
    for (const check of task.checks) {
      const entries = evidence.filter((entry) => entry.checkId === check.id);
      const latest = entries.at(-1);
      if (!latest || latest.kind !== "command" || latest.command !== check.command || latest.exitCode !== 0 ||
          latest.snapshotId !== attempt.snapshotId || !referenced.has(latest.id) || (check.timeoutMs !== undefined && (latest.durationMs ?? Infinity) > check.timeoutMs)) throw new Error(`Missing or failed check coverage: ${check.id}`);
    }
  }
  submitResult(attemptId: string, input: TaskResult): AttemptRecord {
    const result = taskResultSchema.parse(input);
    return this.transaction(() => {
      const attempt = this.getAttempt(attemptId);
      const plan = this.getPlan(attempt.planId);
      if (plan.revision !== attempt.revision || plan.status === "cancelled") throw new Error("Stale result");
      if ((attempt.status === "submitted" || attempt.status === "succeeded") && attempt.result) {
        if (encode(attempt.result) !== encode(result)) throw new Error("Conflicting duplicate result");
        return attempt;
      }
      this.current(attempt, ["running"]);
      this.validateResult(attempt, plan, result, false);
      this.stopClock(attempt);
      attempt.result = result; attempt.status = "submitted"; this.saveAttempt(attempt);
      this.task(plan, attempt.taskId).status = "submitted"; this.savePlan(plan);
      this.event("attempt.submitted", plan.id, attemptId); return attempt;
    });
  }
  /** Pre-integration check. Integration identity is supplied only to acceptAttempt. */
  validateAcceptance(attemptId: string): void {
    this.transaction(() => this.acceptancePreflight(attemptId));
  }
  private acceptancePreflight(attemptId: string): void {
    const attempt = this.getAttempt(attemptId), plan = this.current(attempt, ["submitted"]);
    if (!attempt.result) throw new Error("Missing result");
    if (plan.status === "paused") throw new DeferredAcceptanceError("paused", attemptId);
    if (this.blocked(plan.id, attempt.taskId)) throw new DeferredAcceptanceError("pending_question", attemptId);
    if (this.expired(plan)) throw new Error("Duration budget exhausted");
    this.validateResult(attempt, plan, attempt.result, true);
  }
  acceptAttempt(attemptId: string, options: { integratedSnapshotId?: string } = {}): AttemptRecord {
    if (options.integratedSnapshotId !== undefined) boundedString(options.integratedSnapshotId, 256);
    return this.transaction(() => {
      const attempt = this.getAttempt(attemptId), plan = this.current(attempt, ["submitted"]);
      this.acceptancePreflight(attemptId);
      if (this.task(plan, attempt.taskId).writes.length && !options.integratedSnapshotId) throw new Error("Writer requires integratedSnapshotId");
      if (options.integratedSnapshotId !== undefined) attempt.integratedSnapshotId = options.integratedSnapshotId;
      attempt.status = "succeeded"; this.saveAttempt(attempt);
      this.task(plan, attempt.taskId).status = "succeeded";
      this.settlePlan(plan);
      this.savePlan(plan); this.event("attempt.accepted", plan.id, attemptId); return attempt;
    });
  }
  private terminate(attempt: AttemptRecord, reason: string, retryable: boolean, status: "failed" | "lost"): AttemptRecord {
    const plan = this.current(attempt, ["leased", "running", "submitted"]);
    this.stopClock(attempt);
    attempt.status = status; attempt.reason = reason; this.saveAttempt(attempt);
    const count = this.attempts(plan.id).filter((other) => other.taskId === attempt.taskId && other.revision === plan.revision).length;
    const retry = retryable && count < plan.draft.budgets.maxAttempts && !this.expired(plan);
    this.task(plan, attempt.taskId).status = retry ? "queued" : "failed";
    this.settlePlan(plan);
    this.savePlan(plan); this.event(`attempt.${status}`, plan.id, attempt.id); return attempt;
  }
  failAttempt(id: string, reason: string, retryable: boolean): AttemptRecord {
    boundedString(reason);
    if (typeof retryable !== "boolean") throw new Error("Invalid retryable flag");
    return this.transaction(() => this.terminate(this.getAttempt(id), reason, retryable, "failed"));
  }
  /** workersStopped is a trusted host assertion, never inferred from age or session absence. */
  cancelPlan(id: string, options: { workersStopped?: boolean } = {}): PlanRecord {
    return this.transaction(() => {
      const plan = this.getPlan(id);
      if (plan.status === "cancelled") return plan;
      if (plan.status === "succeeded") throw new Error("Cannot cancel succeeded plan");
      const active = this.attempts(id, true);
      if (active.length && options.workersStopped !== true) throw new Error("Cancellation requires confirmed stopped workers: workersStopped must be true");
      for (const attempt of active) {
        this.stopClock(attempt); attempt.status = "cancelled"; this.saveAttempt(attempt); this.event("attempt.cancelled", id, attempt.id);
      }
      for (const task of plan.tasks) if (task.status !== "succeeded") task.status = "cancelled";
      for (const question of this.pendingQuestions(id)) { question.status = "cancelled"; this.saveQuestion(question); this.event("question.cancelled", id, question.id); }
      plan.status = "cancelled"; this.savePlan(plan); this.event("plan.cancelled", id, id); return plan;
    });
  }
  recoverAttempts(isSessionAlive: (sessionId: string) => boolean): { recovered: string[]; uncertain: string[] } {
    const recovered: string[] = [], uncertain: string[] = [];
    // Session probing is outside the write lock; state is checked again before transition.
    for (const candidate of this.attempts(undefined, true)) {
      let alive: boolean | undefined;
      if (candidate.sessionId) { try { alive = isSessionAlive(candidate.sessionId); } catch { alive = undefined; } }
      if (alive !== false || candidate.status === "submitted") { uncertain.push(candidate.id); continue; }
      this.transaction(() => {
        const current = this.getAttempt(candidate.id);
        if (!activeAttempt(current) || current.status !== candidate.status || current.updatedAt !== candidate.updatedAt || current.sessionId !== candidate.sessionId) { uncertain.push(candidate.id); return; }
        this.terminate(current, "Session confirmed dead", true, "lost"); recovered.push(current.id);
      });
    }
    return { recovered, uncertain };
  }
  /** Trusted driver only: age is insufficient without proof of ownership and no session.
   * Probe outside the transaction, then compare the lease again to avoid racing dispatch.
   */
  recoverLeasedOrphans(staleBefore: string, confirmsOwnedWithoutSession: (attempt: Readonly<AttemptRecord>) => boolean): { recovered: string[]; uncertain: string[] } {
    const cutoff = Date.parse(staleBefore);
    if (!Number.isFinite(cutoff) || cutoff > Date.now()) throw new Error("Invalid stale lease cutoff");
    const recovered: string[] = [], uncertain: string[] = [];
    for (const candidate of this.attempts(undefined, true)) {
      if (candidate.status !== "leased" || candidate.sessionId || Date.parse(candidate.updatedAt) >= cutoff) continue;
      let confirmed = false;
      try { confirmed = confirmsOwnedWithoutSession(Object.freeze({ ...candidate })) === true; } catch { /* Unknown ownership is not recovery proof. */ }
      if (!confirmed) { uncertain.push(candidate.id); continue; }
      this.transaction(() => {
        const current = this.getAttempt(candidate.id);
        if (current.status !== "leased" || current.sessionId || current.updatedAt !== candidate.updatedAt) { uncertain.push(candidate.id); return; }
        this.terminate(current, "Driver confirmed owned orphan lease without session", true, "lost");
        recovered.push(current.id);
      });
    }
    return { recovered, uncertain };
  }
  assignment(attemptId: string): AssignmentPacket {
    const attempt = this.getAttempt(attemptId), plan = this.current(attempt, ["leased", "running", "submitted"]);
    const task = plan.draft.tasks.find((task) => task.id === attempt.taskId)!;
    return this.buildAssignment(plan, task, attempt);
  }
  /** Read-only preflight; leasing repeats this with the actual workspace before consuming an attempt. */
  assignmentForTask(planId: string, taskId: string): AssignmentPacket {
    const plan = this.getPlan(planId);
    const task = this.readyTasks(planId).find(task => task.id === taskId);
    if (!task) throw new Error("Task is not ready or budget exhausted");
    return this.buildAssignment(plan, task, { id: "preflight", workspacePath: this.projectRoot, snapshotId: "preflight" });
  }
  private acceptedDependencies(plan: PlanRecord, task: TaskSpec): AttemptRecord[] {
    const attempts = this.attempts(plan.id);
    return task.dependsOn.map((taskId) => {
      const dep = attempts.findLast((entry) => entry.taskId === taskId && entry.status === "succeeded");
      if (!dep?.result || this.task(plan, taskId).status !== "succeeded") throw new Error("Missing accepted dependency result");
      return dep;
    });
  }
  private buildAssignment(plan: PlanRecord, task: TaskSpec, attempt: Pick<AttemptRecord, "id" | "workspacePath" | "snapshotId">): AssignmentPacket {
    const dependencies: DependencySummary[] = this.acceptedDependencies(plan, task).map(dep => ({
      taskId: dep.taskId, attemptId: dep.id, resultRef: dep.id, summary: dep.result!.summary.slice(0, 240), outcome: dep.result!.outcome,
      criteria: dep.result!.criteria.map(({ id, status }) => ({ id, status })),
      findingsCount: dep.result!.findings.length, artifactsCount: dep.result!.artifacts.length,
      ...(dep.integratedSnapshotId ? { integratedSnapshotId: dep.integratedSnapshotId } : {}),
    }));
    const packet: AssignmentPacket = { schemaVersion: 2, attemptId: attempt.id, planId: plan.id, revision: plan.revision, objective: plan.draft.objective, task,
      workspacePath: attempt.workspacePath, snapshotId: attempt.snapshotId, acceptance: plan.draft.acceptance.filter((criterion) => task.acceptance.includes(criterion.id)),
      constraints: plan.draft.constraints,
      sources: plan.draft.sources.filter((source) => task.sourceIds?.includes(source.id) ?? false),
      decisions: plan.draft.decisions.filter((decision) => task.decisionIds?.includes(decision.id) ?? false),
      answeredQuestions: this.answeredQuestionsForTask(plan.id, task.id), dependencies: dependencies.slice(0, 8),
      dependencyRefs: dependencies.map(({ taskId, attemptId, resultRef }) => ({ taskId, attemptId, resultRef })),
      dependencySummariesOmitted: Math.max(0, dependencies.length - 8) };
    while (Buffer.byteLength(encode(packet)) > 32_768 && packet.dependencies.length) {
      packet.dependencies.pop(); packet.dependencySummariesOmitted++;
    }
    if (Buffer.byteLength(encode(packet)) > 32_768) throw new Error("Assignment budget exceeded; narrow task context before dispatch");
    return packet;
  }
  /** Only current direct dependencies are readable, including successes preserved by revision. */
  dependencyResult(attemptId: string, dependencyAttemptId: string, options: DependencyResultOptions): DependencyResultPage {
    const attempt = this.getAttempt(attemptId), plan = this.current(attempt, ["leased", "running", "submitted"]);
    const dep = this.acceptedDependencies(plan, this.task(plan, attempt.taskId)).find(dep => dep.id === dependencyAttemptId);
    if (!dep) throw new Error("Unknown or unrelated dependency result reference");
    if (!options || !["summary", "findings", "criteria", "artifacts", "blockers"].includes(options.section)) throw new Error("Invalid dependency section");
    const offset = options.offset ?? 0, count = limit(options.limit ?? 3, 64);
    if (!Number.isSafeInteger(offset) || offset < 0) throw new Error("Invalid dependency offset");
    const result = dep.result!;
    const entries: DependencyResultEntry[] = options.section === "summary"
      ? [{ schemaVersion: result.schemaVersion, outcome: result.outcome, summary: result.summary, ...(result.next !== undefined ? { next: result.next } : {}) }]
      : result[options.section];
    const units: DependencyResultItem[] = entries.flatMap((value, itemIndex): DependencyResultItem[] => {
      const item = { itemIndex, value }, json = encode(value);
      if (Buffer.byteLength(encode(item)) <= 5500) return [item];
      // Fixed code-unit boundaries preserve even surrogate pairs when reassembled.
      const parts = Math.ceil(json.length / 1000);
      return Array.from({ length: parts }, (_, part) => ({ itemIndex, part, parts, json: json.slice(part * 1000, (part + 1) * 1000) }));
    });
    if (offset > units.length) throw new Error("Invalid dependency offset");
    const page: DependencyResultPage = { taskId: dep.taskId, attemptId: dep.id, resultRef: dep.id, section: options.section, offset, total: units.length, items: [],
      ...(dep.integratedSnapshotId ? { integratedSnapshotId: dep.integratedSnapshotId } : {}) };
    for (let i = offset; i < units.length && page.items.length < count; i++) {
      page.items.push(units[i]!); page.nextOffset = i + 1;
      if (Buffer.byteLength(encode(page)) > 8192) { page.items.pop(); break; }
    }
    const next = offset + page.items.length;
    if (next < units.length) page.nextOffset = next;
    else delete page.nextOffset;
    return page;
  }
  private saveQuestion(question: QuestionRecord): void {
    this.store.db.prepare("UPDATE v2_questions SET status=?,plan_id=?,data=? WHERE root=? AND id=?").run(question.status, question.planId ?? null, encode(question), this.projectRoot, question.id);
  }
  getQuestion(id: string): QuestionRecord { return this.row<QuestionRecord>("v2_questions", id); }
  listQuestions(planId?: string): QuestionRecord[] {
    if (planId !== undefined) this.getPlan(planId);
    const rows = this.store.db.prepare(`SELECT data FROM v2_questions WHERE root=?${planId !== undefined ? " AND plan_id=?" : ""} ORDER BY rowid DESC LIMIT 100`).all(this.projectRoot, ...(planId !== undefined ? [planId] : [])) as { data: string }[];
    return rows.map((row) => JSON.parse(row.data) as QuestionRecord);
  }
  private answeredQuestionsForTask(planId: string, taskId: string): QuestionRecord[] {
    const rows = this.store.db.prepare(`SELECT data FROM v2_questions WHERE root=? AND plan_id=? AND status='answered'
      AND (json_array_length(data,'$.taskIds')=0 OR EXISTS (SELECT 1 FROM json_each(v2_questions.data,'$.taskIds') WHERE value=?))
      ORDER BY rowid LIMIT 101`).all(this.projectRoot, planId, taskId) as { data: string }[];
    if (rows.length > 100) throw new Error("Assignment budget exceeded; too many mandatory answered questions");
    return rows.map((row) => JSON.parse(row.data) as QuestionRecord);
  }
  private questionPayload(record: QuestionRecord): Question {
    const { schemaVersion: _version, status: _status, createdAt: _created, answeredAt: _answered, answers: _answers, ...question } = record;
    return questionSchema.parse(question);
  }
  requestQuestion(input: Question): QuestionRecord {
    return this.createQuestion(input, false);
  }
  private createQuestion(input: Question, forProposal: boolean): QuestionRecord {
    const question = questionSchema.parse(input);
    return this.transaction(() => {
      const existing = this.store.db.prepare("SELECT data FROM v2_questions WHERE root=? AND id=?").get(this.projectRoot, question.id) as { data: string } | undefined;
      if (existing) {
        const record = JSON.parse(existing.data) as QuestionRecord;
        const original = this.store.db.prepare("SELECT data FROM v2_question_requests WHERE root=? AND id=?").get(this.projectRoot, question.id) as { data: string } | undefined;
        if ((original?.data ?? encode(this.questionPayload(record))) !== encode(question)) throw new Error("Question ID payload conflict");
        return record;
      }
      if (this.pendingQuestions().length >= 3) throw new Error("Pending question batch budget is three");
      if (question.planId) {
        const plan = this.getPlan(question.planId);
        if (forProposal ? plan.status === "cancelled" : !["active", "paused"].includes(plan.status)) throw new Error("Questions require an active or paused plan (proposals may revisit completed work)");
        for (const taskId of question.taskIds) {
          const task = this.task(plan, taskId);
          if (!forProposal && ["succeeded", "failed", "cancelled"].includes(task.status)) throw new Error("Cannot block terminal task");
        }
      }
      const record: QuestionRecord = { ...question, schemaVersion: 2, status: "pending", createdAt: now() };
      this.store.db.prepare("INSERT INTO v2_questions VALUES (?,?,?,?,?)").run(this.projectRoot, question.id, question.planId ?? null, "pending", encode(record));
      this.store.db.prepare("INSERT INTO v2_question_requests VALUES (?,?,?)").run(this.projectRoot, question.id, encode(question));
      this.event("question.requested", question.planId ?? null, question.id); return record;
    });
  }
  answerQuestion(id: string, input: string[][] | string[]): QuestionRecord {
    return this.transaction(() => {
      const question = this.row<QuestionRecord>("v2_questions", id);
      if (!Array.isArray(input) || (Array.isArray(input[0]) && input.length !== 1)) throw new Error("Expected one question answer group");
      const answers = (Array.isArray(input[0]) ? input[0] : input) as string[];
      if (!answers.length || answers.length > 8 || answers.some((answer) => typeof answer !== "string" || !answer.trim() || answer.length > 2000) || new Set(answers).size !== answers.length || (!question.multiple && answers.length !== 1)) throw new Error("Invalid question answers");
      if (question.status === "answered" && encode(question.answers) === encode(answers)) return question;
      if (question.status !== "pending") throw new Error("Question already answered differently or cancelled");
      question.answers = answers; question.status = "answered"; question.answeredAt = now(); this.saveQuestion(question);
      this.event("question.answered", question.planId ?? null, id); return question;
    });
  }
  pendingQuestions(planId?: string): QuestionRecord[] {
    if (planId) this.getPlan(planId);
    const rows = this.store.db.prepare(`SELECT data FROM v2_questions WHERE root=? AND status='pending'${planId ? " AND plan_id=?" : ""} ORDER BY rowid LIMIT 3`).all(this.projectRoot, ...(planId ? [planId] : [])) as { data: string }[];
    return rows.map((row) => JSON.parse(row.data) as QuestionRecord);
  }
  proposePlan(input: PlannerResult, parentSessionId: string, planId?: string, expectedRevision?: number): ProposalRecord {
    if (planId !== undefined) this.requireUserPlan(planId);
    const result = plannerResultSchema.parse(input); boundedString(parentSessionId, 256);
    if (result.addressedQuestionIds.length) throw new Error("Initial proposal cannot acknowledge answers; refine the proposal after answering");
    if ((planId === undefined) !== (expectedRevision === undefined) ||
        (expectedRevision !== undefined && (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1))) throw new Error("Plan revision proposals require planId and expectedRevision together");
    return this.transaction(() => {
      if (planId !== undefined) {
        const plan = this.getPlan(planId);
        if (plan.revision !== expectedRevision) throw new Error("Revision conflict");
        if (plan.status === "cancelled") throw new Error("Cannot propose revisions to a cancelled plan");
      }
      const id = randomUUID();
      const questionIds = result.questions.map((question, index) => {
        if (question.planId !== undefined && question.planId !== planId) throw new Error("Planner question references another or nonexistent plan; normalize question links first");
        const generated = { ...question, id: `${id}:q${index + 1}` };
        this.createQuestion(generated, true); return generated.id;
      });
      const proposal: ProposalRecord = { ...result, id, parentSessionId, ...(planId !== undefined ? { planId, expectedRevision: expectedRevision! } : {}),
        status: "proposed", revision: 1, createdAt: now(), updatedAt: now(), questionIds };
      this.store.db.prepare("INSERT INTO v2_proposals VALUES (?,?,?)").run(this.projectRoot, id, encode(proposal));
      this.event("proposal.created", planId ?? null, id); return proposal;
    });
  }
  getProposal(id: string): ProposalRecord { return this.row<ProposalRecord>("v2_proposals", id); }
  latestProposalForSession(sessionId: string): ProposalRecord | undefined {
    boundedString(sessionId, 256);
    const row = this.store.db.prepare("SELECT data FROM v2_proposals WHERE root=? AND json_extract(data,'$.parentSessionId')=? ORDER BY rowid DESC LIMIT 1").get(this.projectRoot, sessionId) as { data: string } | undefined;
    return row ? JSON.parse(row.data) as ProposalRecord : undefined;
  }
  proposalQuestions(id: string): QuestionRecord[] { return this.getProposal(id).questionIds.map((questionId) => this.getQuestion(questionId)); }
  /** Refine a durable artifact using exact answers supplied by the trusted caller. */
  refineProposal(id: string, input: PlannerResult): ProposalRecord {
    const result = plannerResultSchema.parse(input);
    return this.transaction(() => {
      const proposal = this.getProposal(id);
      if (proposal.status !== "proposed") throw new Error("Cannot refine an applied proposal");
      const existing = this.proposalQuestions(id);
      if (result.addressedQuestionIds.some((questionId) => !existing.some((question) => question.id === questionId && question.status === "answered"))) throw new Error("Acknowledgments must reference exact answered proposal question IDs");
      const questionIds = [...proposal.questionIds];
      for (const question of result.questions) {
        if (question.planId !== undefined && question.planId !== proposal.planId) throw new Error("Planner question references another or nonexistent plan; normalize question links first");
        // IDs and presentation metadata may change; identical question text must
        // not cause an already answered (or still pending) question to be reasked.
        if (existing.some((entry) => entry.status !== "cancelled" && entry.question === question.question)) continue;
        const generated = { ...question, id: `${id}:q${questionIds.length + 1}` };
        existing.push(this.createQuestion(generated, true)); questionIds.push(generated.id);
      }
      if (questionIds.length > 256) throw new Error("Proposal question history budget exceeded");
      const refined: ProposalRecord = { ...proposal, ...result, plan: result.plan,
        questionIds, revision: (proposal.revision ?? 1) + 1, updatedAt: now() };
      this.store.db.prepare("UPDATE v2_proposals SET data=? WHERE root=? AND id=?").run(encode(refined), this.projectRoot, id);
      this.event("proposal.refined", proposal.planId ?? null, id); return refined;
    });
  }
  applyProposal(id: string): PlanRecord {
    return this.transaction(() => {
      const proposal = this.getProposal(id);
      if (proposal.status === "applied") return this.getPlan(proposal.planId!);
      if (!proposal.plan) throw new Error("Proposal has no plan to apply");
      const questions = this.proposalQuestions(id);
      if (questions.some((question) => question.status !== "answered")) throw new Error("Proposal has unanswered or cancelled questions");
      const addressed = proposal.addressedQuestionIds ?? [];
      if (proposal.questionIds.length && (addressed.length !== proposal.questionIds.length || proposal.questionIds.some((questionId) => !addressed.includes(questionId)))) throw new Error("Proposal must be refined to acknowledge exact answered question IDs before applying");
      const linkedQuestions = questions.map((question) => ({ ...question,
        taskIds: question.taskIds.filter((taskId) => proposal.plan!.tasks.some((task) => task.id === taskId)) }));
      const plan = proposal.planId !== undefined
        ? this.reviseWithAnswers(proposal.planId, proposal.expectedRevision!, proposal.plan, proposal.reason, linkedQuestions)
        : this.createPlan(proposal.plan);
      // Carry exact human answers into the applied plan. Unscoped proposal
      // answers apply to every task; scoped answers retain surviving links.
      for (const question of linkedQuestions) {
        question.planId = plan.id;
        this.saveQuestion(question);
        this.event("question.linked", plan.id, question.id);
      }
      this.bindPlanSession(plan.id, proposal.parentSessionId);
      proposal.planId = plan.id; proposal.appliedRevision = plan.revision;
      proposal.status = "applied"; proposal.appliedAt = now(); proposal.updatedAt = proposal.appliedAt;
      this.store.db.prepare("UPDATE v2_proposals SET data=? WHERE root=? AND id=?").run(encode(proposal), this.projectRoot, id);
      this.event("proposal.applied", plan.id, id); return plan;
    });
  }
  digest(planId?: string, afterEventId?: number): Digest {
    if (afterEventId !== undefined && (!Number.isSafeInteger(afterEventId) || afterEventId < 0)) throw new Error("Invalid event cursor");
    const plans = planId ? [this.getPlan(planId)] : (this.store.db.prepare("SELECT data FROM v2_plans WHERE root=? AND status IN ('active','paused') AND NOT EXISTS (SELECT 1 FROM v2_operations WHERE root=v2_plans.root AND id=v2_plans.id) ORDER BY rowid DESC LIMIT 8").all(this.projectRoot) as { data: string }[]).map((row) => JSON.parse(row.data) as PlanRecord);
    const summaries: Digest["plans"] = plans.map((plan) => {
      const tasks: Digest["plans"][number]["tasks"] = {};
      for (const task of plan.tasks) tasks[task.status] = (tasks[task.status] ?? 0) + 1;
      return { id: plan.id, revision: plan.revision, status: plan.status, title: plan.draft.title, tasks };
    });
    // A fresh digest selects only active-plan events. Cursor requests explicitly opt
    // into incremental project events, including recently completed work.
    const params: unknown[] = [this.projectRoot];
    let filter = "root=?";
    if (planId) { filter += " AND plan_id=?"; params.push(planId); }
    else if (afterEventId === undefined) filter += " AND (plan_id IN (SELECT id FROM v2_plans WHERE root=v2_events.root AND status IN ('active','paused')) OR (plan_id IS NULL AND entity_id IN (SELECT id FROM v2_questions WHERE root=v2_events.root AND status='pending')))";
    if (afterEventId !== undefined) { filter += " AND id>?"; params.push(afterEventId); }
    const rows = this.store.db.prepare(`SELECT id,plan_id,type,entity_id,created_at FROM v2_events WHERE ${filter} ORDER BY id ${afterEventId === undefined ? "DESC" : "ASC"} LIMIT 24`).all(...params) as { id: number; plan_id: string | null; type: string; entity_id: string; created_at: string }[];
    if (afterEventId === undefined) rows.reverse();
    const latest = this.store.db.prepare("SELECT MAX(id) AS id FROM v2_events WHERE root=?").get(this.projectRoot) as { id: number | null };
    const digest: Digest = { schemaVersion: 2, plans: summaries, events: [], cursor: afterEventId ?? latest.id ?? 0 };
    while (Buffer.byteLength(encode(digest)) > 6144) digest.plans.pop();
    for (const row of rows) {
      const event: EventRecord = { id: row.id, planId: row.plan_id, type: row.type, entityId: row.entity_id, createdAt: row.created_at };
      digest.events.push(event);
      if (Buffer.byteLength(encode(digest)) > 8192) {
        if (afterEventId === undefined) { digest.events.shift(); continue; }
        digest.events.pop(); break;
      }
      if (afterEventId !== undefined) digest.cursor = event.id;
    }
    // Long Unicode titles can consume four bytes per character.
    while (Buffer.byteLength(encode(digest)) > 8192) digest.plans.pop();
    return digest;
  }
  close(): void { this.store.close(); }
}
