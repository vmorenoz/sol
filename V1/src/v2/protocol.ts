import { z } from "zod";

/** Acceptance may be retried unchanged after the host resumes work or answers a question. */
export class DeferredAcceptanceError extends Error {
  readonly code = "ACCEPTANCE_DEFERRED";
  constructor(readonly reason: "paused" | "pending_question", readonly attemptId: string) {
    super(reason === "paused" ? "Task paused; acceptance deferred" : "Task blocked by a pending material question; acceptance deferred");
    this.name = "DeferredAcceptanceError";
  }
}

const text = (max: number) => z.string().trim().min(1).max(max);
const identifier = text(96).regex(/^[a-zA-Z0-9][a-zA-Z0-9_.:-]*$/).describe("Stable ID, not prose; use letters, digits, underscore, dot, colon or hyphen.");
export const scopeSchema = text(512).refine((path) =>
  !path.startsWith("/") && !path.includes("\\") && !path.includes(":") &&
  !/[\x00-\x1f\x7f]/.test(path) && !path.split("/").some((part) => part === ".." || part === "." || part === ""),
"Scope must be a safe project-relative path");
const ids = z.array(identifier).max(64);
const unique = (values: string[]) => new Set(values).size === values.length;
const onboardingAnswers = z.array(z.object({ id: identifier, answer: text(1000) }).strict()).max(32)
  .refine((answers) => unique(answers.map((answer) => answer.id)), "Duplicate answer IDs");
export const projectMappingModeSchema = z.enum(["initial", "full-refresh", "focus-refresh", "incremental"]);
export const projectMappingFocusSchema = z.enum(["tech", "architecture", "quality", "concerns", "project", "design", "index", "entrypoint"]);
const selectedFocuses = z.array(projectMappingFocusSchema).max(8)
  .refine((focuses) => unique(focuses), "Duplicate mapping focuses");
const scopePaths = z.array(scopeSchema).max(64)
  .refine((paths) => unique(paths), "Duplicate scope paths");
const sha256 = z.string().regex(/^[a-f0-9]{64}$/, "Expected a lowercase SHA-256 digest");
export const projectMappingBaselineSchema = z.object({
  capturedAt: z.string().datetime({ offset: true }),
  gitHead: z.string().regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/, "Expected a Git object ID").optional(),
  documents: z.array(z.object({ id: identifier, sha256 }).strict()).max(64),
  sources: z.array(z.object({ path: scopeSchema, sha256, documentIds: ids }).strict()).max(256),
}).strict().superRefine((baseline, ctx) => {
  if (!unique(baseline.documents.map((document) => document.id))) ctx.addIssue({ code: "custom", path: ["documents"], message: "Duplicate baseline document IDs" });
  if (!unique(baseline.sources.map((source) => source.path))) ctx.addIssue({ code: "custom", path: ["sources"], message: "Duplicate baseline source paths" });
  const documentIds = new Set(baseline.documents.map((document) => document.id));
  baseline.sources.forEach((source, sourceIndex) => {
    if (!unique(source.documentIds)) ctx.addIssue({ code: "custom", path: ["sources", sourceIndex, "documentIds"], message: "Duplicate baseline document references" });
    source.documentIds.forEach((documentId, documentIndex) => {
      if (!documentIds.has(documentId)) ctx.addIssue({ code: "custom", path: ["sources", sourceIndex, "documentIds", documentIndex], message: "Unknown baseline document ID" });
    });
  });
});
export const projectOnboardingSchema = z.object({
  schemaVersion: z.literal(1), revision: z.number().int().min(0),
  state: z.enum(["missing", "offered", "active", "snoozed", "declined", "ready"]),
  currentStage: z.enum(["consent", "business", "design", "mapping", "review", "complete"]),
  designChoice: z.enum(["existing", "document", "define", "later", "not-applicable"]).optional(),
  persistenceChoices: z.object({ sharedDocuments: z.boolean(), privatePreferences: z.boolean() }).strict(),
  completedDocumentIds: ids,
  businessAnswers: onboardingAnswers,
  privatePreferences: onboardingAnswers,
  mappingMode: projectMappingModeSchema.default("initial"),
  selectedFocuses: selectedFocuses.default([]),
  scopePaths: scopePaths.default([]),
  baseline: projectMappingBaselineSchema.nullable().default(null),
  lastCompletedAt: z.string().datetime({ offset: true }).nullable().default(null),
  offeredSessionMarker: text(256).optional(),
  snoozedSessionMarker: text(256).optional(),
  snoozedUntil: z.string().datetime({ offset: true }).optional(),
  createdAt: z.string().datetime({ offset: true }).nullable(),
  updatedAt: z.string().datetime({ offset: true }).nullable(),
}).strict().superRefine((record, ctx) => {
  if (record.state === "missing" && (record.revision !== 0 || record.createdAt !== null || record.updatedAt !== null)) {
    ctx.addIssue({ code: "custom", message: "Missing onboarding state cannot contain persisted metadata" });
  }
  if (record.state !== "missing" && (record.revision < 1 || record.createdAt === null || record.updatedAt === null)) {
    ctx.addIssue({ code: "custom", message: "Persisted onboarding state requires revision and timestamps" });
  }
  if (record.state === "ready" && record.currentStage !== "complete") ctx.addIssue({ code: "custom", message: "Ready onboarding must be complete" });
  if (record.state !== "ready" && record.currentStage === "complete") ctx.addIssue({ code: "custom", message: "Only ready onboarding may be complete" });
  if (record.state === "snoozed" && !record.snoozedSessionMarker && !record.snoozedUntil) ctx.addIssue({ code: "custom", message: "Snoozed onboarding requires a session marker or until timestamp" });
  if (record.state !== "snoozed" && (record.snoozedSessionMarker || record.snoozedUntil)) ctx.addIssue({ code: "custom", message: "Snooze metadata requires snoozed state" });
  if (record.state !== "offered" && record.offeredSessionMarker) ctx.addIssue({ code: "custom", message: "Offer metadata requires offered state" });
  if (!record.persistenceChoices.sharedDocuments && (record.completedDocumentIds.length || record.businessAnswers.length)) {
    ctx.addIssue({ code: "custom", message: "Shared onboarding data requires shared document persistence consent" });
  }
  if (!record.persistenceChoices.sharedDocuments && (record.baseline || record.lastCompletedAt)) {
    ctx.addIssue({ code: "custom", message: "Mapping baseline requires shared document persistence consent" });
  }
  if (!record.persistenceChoices.privatePreferences && record.privatePreferences.length) {
    ctx.addIssue({ code: "custom", message: "Private preferences require private preference persistence consent" });
  }
  if (record.state === "missing" && (record.mappingMode !== "initial" || record.selectedFocuses.length || record.scopePaths.length || record.baseline || record.lastCompletedAt)) {
    ctx.addIssue({ code: "custom", message: "Missing onboarding state requires initial mapping defaults" });
  }
  if (record.state === "ready" && ((record.baseline === null) !== (record.lastCompletedAt === null))) {
    ctx.addIssue({ code: "custom", message: "Ready onboarding baseline and completion timestamp must be present together" });
  }
  if (record.baseline) {
    const baselineDocuments = new Set(record.baseline.documents.map((document) => document.id));
    record.completedDocumentIds.forEach((id, index) => {
      if (!baselineDocuments.has(id)) ctx.addIssue({ code: "custom", path: ["completedDocumentIds", index], message: "Completed document is absent from the baseline" });
    });
  }
});
const expectedOnboardingRevision = z.number().int().min(0);
export const beginProjectOnboardingSchema = z.object({
  expectedRevision: expectedOnboardingRevision,
  state: z.enum(["offered", "active"]).default("active"),
  sessionMarker: text(256).optional(),
  persistenceChoices: projectOnboardingSchema.shape.persistenceChoices.optional(),
}).strict();
export const updateProjectOnboardingSchema = z.object({
  expectedRevision: expectedOnboardingRevision,
  currentStage: z.enum(["consent", "business", "design", "mapping", "review"]).optional(),
  designChoice: projectOnboardingSchema.shape.designChoice,
  persistenceChoices: projectOnboardingSchema.shape.persistenceChoices.optional(),
  completedDocumentIds: ids.optional(),
  businessAnswers: onboardingAnswers.optional(),
  privatePreferences: onboardingAnswers.optional(),
  mappingMode: projectMappingModeSchema.optional(),
  selectedFocuses: selectedFocuses.optional(),
  scopePaths: scopePaths.optional(),
}).strict().refine((input) => Object.keys(input).some((key) => key !== "expectedRevision"), "Onboarding update is empty");
export const markProjectOnboardingReadySchema = z.object({
  expectedRevision: expectedOnboardingRevision,
  completedDocumentIds: ids.min(1),
  designChoice: projectOnboardingSchema.shape.designChoice,
  baseline: projectMappingBaselineSchema,
  lastCompletedAt: z.string().datetime({ offset: true }),
}).strict();
export const refreshProjectOnboardingSchema = z.object({
  expectedRevision: expectedOnboardingRevision,
  mode: z.enum(["full-refresh", "focus-refresh", "incremental"]),
  selectedFocuses,
  scopePaths,
}).strict();
export const snoozeProjectOnboardingSchema = z.object({
  expectedRevision: expectedOnboardingRevision,
  sessionMarker: text(256).optional(),
  until: z.string().datetime({ offset: true }).optional(),
}).strict().refine((input) => !!input.sessionMarker || !!input.until, "Snooze requires a session marker or until timestamp");
export const declineProjectOnboardingSchema = z.object({ expectedRevision: expectedOnboardingRevision }).strict();
export type ProjectOnboarding = z.infer<typeof projectOnboardingSchema>;
export type ProjectMappingMode = z.infer<typeof projectMappingModeSchema>;
export type ProjectMappingFocus = z.infer<typeof projectMappingFocusSchema>;
export type ProjectMappingBaseline = z.infer<typeof projectMappingBaselineSchema>;
export type BeginProjectOnboardingInput = z.input<typeof beginProjectOnboardingSchema>;
export type UpdateProjectOnboardingInput = z.input<typeof updateProjectOnboardingSchema>;
export type MarkProjectOnboardingReadyInput = z.input<typeof markProjectOnboardingReadySchema>;
export type RefreshProjectOnboardingInput = z.input<typeof refreshProjectOnboardingSchema>;
export type SnoozeProjectOnboardingInput = z.input<typeof snoozeProjectOnboardingSchema>;
export type DeclineProjectOnboardingInput = z.input<typeof declineProjectOnboardingSchema>;
export const planningDiscussionStatusSchema = z.enum(["active", "ready", "superseded"]);
const planningGrayAreasSchema = z.array(z.object({
  id: identifier, title: text(240), context: text(2000), status: z.enum(["proposed", "selected", "skipped"]),
}).strict()).min(2).max(4).refine((areas) => unique(areas.map((area) => area.id)), "Duplicate gray area IDs");
const planningDecisionsSchema = z.array(z.object({
  id: identifier, areaId: identifier, statement: text(2000), rationale: text(2000).optional(),
  source: z.enum(["user", "delegated"]), reversibility: z.enum(["reversible", "costly", "one-way"]),
}).strict()).max(32).refine((decisions) => unique(decisions.map((decision) => decision.id)), "Duplicate decision IDs");
const planningCanonicalRefsSchema = z.array(z.object({ path: scopeSchema, reason: text(1000) }).strict()).max(64)
  .refine((refs) => unique(refs.map((ref) => ref.path)), "Duplicate canonical reference paths");
const planningCodeEntriesSchema = z.array(z.object({ path: scopeSchema, statement: text(2000) }).strict()).max(32)
  .refine((entries) => unique(entries.map((entry) => entry.path)), "Duplicate code context paths");
const planningCodeContextSchema = z.object({
  reusableAssets: planningCodeEntriesSchema.default([]),
  establishedPatterns: planningCodeEntriesSchema.default([]),
  integrationPoints: planningCodeEntriesSchema.default([]),
}).strict().default({ reusableAssets: [], establishedPatterns: [], integrationPoints: [] });
const planningStringsSchema = z.array(text(1000)).max(64).refine(unique, "Duplicate entries");
const planningDiscussionFields = {
  scopeBoundary: text(4000).optional(), grayAreas: planningGrayAreasSchema, decisions: planningDecisionsSchema.default([]),
  specifics: planningStringsSchema.default([]), canonicalRefs: planningCanonicalRefsSchema.default([]),
  codeContext: planningCodeContextSchema, deferred: planningStringsSchema.default([]), noMaterialDecisions: z.boolean().default(false),
};
export const startPlanningDiscussionSchema = z.object({
  objective: text(4000), ...planningDiscussionFields,
}).strict();
export const updatePlanningDiscussionPatchSchema = z.object({
  scopeBoundary: text(4000).optional(), grayAreas: planningGrayAreasSchema.optional(), decisions: planningDecisionsSchema.optional(),
  specifics: planningStringsSchema.optional(), canonicalRefs: planningCanonicalRefsSchema.optional(),
  codeContext: planningCodeContextSchema.optional(), deferred: planningStringsSchema.optional(), noMaterialDecisions: z.boolean().optional(),
}).strict().refine((patch) => Object.keys(patch).length > 0, "Discussion update is empty");
export const completePlanningDiscussionSchema = updatePlanningDiscussionPatchSchema;
export const planningDiscussionSchema = z.object({
  id: identifier, parentSessionId: text(256), objective: text(4000), status: planningDiscussionStatusSchema,
  revision: z.number().int().min(1), ...planningDiscussionFields,
  createdAt: z.string().datetime({ offset: true }), updatedAt: z.string().datetime({ offset: true }),
  completedAt: z.string().datetime({ offset: true }).optional(),
}).strict().superRefine((discussion, ctx) => {
  if (!unique([...discussion.grayAreas.map((area) => area.id), ...discussion.decisions.map((decision) => decision.id)])) {
    ctx.addIssue({ code: "custom", message: "Gray area and decision IDs must be unique" });
  }
  const selected = new Set(discussion.grayAreas.filter((area) => area.status === "selected").map((area) => area.id));
  discussion.decisions.forEach((decision, index) => {
    if (!selected.has(decision.areaId)) ctx.addIssue({ code: "custom", path: ["decisions", index, "areaId"], message: "Decision must reference a selected gray area" });
  });
  if (discussion.status === "active" && discussion.completedAt) ctx.addIssue({ code: "custom", path: ["completedAt"], message: "Active discussion cannot be completed" });
  if (discussion.status !== "active" && !discussion.completedAt) ctx.addIssue({ code: "custom", path: ["completedAt"], message: "Terminal discussion requires completedAt" });
  if (discussion.status === "ready") {
    if (!discussion.scopeBoundary) ctx.addIssue({ code: "custom", path: ["scopeBoundary"], message: "Ready discussion requires a scope boundary" });
    if (discussion.grayAreas.some((area) => area.status === "proposed")) ctx.addIssue({ code: "custom", path: ["grayAreas"], message: "Ready discussion cannot contain unresolved gray areas" });
    for (const areaId of selected) if (!discussion.decisions.some((decision) => decision.areaId === areaId)) {
      ctx.addIssue({ code: "custom", path: ["decisions"], message: `Selected gray area ${areaId} requires a decision` });
    }
    if (discussion.noMaterialDecisions) {
      if (selected.size || discussion.decisions.length) ctx.addIssue({ code: "custom", path: ["noMaterialDecisions"], message: "No-material-decisions flag conflicts with selected areas or decisions" });
    } else if (!selected.size || !discussion.decisions.length) {
      ctx.addIssue({ code: "custom", path: ["decisions"], message: "Ready discussion requires a selected-area decision or explicit no-material-decisions flag" });
    }
  }
});
export type PlanningDiscussionStatus = z.infer<typeof planningDiscussionStatusSchema>;
export type PlanningDiscussion = z.infer<typeof planningDiscussionSchema>;
export type StartPlanningDiscussionInput = z.input<typeof startPlanningDiscussionSchema>;
export type UpdatePlanningDiscussionPatch = z.input<typeof updatePlanningDiscussionPatchSchema>;
export type CompletePlanningDiscussionInput = z.input<typeof completePlanningDiscussionSchema>;
export const taskSpecSchema = z.object({
  id: identifier, title: text(240),
  role: z.enum(["executor", "planner", "scout", "researcher", "reviewer", "verifier", "creator"]),
   dependsOn: ids.default([]), reads: z.array(scopeSchema).max(64).default([]).describe("Explicit project-relative paths or globs to inspect. Read-only tasks require at least one read scope; instructions do not grant scope."),
  writes: z.array(scopeSchema).max(64).default([]), resources: ids.default([]),
  skills: ids.default([]), sourceIds: ids.default([]), decisionIds: ids.default([]),
   acceptance: ids.min(1).describe("References to existing root acceptance[].id values, not criterion descriptions or prose."),
   checks: z.array(z.object({ id: identifier, command: text(2048), timeoutMs: z.number().int().min(1).max(3_600_000).optional() }).strict()).max(32).default([]).describe("Named commands that must pass with evidence. Use [] for inspection without command execution."),
  environment: z.object({
    prepare: z.object({ command: text(2048), timeoutMs: z.number().int().min(1).max(3_600_000).optional() }).strict().optional(),
    generatedOutputs: z.array(scopeSchema).max(32).default([]),
  }).strict().optional(),
  instructions: text(8000).optional(),
 }).strict().superRefine((task, ctx) => {
   if (!task.reads.length && !task.writes.length) ctx.addIssue({ code: "custom", path: ["reads"], message: "Task requires explicit reads or writes; read-only inspection requires a nonempty reads scope." });
 });

export const planDraftSchema = z.object({
  schemaVersion: z.literal(2),
  template: z.enum(["fast", "standard", "investigation", "critical", "release"]),
  title: text(240), objective: text(4000),
   acceptance: z.array(z.object({ id: identifier.describe("Criterion ID referenced exactly by tasks[].acceptance[]."), description: text(2000) }).strict()).min(1).max(64).describe("Root acceptance criteria are objects {id, description}. Tasks reference their IDs, never their descriptions."),
  tasks: z.array(taskSpecSchema).min(1).max(64),
  constraints: z.array(text(1000)).max(32).default([]),
  sources: z.array(z.object({ id: identifier, path: scopeSchema, reason: text(1000) }).strict()).max(64).default([]),
  decisions: z.array(z.object({ id: identifier, statement: text(2000), source: text(512) }).strict()).max(64).default([]),
  sourceMessageRefs: z.array(text(512)).max(32).optional(),
  // Attempts are per task/revision; duration is aggregate worker time per revision.
  // Revising a plan explicitly establishes fresh execution budgets.
  budgets: z.object({
    maxAttempts: z.number().int().min(1).max(10).default(2),
    maxParallel: z.number().int().min(1).max(16).default(4),
    maxDurationMs: z.number().int().min(1).max(86_400_000).default(3_600_000),
  }).strict().default({ maxAttempts: 2, maxParallel: 4, maxDurationMs: 3_600_000 }),
}).strict().superRefine((plan, ctx) => {
  const issue = (message: string) => ctx.addIssue({ code: "custom", message });
  for (const [name, entries] of [["tasks", plan.tasks], ["acceptance", plan.acceptance], ["sources", plan.sources], ["decisions", plan.decisions]] as const) {
    if (!unique(entries.map((entry) => entry.id))) issue(`Duplicate ${name} IDs`);
  }
  const tasks = new Map(plan.tasks.map((task) => [task.id, task]));
  const criteria = new Set(plan.acceptance.map((criterion) => criterion.id));
   for (const [index, task] of plan.tasks.entries()) {
    for (const list of [task.dependsOn, task.acceptance, task.resources, task.skills, task.sourceIds ?? [], task.decisionIds ?? [], task.checks.map((check) => check.id)]) {
      if (!unique(list)) issue(`Duplicate references in ${task.id}`);
    }
    if (task.dependsOn.some((id) => id === task.id || !tasks.has(id))) issue(`Unknown or self dependency in ${task.id}`);
     task.acceptance.forEach((id, j) => {
       if (!criteria.has(id)) ctx.addIssue({ code: "custom", path: ["tasks", index, "acceptance", j],
         message: `Unknown criterion. Use an existing root acceptance ID: ${JSON.stringify([...criteria])}; do not use prose.`,
         params: { knownIds: [...criteria], suggestedValues: [...criteria] } });
     });
    if (task.sourceIds?.some((id) => !plan.sources.some((source) => source.id === id))) issue(`Unknown source in ${task.id}`);
    if (task.decisionIds?.some((id) => !plan.decisions.some((decision) => decision.id === id))) issue(`Unknown decision in ${task.id}`);
  }
  if (plan.acceptance.some((criterion) => !plan.tasks.some((task) => task.acceptance.includes(criterion.id)))) issue("Every criterion must have task coverage");
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (id: string): void => {
    if (visiting.has(id)) { issue("Dependency cycle"); return; }
    if (visited.has(id)) return;
    visiting.add(id);
    for (const dep of tasks.get(id)?.dependsOn ?? []) visit(dep);
    visiting.delete(id); visited.add(id);
  };
  for (const task of plan.tasks) visit(task.id);
  if (plan.template === "fast" && (plan.tasks.length !== 1 || plan.tasks[0]?.role !== "executor")) issue("Fast requires exactly one executor");
  if (plan.template === "investigation" && plan.tasks.some((task) => task.writes.length)) issue("Investigation is read-only");
  if (plan.template === "critical" || plan.template === "release") {
    const reviews = plan.tasks.filter((task) => task.role === "reviewer" && task.reads.length && !task.writes.length);
    if (!reviews.length) issue("Critical/release requires a scoped read-only review");
    const ancestors = (id: string, seen = new Set<string>()): Set<string> => {
      if (seen.has(id)) return seen;
      seen.add(id);
      for (const dep of tasks.get(id)?.dependsOn ?? []) ancestors(dep, seen);
      return seen;
    };
    if (plan.tasks.some((task) => task.writes.length && !reviews.some((review) => ancestors(review.id).has(task.id)))) issue("Writers require downstream review");
  }
});

export const taskResultSchema = z.object({
  schemaVersion: z.literal(2), outcome: z.enum(["completed", "partial", "blocked", "failed"]), summary: text(4000),
  criteria: z.array(z.object({ id: identifier, status: z.enum(["satisfied", "unsatisfied", "unverified"]), evidenceRefs: z.array(identifier).max(64) }).strict()).max(64),
  findings: z.array(z.object({ statement: text(2000), source: text(512), kind: z.enum(["fact", "hypothesis", "recommendation"]) }).strict()).max(32),
  blockers: z.array(z.object({ kind: z.enum(["technical", "decision", "scope"]), message: text(2000), criterionId: identifier.optional() }).strict()).max(16),
  artifacts: z.array(scopeSchema).max(64), next: text(2000).optional(),
}).strict().superRefine((result, ctx) => {
  if (!unique(result.criteria.map((criterion) => criterion.id)) || result.criteria.some((criterion) => !unique(criterion.evidenceRefs))) {
    ctx.addIssue({ code: "custom", message: "Duplicate criteria or evidence references" });
  }
});

export const questionSchema = z.object({
  id: identifier, planId: identifier.optional(), taskIds: ids.default([]),
  header: text(30), question: text(2000),
  options: z.array(z.object({ label: text(80), description: text(500) }).strict()).min(1).max(8),
  multiple: z.boolean(), reason: text(2000), material: z.boolean(),
}).strict().superRefine((question, ctx) => {
  if (!unique(question.taskIds) || !unique(question.options.map((option) => option.label))) ctx.addIssue({ code: "custom", message: "Duplicate question tasks/options" });
  if (question.taskIds.length && !question.planId) ctx.addIssue({ code: "custom", message: "Linked tasks require a planId" });
});

export const evidenceInputSchema = z.object({
  checkId: identifier.optional(), kind: z.enum(["command", "inspection"]), command: text(2048).optional(),
  exitCode: z.number().int().min(-1).max(255).optional(), durationMs: z.number().int().min(0).max(86_400_000).optional(),
  summary: text(4000), snapshotId: text(256), artifactPath: scopeSchema.optional(),
}).strict().superRefine((evidence, ctx) => {
  if (evidence.kind === "command" && (evidence.command === undefined || evidence.exitCode === undefined || evidence.durationMs === undefined)) ctx.addIssue({ code: "custom", message: "Command evidence requires command, exitCode and durationMs" });
  if (evidence.kind === "inspection" && (evidence.checkId !== undefined || evidence.command !== undefined || evidence.exitCode !== undefined)) ctx.addIssue({ code: "custom", message: "Inspection cannot impersonate a command check" });
});

export const plannerResultSchema = z.object({
  schemaVersion: z.literal(2), summary: text(4000), plan: planDraftSchema.optional(),
  questions: z.array(questionSchema).max(3), reason: text(4000),
  addressedQuestionIds: z.array(identifier).max(256).default([]),
}).strict().superRefine((result, ctx) => {
  if (!unique(result.questions.map((question) => question.id))) ctx.addIssue({ code: "custom", message: "Duplicate planner question IDs" });
  if (!unique(result.addressedQuestionIds)) ctx.addIssue({ code: "custom", message: "Duplicate addressed question IDs" });
});

export type PlanDraft = z.infer<typeof planDraftSchema>;
export interface PlanValidationIssue { path: (string | number)[]; message: string; code: string; knownIds?: string[]; suggestedValues?: string[] }
/** Local preflight for tool callers: bounded, repair-ready data, never a Zod stack. */
export function validatePlanInput(value: unknown): { ok: true; draft: PlanDraft } | { ok: false; error: { code: "INVALID_PLAN"; issues: PlanValidationIssue[] } } {
  const parsed = planDraftSchema.safeParse(value);
  if (parsed.success) return { ok: true, draft: parsed.data };
  return { ok: false, error: { code: "INVALID_PLAN", issues: parsed.error.issues.slice(0, 16).map(issue => ({
    path: issue.path.map(part => typeof part === "number" ? part : String(part)), code: issue.code, message: issue.message.slice(0, 1000),
    ...(issue.code === "custom" && issue.params?.knownIds ? { knownIds: issue.params.knownIds, suggestedValues: issue.params.suggestedValues } : {}),
  })) } };
}

export const operationSchema = z.object({
  objective: text(2000), title: text(240).optional(), mode: z.enum(["inspect", "change", "verify"]).default("inspect"),
  reads: z.array(scopeSchema).max(64).default(["**"]).describe("Project-relative inspection scope; defaults to the project. Explicit empty reads are invalid for inspection."),
  writes: z.array(scopeSchema).max(64).default([]), checks: taskSpecSchema.shape.checks,
  skills: ids.default([]), environment: taskSpecSchema.shape.environment,
}).strict().superRefine((operation, ctx) => {
  const issue = (path: string, message: string) => ctx.addIssue({ code: "custom", path: [path], message });
  if (!operation.reads.length && !operation.writes.length) issue("reads", "Operation requires a nonempty reads or writes scope.");
  if (operation.mode === "inspect") {
    if (operation.writes.length) issue("writes", "Inspection cannot write files.");
    if (operation.checks.length) issue("checks", "Inspection cannot execute checks; use verify.");
    if (operation.environment?.prepare) ctx.addIssue({ code: "custom", path: ["environment", "prepare"], message: "Inspection cannot prepare an environment or execute commands." });
  }
  if (operation.mode === "change" && !operation.writes.length) issue("writes", "Change requires nonempty writes.");
  if (operation.mode === "verify") {
    if (!operation.checks.length) issue("checks", "Verify requires checks.");
    if (operation.writes.length) issue("writes", "Verify cannot declare writes.");
  }
  if (!unique(operation.skills)) issue("skills", "Duplicate skill IDs.");
  if (!unique(operation.checks.map(check => check.id))) issue("checks", "Duplicate check IDs.");
});
export type OperationInput = z.input<typeof operationSchema>;
export type OperationSpec = z.output<typeof operationSchema>;
export interface OperationRecord {
  id: string; objective: string; mode: OperationSpec["mode"]; status: PlanRecord["status"]; taskId: string; createdAt: string;
}
/** Canonical private work specification; inspect supports a direct-root read-only driver. */
export function operationWorkSpec(input: OperationInput): PlanDraft {
  const spec = operationSchema.parse(input), title = spec.title ?? spec.objective.slice(0, 240);
  return planDraftSchema.parse({ schemaVersion: 2, template: "fast", title, objective: spec.objective,
    acceptance: [{ id: "done", description: spec.objective }],
    tasks: [{ id: "work", title, role: "executor", reads: spec.reads, writes: spec.writes, checks: spec.checks,
      skills: spec.skills, environment: spec.environment, acceptance: ["done"], instructions: spec.objective }],
    budgets: { maxAttempts: 2, maxParallel: 1, maxDurationMs: 3_600_000 },
  });
}
export type TaskSpec = z.infer<typeof taskSpecSchema>;
export type TaskResult = z.infer<typeof taskResultSchema>;
export type Question = z.infer<typeof questionSchema>;
export type EvidenceInput = z.infer<typeof evidenceInputSchema>;
export type PlannerResult = z.input<typeof plannerResultSchema>;
export interface ProposalRecord extends z.output<typeof plannerResultSchema> {
  id: string; parentSessionId: string; planId?: string; expectedRevision?: number;
  revision: number; updatedAt: string;
  status: "proposed" | "applied"; createdAt: string; questionIds: string[]; appliedAt?: string; appliedRevision?: number;
}
export interface RevisionRecord { schemaVersion: 2; planId: string; revision: number; draft: PlanDraft; reason: string }
export type AttemptStatus = "leased" | "running" | "submitted" | "succeeded" | "failed" | "lost" | "cancelled";
export type TaskStatus = "queued" | AttemptStatus;
export interface PlanRecord {
  schemaVersion: 2; id: string; revision: number; status: "active" | "paused" | "succeeded" | "failed" | "cancelled";
  draft: PlanDraft; tasks: (TaskSpec & { status: TaskStatus })[]; createdAt: string; updatedAt: string;
}
export interface AttemptRecord {
  schemaVersion: 2; id: string; planId: string; taskId: string; revision: number; status: AttemptStatus;
  sessionId?: string; workspacePath: string; snapshotId: string; isolated: boolean;
  createdAt: string; updatedAt: string; result?: TaskResult; integratedSnapshotId?: string; reason?: string;
  startedAt?: string; runningDurationMs?: number;
}
export interface EvidenceRecord extends EvidenceInput {
  schemaVersion: 2; id: string; attemptId: string; planId: string; taskId: string; revision: number; createdAt: string;
}
export interface QuestionRecord extends Question {
  schemaVersion: 2; status: "pending" | "answered" | "cancelled"; createdAt: string; answeredAt?: string; answers?: string[];
}
export interface DependencyReference { taskId: string; attemptId: string; resultRef: string }
export interface DependencySummary extends DependencyReference {
  summary: string; outcome: TaskResult["outcome"];
  criteria: Pick<TaskResult["criteria"][number], "id" | "status">[];
  findingsCount: number; artifactsCount: number; integratedSnapshotId?: string;
}
export type DependencySection = "summary" | "findings" | "criteria" | "artifacts" | "blockers";
export interface DependencyResultOptions { section: DependencySection; offset?: number; limit?: number }
export type DependencyResultEntry = TaskResult["findings"][number] | TaskResult["criteria"][number] |
  TaskResult["blockers"][number] | string | Pick<TaskResult, "schemaVersion" | "outcome" | "summary" | "next">;
/** Oversized entries are explicit JSON fragments. Join json by itemIndex/part then JSON.parse.
 * offset/nextOffset address stable page units (entries or fragments), not array indices. */
export type DependencyResultItem = { itemIndex: number; value: DependencyResultEntry } |
  { itemIndex: number; part: number; parts: number; json: string };
export interface DependencyResultPage extends DependencyReference {
  section: DependencySection; offset: number; total: number; items: DependencyResultItem[]; nextOffset?: number;
  integratedSnapshotId?: string;
}
export interface AssignmentPacket {
  schemaVersion: 2; attemptId: string; planId: string; revision: number; objective: string; task: TaskSpec;
  workspacePath: string; snapshotId: string; acceptance: PlanDraft["acceptance"]; constraints: string[];
  sources: PlanDraft["sources"]; decisions: PlanDraft["decisions"];
  answeredQuestions: QuestionRecord[];
  dependencies: DependencySummary[];
  dependencyRefs: DependencyReference[];
  dependencySummariesOmitted: number;
}
export interface EventRecord { id: number; planId: string | null; type: string; entityId: string; createdAt: string }
export interface Digest {
  schemaVersion: 2; plans: { id: string; revision: number; status: PlanRecord["status"]; title: string; tasks: Partial<Record<TaskStatus, number>> }[];
  events: EventRecord[]; cursor: number;
}

type TemplateInput = Partial<Omit<PlanDraft, "template" | "schemaVersion">>;
function template(kind: PlanDraft["template"], input: TemplateInput = {}): PlanDraft {
  const acceptance = input.acceptance ?? [{ id: "done", description: kind === "investigation" ? "Findings cite sources and answer the objective" : "Objective is implemented and verified" }];
  const work: TaskSpec = {
    id: "work", title: kind === "investigation" ? "Investigate the objective" : "Implement and verify the objective",
    role: kind === "investigation" ? "researcher" : "executor", dependsOn: [], reads: ["src/**"],
    writes: kind === "investigation" ? [] : ["src/**"], resources: [], skills: [], sourceIds: [], decisionIds: [], acceptance: acceptance.map((criterion) => criterion.id), checks: [],
  };
  const tasks: TaskSpec[] = [work];
  if (kind === "critical" || kind === "release") tasks.push({ ...work, id: "review", title: "Review changed scope and acceptance evidence", role: "reviewer", dependsOn: ["work"], writes: [] });
  return planDraftSchema.parse({ schemaVersion: 2, template: kind, title: `${kind} work`, objective: "Complete the stated objective with supporting evidence", acceptance, tasks, ...input });
}
export const planTemplates = {
  fast: (input?: TemplateInput) => template("fast", input),
  standard: (input?: TemplateInput) => template("standard", input),
  investigation: (input?: TemplateInput) => template("investigation", input),
  critical: (input?: TemplateInput) => template("critical", input),
  release: (input?: TemplateInput) => template("release", input),
};
