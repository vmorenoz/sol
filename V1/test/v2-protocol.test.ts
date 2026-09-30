import { describe, expect, it } from "vitest";
import { operationSchema, operationWorkSpec, validatePlanInput, planDraftSchema, planTemplates, plannerResultSchema, questionSchema, taskResultSchema } from "../src/v2/protocol.js";

describe("v2 protocol", () => {
  it("generates deterministic operation work with internal criteria and safe inspection defaults", () => {
    const input = { objective: "Explain the project" };
    expect(operationSchema.parse(input)).toEqual({ ...input, mode: "inspect", reads: ["**"], writes: [], checks: [], skills: [] });
    const work = operationWorkSpec(input);
    expect(operationWorkSpec(operationSchema.parse(input))).toEqual(work);
    expect(work.acceptance).toEqual([{ id: "done", description: input.objective }]);
    expect(work.tasks[0]).toMatchObject({ role: "executor", acceptance: ["done"], reads: ["**"], checks: [], writes: [] });
    for (const extra of [{ reads: [] }, { writes: ["src/**"] }, { checks: [{ id: "analyze", command: "flutter analyze" }] },
      { environment: { prepare: { command: "flutter analyze" } } }, { reads: ["../outside"] }, { acceptance: ["a1"] }, { model: "model-id" }]) {
      expect(operationSchema.safeParse({ ...input, ...extra }).success).toBe(false);
    }
    expect(operationSchema.safeParse({ ...input, mode: "change" }).success).toBe(false);
    expect(operationSchema.safeParse({ ...input, mode: "change", reads: [], writes: ["src/**"] }).success).toBe(true);
    expect(operationSchema.safeParse({ ...input, mode: "verify" }).success).toBe(false);
    expect(operationSchema.safeParse({ ...input, mode: "verify", checks: [{ id: "test", command: "npm test" }] }).success).toBe(true);
    expect(operationSchema.safeParse({ ...input, mode: "verify", writes: ["src/**"], checks: [{ id: "test", command: "npm test" }] }).success).toBe(false);
  });

  it("returns precise repair-ready legal criterion references without rewriting semantics", () => {
    const draft = planTemplates.investigation({ acceptance: [{ id: "a1", description: "Explain source layout" }] });
    for (const reference of ["Explain source layout", "invented-id"]) {
      const input = { ...draft, tasks: [{ ...draft.tasks[0], acceptance: [reference] }] };
      const validation = validatePlanInput(input);
      expect(validation.ok).toBe(false);
      if (validation.ok) throw new Error("Expected invalid plan");
      expect(validation.error.code).toBe("INVALID_PLAN");
      expect(validation.error.issues).toContainEqual(expect.objectContaining({ path: ["tasks", 0, "acceptance", 0], knownIds: ["a1"], suggestedValues: ["a1"] }));
      expect(JSON.stringify(validation)).toContain('[\\"a1\\"]');
      expect(input.tasks[0]!.acceptance).toEqual([reference]);
    }
    const third = validatePlanInput({ ...draft, tasks: [{ ...draft.tasks[0], reads: [], instructions: "Inspect the project" }] });
    expect(third.ok).toBe(false);
    if (!third.ok) expect(third.error.issues).toContainEqual(expect.objectContaining({ path: ["tasks", 0, "reads"] }));
    const { reads: _reads, ...unscoped } = draft.tasks[0]!;
    const omitted = validatePlanInput({ ...draft, tasks: [{ ...unscoped, instructions: "Inspect the project" }] });
    expect(omitted.ok).toBe(false);
    if (!omitted.ok) expect(omitted.error.issues).toContainEqual(expect.objectContaining({ path: ["tasks", 0, "reads"] }));
    expect(validatePlanInput(draft)).toEqual({ ok: true, draft });
    const oversized = validatePlanInput({ ...draft, tasks: Array.from({ length: 64 }, () => ({ ...draft.tasks[0], acceptance: ["unknown"] })) });
    if (!oversized.ok) expect(oversized.error.issues.length).toBeLessThanOrEqual(16);
  });
  it("preserves typed task environment preparation and generated outputs", () => {
    const draft = planTemplates.fast();
    draft.tasks[0]!.environment = { prepare: { command: "npm ci", timeoutMs: 60000 }, generatedOutputs: ["node_modules/**"] };
    expect(planDraftSchema.parse(draft).tasks[0]?.environment).toEqual(draft.tasks[0]!.environment);
    expect(planDraftSchema.safeParse({ ...draft, tasks: [{ ...draft.tasks[0], environment: { generatedOutputs: ["../escape"] } }] }).success).toBe(false);
  });

  it("requires a scoped read-only downstream reviewer for critical and release writers", () => {
    for (const kind of ["critical", "release"] as const) {
      const draft = planTemplates[kind](), writer = draft.tasks[0]!, reviewer = draft.tasks[1]!;
      for (const changes of [{ role: "verifier" }, { reads: [] }, { writes: ["src/**"] }, { dependsOn: [] }]) {
        expect(planDraftSchema.safeParse({ ...draft, tasks: [writer, { ...reviewer, ...changes }] }).success).toBe(false);
      }
    }
  });

  it("defaults task context selectors and validates planner artifacts independently of task results", () => {
    const d = planTemplates.fast();
    expect(d.tasks[0]).toMatchObject({ skills: [], sourceIds: [], decisionIds: [] });
    expect(planDraftSchema.safeParse({ ...d, tasks: [{ ...d.tasks[0], sourceIds: ["unknown"] }] }).success).toBe(false);
    expect(planDraftSchema.safeParse({ ...d, tasks: [{ ...d.tasks[0], decisionIds: ["unknown"] }] }).success).toBe(false);
    const planner = { schemaVersion: 2, summary: "Technical plan", plan: d, questions: [], reason: "Matches the objective" };
    expect(plannerResultSchema.safeParse(planner).success).toBe(true);
    expect(plannerResultSchema.parse(planner).addressedQuestionIds).toEqual([]);
    expect(plannerResultSchema.safeParse({ ...planner, addressedQuestionIds: ["q", "q"] }).success).toBe(false);
    expect(plannerResultSchema.safeParse({ ...planner, addressedQuestionIds: [123] }).success).toBe(false);
    expect(taskResultSchema.safeParse(planner).success).toBe(false);
    const q = { id: "q", taskIds: [], header: "Scope", question: "Which scope?", options: [{ label: "A", description: "First" }], multiple: false, reason: "Missing scope", material: true };
    expect(plannerResultSchema.safeParse({ ...planner, questions: Array.from({ length: 4 }, (_, i) => ({ ...q, id: `q${i}` })) }).success).toBe(false);
  });
  it("provides minimal bounded templates, with no planner in fast", () => {
    const fast = planTemplates.fast();
    expect(fast.schemaVersion).toBe(2);
    expect(fast.tasks.map((task) => task.role)).toEqual(["executor"]);
    expect(fast.budgets).toEqual({ maxAttempts: 2, maxParallel: 4, maxDurationMs: 3_600_000 });
    expect(planTemplates.standard().tasks).toHaveLength(1);
    expect(planTemplates.investigation().tasks.every((task) => !task.writes.length)).toBe(true);
    for (const kind of ["critical", "release"] as const) {
      const draft = planTemplates[kind]();
      expect(draft.tasks).toHaveLength(2);
      expect(draft.tasks[1]).toMatchObject({ role: "reviewer", dependsOn: ["work"], writes: [] });
      expect(() => planDraftSchema.parse({ ...draft, tasks: [draft.tasks[0]] })).toThrow(/review/);
    }
  });

  it("rejects incomplete plan fields rather than treating a malformed plan as a questions-only result", () => {
    const complete = planTemplates.fast();
    for (const field of ["schemaVersion", "template", "title", "objective", "acceptance", "tasks"] as const) {
      const incomplete: Record<string, unknown> = { ...complete }; delete incomplete[field];
      expect(planDraftSchema.safeParse(incomplete).success, field).toBe(false);
      expect(plannerResultSchema.safeParse({ schemaVersion: 2, summary: "Draft", plan: incomplete, questions: [], reason: "Scope" }).success, field).toBe(false);
    }
    expect(plannerResultSchema.safeParse({ schemaVersion: 2, summary: "Questions only", questions: [], reason: "Need scope" }).success).toBe(true);
  });

  it("rejects graph ambiguity, missing coverage and unsafe scopes", () => {
    const base = planTemplates.standard();
    const task = base.tasks[0]!;
    for (const tasks of [
      [task, task],
      [{ ...task, dependsOn: ["missing"] }],
      [{ ...task, dependsOn: ["work"] }],
      [{ ...task, id: "a", dependsOn: ["b"] }, { ...task, id: "b", dependsOn: ["a"] }],
      [{ ...task, acceptance: ["missing"] }],
      [{ ...task, checks: [{ id: "same", command: "true" }, { id: "same", command: "false" }] }],
    ]) expect(planDraftSchema.safeParse({ ...base, tasks }).success).toBe(false);
    expect(planDraftSchema.safeParse({ ...base, acceptance: [...base.acceptance, { id: "uncovered", description: "not assigned" }] }).success).toBe(false);
    for (const scope of ["../secret", "src/../../secret", "/etc/passwd", "C:\\temp", "src\\..\\secret", "src/./a", "src//a", "a\u0000b"]) {
      expect(planDraftSchema.safeParse({ ...base, tasks: [{ ...task, writes: [scope] }] }).success, scope).toBe(false);
    }
    expect(planDraftSchema.safeParse({ ...base, tasks: [{ ...task, reads: ["src/**", "test/*.ts"] }] }).success).toBe(true);
  });

  it("enforces template invariants, strict version and numeric/text budgets", () => {
    const draft = planTemplates.fast();
    expect(planDraftSchema.safeParse({ ...draft, schemaVersion: 1 }).success).toBe(false);
    expect(planDraftSchema.safeParse({ ...draft, title: "x".repeat(241) }).success).toBe(false);
    expect(planDraftSchema.safeParse({ ...draft, budgets: { ...draft.budgets, maxAttempts: 100 } }).success).toBe(false);
    expect(planDraftSchema.safeParse({ ...draft, tasks: [{ ...draft.tasks[0], role: "planner" }] }).success).toBe(false);
    expect(planDraftSchema.safeParse({ ...draft, template: "investigation" }).success).toBe(false);
    expect(planDraftSchema.safeParse({ ...draft, sneaky: true }).success).toBe(false);
  });

  it("validates result references and native question options without mixing hypotheses into facts", () => {
    const result = { schemaVersion: 2, outcome: "completed", summary: "done", criteria: [{ id: "done", status: "satisfied", evidenceRefs: ["ev"] }], findings: [{ statement: "Possible cause", source: "src/core.ts", kind: "hypothesis" }], blockers: [], artifacts: [] };
    expect(taskResultSchema.safeParse(result).success).toBe(true);
    expect(taskResultSchema.safeParse({ ...result, criteria: [...result.criteria, ...result.criteria] }).success).toBe(false);
    const question = { id: "q", taskIds: [], header: "Direction", question: "Which option?", options: [{ label: "A", description: "First option" }], multiple: false, reason: "Changes acceptance", material: true };
    expect(questionSchema.safeParse(question).success).toBe(true);
    const { taskIds: _taskIds, ...planless } = question;
    expect(questionSchema.parse(planless).taskIds).toEqual([]);
    expect(questionSchema.safeParse({ ...question, taskIds: ["work"] }).success).toBe(false);
    expect(questionSchema.safeParse({ ...planless, taskIds: ["work"] }).success).toBe(false);
    expect(questionSchema.safeParse({ ...question, options: [...question.options, ...question.options] }).success).toBe(false);
  });
});
