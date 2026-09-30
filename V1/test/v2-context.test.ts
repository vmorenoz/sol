import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SolCore, planTemplates, type TaskResult } from "../src/v2/core.js";
import { compileAssignmentContext } from "../src/v2/context.js";
import { EvidenceRunner } from "../src/v2/evidence.js";

const dirs: string[] = [], cores: SolCore[] = [];
afterEach(() => { cores.splice(0).forEach((core) => core.close()); dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })); });
function setup() {
  const base = mkdtempSync(join(tmpdir(), "v2-context-")); dirs.push(base);
  const root = join(base, "project"); mkdirSync(root); mkdirSync(join(root, "src")); mkdirSync(join(root, "docs"));
  const core = new SolCore(root, ":memory:"); cores.push(core);
  const draft = planTemplates.standard();
  draft.sources = ["src/a.ts", "src/b.ts", "docs/private.md", "src/missing.ts", "src/escape.ts"].map((path, i) => ({ id: `s${i}`, path, reason: "Declared input" }));
  draft.tasks[0]!.sourceIds = ["s0", "s1", "s3", "s4"];
  writeFileSync(join(root, "src/a.ts"), "a".repeat(9000)); writeFileSync(join(root, "src/b.ts"), "b".repeat(9000));
  writeFileSync(join(root, "docs/private.md"), "private"); writeFileSync(join(base, "outside"), "outside secret"); symlinkSync(join(base, "outside"), join(root, "src/escape.ts"));
  const plan = core.createPlan(draft);
  const attempt = core.leaseAttempt(plan.id, "work", { workspacePath: root, snapshotId: "base", isolated: false });
  return { core, root, attempt, draft };
}
function isolatedKnowledge() {
  const base = mkdtempSync(join(tmpdir(), "v2-knowledge-")); dirs.push(base);
  const root = join(base, "project"), workspace = join(base, "worker");
  mkdirSync(root); mkdirSync(workspace);
  mkdirSync(join(root, ".sol", "knowledge"), { recursive: true });
  mkdirSync(join(root, ".sol", "decisions"));
  const paths = [".sol/knowledge/domain.md", ".sol/decisions/architecture.md", ".sol/PROJECT.md", ".sol/STRATEGY.md", ".sol/POLICIES.yml",
    ".sol/state.db", ".sol/tokens.json", ".sol/decisions/hidden.md", "ordinary.md", ".sol/knowledge/missing.md"];
  for (const path of paths.slice(0, -1)) writeFileSync(join(root, path), `Content of ${path}`);
  const core = new SolCore(root, ":memory:"); cores.push(core);
  const draft = planTemplates.fast();
  draft.sources = paths.map((path, index) => ({ id: `k${index}`, path, reason: "Declared knowledge" }));
  draft.tasks[0]!.sourceIds = draft.sources.filter(source => source.id !== "k7").map(source => source.id);
  draft.tasks[0]!.reads = ["**"];
  const quote = (value: string): string => `'${value.replaceAll("'", "'\\''")}'`;
  draft.tasks[0]!.checks = [{ id: "check", command: `${quote(process.execPath)} -e ${quote("process.exit(0)")}`, timeoutMs: 3000 }];
  const plan = core.createPlan(draft);
  const attempt = core.leaseAttempt(plan.id, "work", { workspacePath: workspace, snapshotId: "isolated", isolated: true });
  core.startAttempt(attempt.id, "worker");
  return { core, root, workspace, attempt, draft, runner: new EvidenceRunner(core, join(base, "evidence")) };
}
describe("v2 bounded assignment context", () => {
  it("filters declared sources by scope, bounds snippets and reports absent/unsafe sources as unknown", () => {
    const { core, attempt, draft } = setup();
    const packet = core.assignment(attempt.id);
    vi.spyOn(core, "assignment").mockReturnValue({ ...packet, sources: draft.sources, task: { ...packet.task, sourceIds: [] } });
    const context = compileAssignmentContext(core, attempt.id);
    expect(context.sources.map((source) => source.path)).not.toContain("docs/private.md");
    expect(context.sourceSnippets.reduce((sum, source) => sum + Buffer.byteLength(source.snippet ?? ""), 0)).toBe(12288);
    expect(context.sourceSnippets.find((source) => source.id === "s1")?.truncated).toBe(true);
    expect(context.sourceSnippets.filter((source) => source.status === "unknown").map((source) => source.id)).toEqual(["s3", "s4"]);
    expect(context.acceptance).toEqual(core.assignment(attempt.id).acceptance);
    expect(JSON.stringify(context)).not.toContain("outside secret");
  });
  it("fingerprints only relevant declared source contents, including beyond snippets", () => {
    const { core, root, attempt } = setup();
    const initial = compileAssignmentContext(core, attempt.id).sourceFingerprint;
    writeFileSync(join(root, "docs/private.md"), "unrelated change");
    expect(compileAssignmentContext(core, attempt.id).sourceFingerprint).toBe(initial);
    writeFileSync(join(root, "src/b.ts"), "b".repeat(8999) + "c");
    expect(compileAssignmentContext(core, attempt.id).sourceFingerprint).not.toBe(initial);
  });
  it("supports explicit source IDs and skills supplied by an extended core packet", () => {
    const { core, attempt, draft } = setup();
    const packet = { ...core.assignment(attempt.id), sources: draft.sources };
    vi.spyOn(core, "assignment").mockReturnValue({ ...packet, task: { ...packet.task, reads: [], writes: [], sourceIds: ["s2"], skills: ["review"] } } as typeof packet);
    const context = compileAssignmentContext(core, attempt.id);
    expect(context.sources.map((source) => source.id)).toEqual(["s2"]); expect(context.skills).toEqual(["review"]);
    vi.mocked(core.assignment).mockReturnValue({ ...packet, task: { ...packet.task, reads: [], writes: [], sourceIds: [] } });
    expect(compileAssignmentContext(core, attempt.id).sourceFacts).toBe("unknown");
  });
  it("preserves accepted dependency results and integration references", () => {
    const { core, root, draft, attempt } = setup();
    core.failAttempt(attempt.id, "Release fixture reservation", false);
    const work = { ...draft.tasks[0]!, writes: [] };
    draft.tasks = [work, { ...work, id: "follow", dependsOn: ["work"] }];
    const plan = core.createPlan(draft);
    const first = core.leaseAttempt(plan.id, "work", { workspacePath: root, snapshotId: "base", isolated: true });
    core.startAttempt(first.id, "session");
    const evidence = core.recordEvidence(first.id, { kind: "inspection", summary: "Read relevant source", snapshotId: "base" });
    const result: TaskResult = { schemaVersion: 2, outcome: "completed", summary: "Dependency facts", criteria: [{ id: "done", status: "satisfied", evidenceRefs: [evidence.id] }], findings: [], blockers: [], artifacts: [] };
    core.submitResult(first.id, result); core.acceptAttempt(first.id, { integratedSnapshotId: "integrated" });
    const next = core.leaseAttempt(plan.id, "follow", { workspacePath: root, snapshotId: "next", isolated: true });
    expect(compileAssignmentContext(core, next.id).dependencies).toEqual([{ taskId: "work", attemptId: first.id, resultRef: first.id,
      summary: result.summary, outcome: result.outcome, criteria: [{ id: "done", status: "satisfied" }],
      findingsCount: 0, artifactsCount: 0, integratedSnapshotId: "integrated" }]);
  });
  it("loads only explicitly selected approved project knowledge when the isolated workspace lacks it", () => {
    const { core, attempt, draft } = isolatedKnowledge();
    // Exercise filtering even with a core packet containing nonselected declarations.
    const packet = core.assignment(attempt.id);
    vi.spyOn(core, "assignment").mockReturnValue({ ...packet, sources: draft.sources });
    const context = compileAssignmentContext(core, attempt.id);
    for (const id of ["k0", "k1", "k2", "k3", "k4"]) {
      expect(context.sourceSnippets.find(source => source.id === id)).toMatchObject({ origin: "project-knowledge", status: "available" });
    }
    expect(context.sourceSnippets.find(source => source.id === "k0")?.snippet).toBe("Content of .sol/knowledge/domain.md");
    for (const id of ["k5", "k6", "k8", "k9"]) expect(context.sourceSnippets.find(source => source.id === id)?.status).toBe("unknown");
    expect(context.sources.some(source => source.id === "k7")).toBe(false);
    expect(context.acceptance).toEqual(packet.acceptance);
    expect(JSON.stringify(context)).not.toContain("Content of .sol/state.db");
    expect(JSON.stringify(context)).not.toContain("Content of ordinary.md");
  });
  it("hashes full fallback content and invalidates named evidence when project knowledge changes", async () => {
    const { core, root, runner, attempt } = isolatedKnowledge();
    writeFileSync(join(root, ".sol/knowledge/domain.md"), "a".repeat(20000));
    const before = compileAssignmentContext(core, attempt.id);
    expect(before.sourceSnippets.reduce((sum, source) => sum + Buffer.byteLength(source.snippet ?? ""), 0)).toBe(12288);
    expect((await runner.run(attempt.id, "check")).exitCode).toBe(0);
    writeFileSync(join(root, ".sol/decisions/hidden.md"), "Unselected change");
    expect(compileAssignmentContext(core, attempt.id).sourceFingerprint).toBe(before.sourceFingerprint);
    expect(() => runner.verifyCurrent(attempt.id)).not.toThrow();
    writeFileSync(join(root, ".sol/knowledge/domain.md"), "a".repeat(19999) + "b");
    expect(compileAssignmentContext(core, attempt.id).sourceFingerprint).not.toBe(before.sourceFingerprint);
    expect(() => runner.verifyCurrent(attempt.id)).toThrow(/Stale check/);
  });
  it("rejects fallback symlinks outside the project or into internal state, and oversized knowledge", () => {
    const { core, root, workspace, attempt } = isolatedKnowledge();
    writeFileSync(join(workspace, "outside.md"), "outside secret");
    rmSync(join(root, ".sol/knowledge/domain.md"));
    symlinkSync(join(workspace, "outside.md"), join(root, ".sol/knowledge/domain.md"));
    rmSync(join(root, ".sol/decisions/architecture.md"));
    symlinkSync(join(root, ".sol/state.db"), join(root, ".sol/decisions/architecture.md"));
    writeFileSync(join(root, ".sol/PROJECT.md"), Buffer.alloc(1024 * 1024 + 1));
    const context = compileAssignmentContext(core, attempt.id);
    for (const id of ["k0", "k1", "k2"]) expect(context.sourceSnippets.find(source => source.id === id)?.status).toBe("unknown");
    expect(JSON.stringify(context)).not.toContain("outside secret");
    expect(JSON.stringify(context)).not.toContain("Content of .sol/state.db");
  });
  it("prefers workspace knowledge when present and identifies ordinary workspace sources", () => {
    const { core, workspace, attempt } = isolatedKnowledge();
    mkdirSync(join(workspace, ".sol/knowledge"), { recursive: true });
    writeFileSync(join(workspace, ".sol/knowledge/domain.md"), "Snapshot knowledge");
    writeFileSync(join(workspace, "ordinary.md"), "Snapshot source");
    const context = compileAssignmentContext(core, attempt.id);
    expect(context.sourceSnippets.find(source => source.id === "k0")).toMatchObject({ origin: "workspace", snippet: "Snapshot knowledge" });
    expect(context.sourceSnippets.find(source => source.id === "k8")).toMatchObject({ origin: "workspace", snippet: "Snapshot source" });
  });
  it("loads explicitly selected initialized project documents from the original project", () => {
    const base = mkdtempSync(join(tmpdir(), "v2-project-context-")); dirs.push(base);
    const root = join(base, "project"), workspace = join(base, "worker"); mkdirSync(root); mkdirSync(workspace);
    mkdirSync(join(root, ".sol", "project"), { recursive: true });
    writeFileSync(join(root, ".sol", "project", "architecture.md"), "# Architecture\nSource-backed project boundaries");
    const core = new SolCore(root, ":memory:"); cores.push(core);
    const draft = planTemplates.fast();
    draft.sources = [{ id: "architecture", path: ".sol/project/architecture.md", reason: "Initialized project context" }];
    draft.tasks[0]!.sourceIds = ["architecture"];
    const plan = core.createPlan(draft);
    const attempt = core.leaseAttempt(plan.id, "work", { workspacePath: workspace, snapshotId: "isolated", isolated: true });
    expect(compileAssignmentContext(core, attempt.id).sourceSnippets[0]).toMatchObject({
      path: ".sol/project/architecture.md", origin: "project-knowledge", status: "available", snippet: "# Architecture\nSource-backed project boundaries",
    });
  });
});
