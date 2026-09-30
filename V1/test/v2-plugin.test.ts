import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Hooks, PluginInput, ToolContext } from "@opencode-ai/plugin";
import { createOpencodeClient } from "@opencode-ai/sdk";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SolPlugin, type V2PluginOptions } from "../src/v2/plugin.js";
import { SolCore, planTemplates } from "../src/v2/core.js";
import { SolMcpClient } from "../src/v2/transport.js";
import { BROWNFIELD_CODE_MAP_DOCUMENTS, PROJECT_KNOWLEDGE_CONTRACTS, PROJECT_KNOWLEDGE_DOCUMENTS } from "../src/v2/project-knowledge.js";
import type { HostAdapter } from "../src/v2/host.js";
import type { AssignmentContext } from "../src/v2/context.js";
import type { PlannerResult, Question, TaskResult } from "../src/v2/protocol.js";

const cleanups: (() => void | Promise<void>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); vi.restoreAllMocks(); });

class NativeHost implements HostAdapter {
  sessions = new Map<string, Parameters<HostAdapter["createSession"]>[0]>();
  work: HostAdapter["prompt"] = async () => { throw new Error("Unexpected native prompt"); };
  prompt = vi.fn<HostAdapter["prompt"]>(input => this.work(input));
  activity = vi.fn<HostAdapter["activity"]>(async () => {});
  async createSession(input: Parameters<HostAdapter["createSession"]>[0]) {
    const id = `native-${this.sessions.size}`; this.sessions.set(id, input); return id;
  }
  async abort() {}
  async status() { return "idle" as const; }
  async lastResult() { return undefined; }
}

function context(directory: string, sessionID = "primary", agent = "sol"): ToolContext {
  return { directory, worktree: directory, sessionID, agent, messageID: `message-${sessionID}`,
    abort: new AbortController().signal, metadata: vi.fn(), ask: vi.fn(async () => {}) };
}
async function execute(hooks: Hooks, name: string, args: Record<string, unknown>, ctx: ToolContext) {
  const result = await hooks.tool![name]!.execute(args, ctx);
  expect(typeof result).toBe("string");
  return JSON.parse(result as string);
}
async function setup(client?: PluginInput["client"], mcpFactory?: V2PluginOptions["mcpFactory"]) {
  const base = realpathSync(mkdtempSync(join(tmpdir(), "plugin-integration-"))), root = join(base, "project");
  mkdirSync(root); cleanups.push(() => rmSync(base, { recursive: true, force: true }));
  const host = new NativeHost(), databasePath = join(base, "state.sqlite");
  const core = new SolCore(root, databasePath); cleanups.push(() => core.close());
  const options: V2PluginOptions = { databasePath, storageRoot: join(base, "storage"), ...(client ? {} : { host }),
    mcpFactory: mcpFactory ?? ((projectRoot, databasePath) => new SolMcpClient({ projectRoot, databasePath,
      entrypoint: fileURLToPath(new URL("../dist/v2/mcp.js", import.meta.url)) })),
  };
  // Native host is injected; these SDK-only capabilities are intentionally unused.
  const input: PluginInput = { directory: root, worktree: root, serverUrl: new URL("http://localhost:1"),
    client: client ?? {} as PluginInput["client"], project: { id: "project", worktree: root, time: { created: 0 } },
    experimental_workspace: { register() {} }, $: {} as PluginInput["$"] };
  const start = async () => {
    const hooks = await SolPlugin(input, { ...options });
    let closed = false;
    const dispose = async () => { if (!closed) { closed = true; await hooks.dispose!(); } };
    cleanups.push(dispose); return { hooks, dispose };
  };
  const workspaces = () => {
    const directory = join(options.storageRoot!, createHash("sha256").update(root).digest("hex").slice(0, 24), "isolation", "workspaces");
    return existsSync(directory) ? readdirSync(directory) : [];
  };
  return { root, host, core, start, workspaces, ctx: context(root), ...await start() };
}
const question: Question = { id: "output-format", taskIds: [], header: "Format", question: "Which output format?",
  options: [{ label: "Plain", description: "Plain text output" }, { label: "JSON", description: "Structured output" }],
  multiple: false, reason: "Determines the implementation", material: true };
function canonicalKnowledge(path: keyof typeof PROJECT_KNOWLEDGE_CONTRACTS, sources: string[] = []) {
  const contract = PROJECT_KNOWLEDGE_CONTRACTS[path];
  const metadata = ["---", "schemaVersion: 1", `id: ${contract.id}`, `kind: ${contract.kind}`];
  if (sources.length) metadata.push("sources:", ...sources.map(source => `  - path: ${source}`));
  metadata.push("---", `# ${contract.id}`);
  return `${metadata.join("\n")}\n${contract.requiredHeadings.map(heading => `## ${heading}\nSubstantive information about ${heading.toLowerCase()}.`).join("\n")}\n`;
}

describe("SolPlugin production orchestration", () => {
  it("uses stable project-status selection for fresh original-project observations", async () => {
    const call = vi.fn<SolMcpClient["call"]>(async () => { throw new Error("Query must not call MCP"); });
    const s = await setup(undefined, () => ({ call, close: async () => {} }));
    const createSession = vi.spyOn(s.host, "createSession");
    execFileSync("git", ["init", "--quiet", "--initial-branch=inquiry-source"], { cwd: s.root });
    writeFileSync(join(s.root, "README.md"), "Project overview");
    execFileSync("git", ["add", "README.md"], { cwd: s.root });
    writeFileSync(join(s.root, "README.md"), "Current project overview");
    writeFileSync(join(s.root, "untracked.txt"), "User work");
    const query = await execute(s.hooks, "sol_query", {}, s.ctx);
    expect(query).toMatchObject({ provenance: { directory: s.root, kind: "original-project" },
      git: { directory: s.root, branch: "inquiry-source", detached: false, status: "known",
        changes: { total: 2, staged: 1, unstaged: 1, untracked: 1 } },
      checks: { executed: [], note: "No tests or analysis were executed" } });
    expect(query.queryId).toBe("project-status");
    expect(query.observationId).toEqual(expect.any(String));
    expect(query.evidenceRefs).toEqual([`observation:${query.observationId}`]);
    expect(s.core.listPlans()).toEqual([]);
    expect(s.core.planForSession("primary")).toBeUndefined();
    expect(s.workspaces()).toEqual([]);
    expect(createSession).not.toHaveBeenCalled();
    expect(call).not.toHaveBeenCalled();
    writeFileSync(join(s.root, "later.txt"), "Later state must not rewrite the observation");
    await s.dispose(); const restarted = await s.start();
    const otherDirectory = join(s.root, "other-directory"); mkdirSync(otherDirectory);
    const movedContext = context(otherDirectory);
    const fresh = await execute(restarted.hooks, "sol_query", { queryId: "project-status" }, movedContext);
    expect(fresh.provenance).toEqual({ directory: s.root, kind: "original-project" });
    expect(fresh.queryId).toBe("project-status");
    expect(fresh.observationId).not.toBe(query.observationId);
    expect(fresh.git.changes).toEqual({ total: 3, staged: 1, unstaged: 1, untracked: 2 });
    const solStatus = await execute(restarted.hooks, "sol_query", { queryId: "sol-status" }, movedContext);
    expect(solStatus).toMatchObject({ queryId: "sol-status", projectRoot: s.root, bounds: { recentWork: 8, recentAudit: 24 } });
    expect(solStatus.recentWork).toEqual([]);
    await expect(execute(restarted.hooks, "sol_query", { queryId: "unknown" }, movedContext))
      .rejects.toThrow('Unsupported queryId "unknown". Supported values: project-status, sol-status');
    expect(s.core.listPlans()).toEqual([]);
    expect(s.workspaces()).toEqual([]);
    expect(createSession).not.toHaveBeenCalled();
    expect(call).not.toHaveBeenCalled();
  });

  it("does not expose sol_execute and permits the coordinator to use native task", async () => {
    const s = await setup();
    expect(s.hooks.tool).not.toHaveProperty("sol_execute");
    await execute(s.hooks, "sol_query", {}, s.ctx);
    await expect(s.hooks["tool.execute.before"]!({ tool: "task", sessionID: "primary", callID: "native-task" }, { args: {} }))
      .resolves.toBeUndefined();
  });

  it("persists a resumable project wizard and completes only from safe mapped documents", async () => {
    const call = vi.fn<SolMcpClient["call"]>(async () => { throw new Error("Project initialization must not call MCP"); });
    const s = await setup(undefined, () => ({ call, close: async () => {} }));
    const createSession = vi.spyOn(s.host, "createSession");
    mkdirSync(join(s.root, "src")); writeFileSync(join(s.root, "src", "main.ts"), "export {};\n");
    const missing = await execute(s.hooks, "sol_project", { op: "status" }, s.ctx);
    expect(missing).toMatchObject({ onboarding: { state: "missing", revision: 0 }, offerAllowed: true,
      completeness: { complete: false, projectKind: "brownfield", missing: expect.arrayContaining(["index.md", "project.md", "architecture.md", "stack.md"]) } });
    const initialSystem = { system: [] as string[] };
    await s.hooks["experimental.chat.system.transform"]!({ sessionID: "primary", model: {} as Parameters<NonNullable<Hooks["experimental.chat.system.transform"]>>[0]["model"] }, initialSystem);
    expect(initialSystem.system[0]).toContain('"offerAllowed":true');
    const offered = await execute(s.hooks, "sol_project", { op: "offer", expectedRevision: 0 }, s.ctx);
    expect(offered).toMatchObject({ state: "offered", revision: 1, offeredSessionMarker: "primary" });
    expect((await execute(s.hooks, "sol_project", { op: "status" }, s.ctx)).offerAllowed).toBe(false);
    const active = await execute(s.hooks, "sol_project", { op: "begin", expectedRevision: 1,
      persistenceChoices: { sharedDocuments: true, privatePreferences: true } }, s.ctx);
    expect(active).toMatchObject({ state: "active", revision: 2, currentStage: "consent" });
    const updated = await execute(s.hooks, "sol_project", { op: "update", expectedRevision: 2, currentStage: "mapping",
      designChoice: "not-applicable", businessAnswers: [{ id: "purpose", answer: "Coordinate verified project work" }],
      privatePreferences: [{ id: "verification", answer: "Prefer focused checks" }] }, s.ctx);
    expect(updated).toMatchObject({ revision: 3, currentStage: "mapping" });
    const privateStatus = await execute(s.hooks, "sol_project", { op: "status" }, s.ctx);
    expect(privateStatus.onboarding).toMatchObject({ businessAnswerCount: 1, privatePreferenceIds: ["verification"] });
    expect(JSON.stringify(privateStatus)).not.toContain("Prefer focused checks");
    await expect(execute(s.hooks, "sol_project", { op: "complete", expectedRevision: 3, designChoice: "not-applicable" }, s.ctx))
      .rejects.toThrow(/incomplete/);
    mkdirSync(join(s.root, ".sol", "project"), { recursive: true });
    for (const name of PROJECT_KNOWLEDGE_DOCUMENTS.filter(name => name !== "design.md")) writeFileSync(join(s.root, ".sol", "project", name),
      canonicalKnowledge(name, (BROWNFIELD_CODE_MAP_DOCUMENTS as readonly string[]).includes(name) ? ["src/main.ts"] : []));
    const required = PROJECT_KNOWLEDGE_DOCUMENTS.filter(name => name !== "design.md");
    const recorded = await execute(s.hooks, "sol_project", { op: "update", expectedRevision: 3,
      completedDocumentIds: required }, s.ctx);
    expect(recorded.revision).toBe(4);
    const ready = await execute(s.hooks, "sol_project", { op: "complete", expectedRevision: 4, designChoice: "not-applicable" }, s.ctx);
    expect(ready).toMatchObject({ state: "ready", revision: 5, currentStage: "complete",
      completedDocumentIds: expect.arrayContaining(["index.md", "architecture.md", "project.md"]), lastCompletedAt: expect.any(String) });
    const contextResult = await execute(s.hooks, "sol_project", { op: "context", selected: ["index.md", "architecture.md"], preferenceIds: ["verification"] }, s.ctx);
    expect(contextResult.documents.map((document: { path: string }) => document.path)).toEqual(["index.md", "architecture.md"]);
    expect(contextResult.privatePreferences).toEqual([{ id: "verification", answer: "Prefer focused checks" }]);
    expect((await execute(s.hooks, "sol_project", { op: "context", selected: ["index.md"] }, s.ctx)).privatePreferences).toEqual([]);
    writeFileSync(join(s.root, "src", "main.ts"), "export const changed = true;\n");
    const stale = await execute(s.hooks, "sol_project", { op: "status" }, s.ctx);
    expect(stale).toMatchObject({ baseline: { status: "changed" }, affectedFocuses: expect.arrayContaining(["tech", "architecture", "quality", "concerns"]) });
    const refreshing = await execute(s.hooks, "sol_project", { op: "refresh", expectedRevision: 5,
      mode: "incremental", selectedFocuses: stale.affectedFocuses, scopePaths: ["src/main.ts"] }, s.ctx);
    expect(refreshing).toMatchObject({ state: "active", mappingMode: "incremental", scopePaths: ["src/main.ts"] });
    expect(s.core.listPlans()).toEqual([]); expect(s.workspaces()).toEqual([]);
    expect(createSession).not.toHaveBeenCalled(); expect(call).not.toHaveBeenCalled();
  });

  it("locally rejects two malformed acceptance references and empty reads before persisting the corrected draft through MCP", async () => {
    let core: SolCore;
    const call = vi.fn<SolMcpClient["call"]>(async (name, args) => {
      expect(name).toBe("sol_plan_create");
      return core.createPlan(args.draft as Parameters<SolCore["createPlan"]>[0]);
    });
    const s = await setup(undefined, () => ({ call, close: async () => {} }));
    core = s.core;
    const createSession = vi.spyOn(s.host, "createSession");
    const draft = planTemplates.fast({ objective: "Inspect project state" });
    draft.acceptance = [{ id: "a1", description: "Project state is backed by source observations" }];
    draft.tasks[0]!.reads = ["**"]; draft.tasks[0]!.writes = [];
    for (const reference of ["Project state is backed by source observations", "unknown-id"]) {
      draft.tasks[0]!.acceptance = [reference];
      const result = await execute(s.hooks, "sol_plan", { op: "create", draft }, s.ctx);
      expect(result).toMatchObject({ ok: false, error: { code: "INVALID_PLAN", issues: expect.arrayContaining([
        expect.objectContaining({ path: ["tasks", 0, "acceptance", 0], knownIds: ["a1"], suggestedValues: ["a1"] }),
      ]) } });
      expect(Object.keys(result)).toEqual(["ok", "error"]);
      expect(result.error.issues.length).toBeLessThanOrEqual(16);
      expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThan(4096);
      expect(call).not.toHaveBeenCalled();
      expect(createSession).not.toHaveBeenCalled();
      expect(s.core.listPlans()).toEqual([]);
    }
    draft.tasks[0]!.acceptance = ["a1"]; draft.tasks[0]!.reads = [];
    const empty = await execute(s.hooks, "sol_plan", { op: "create", draft }, s.ctx);
    expect(empty).toMatchObject({ ok: false, error: { code: "INVALID_PLAN" } });
    expect(empty.error.issues).toEqual(expect.arrayContaining([expect.objectContaining({ path: ["tasks", 0, "reads"] })]));
    expect(call).not.toHaveBeenCalled();
    expect(createSession).not.toHaveBeenCalled();
    expect(s.core.listPlans()).toEqual([]);
    draft.tasks[0]!.reads = ["**"];
    const created = await execute(s.hooks, "sol_plan", { op: "create", draft }, s.ctx);
    expect(s.core.getPlan(created.id).draft).toEqual(draft);
    expect(s.core.listPlans()).toHaveLength(1);
    expect(call).toHaveBeenCalledTimes(1);
    expect(createSession).not.toHaveBeenCalled();
  });

  it("uses the inherited authenticated in-process client for questions-only planning by default", async () => {
    const requests: Request[] = [];
    const globalFetch = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Unexpected new network client"));
    const fake = vi.fn<typeof fetch>(async (input, init) => {
      const request = new Request(input, init); requests.push(request.clone());
      if (new URL(request.url).pathname === "/session") return Response.json({ id: "inprocess-planner" });
      if (new URL(request.url).pathname === "/session/inprocess-planner/message") return Response.json({ info: {
        structured: { schemaVersion: 2, summary: "Clarify output", reason: "Material decision", questions: [question] } satisfies PlannerResult,
      }, parts: [] });
      throw new Error(`Unexpected request ${request.url}`);
    });
    const s = await setup(createOpencodeClient({ baseUrl: "http://inprocess.invalid", fetch: fake, headers: { Authorization: "Bearer test" } }));
    const result = await execute(s.hooks, "sol_plan", { op: "propose", objective: "Implement output" }, s.ctx);
    expect(result.nativeArguments.questions).toHaveLength(1);
    expect(s.core.getProposal(result.proposalId).plan).toBeUndefined();
    expect(s.core.listPlans()).toEqual([]);
    expect(requests).toHaveLength(2);
    expect(await requests[0]!.json()).toMatchObject({ parentID: "primary", agent: "sol-planner", metadata: { sol: { projectRoot: s.root, kind: "planning" } } });
    expect(await requests[1]!.json()).toMatchObject({ agent: "sol-planner", format: { type: "json_schema" } });
    for (const request of requests) {
      expect(new URL(request.url).origin).toBe("http://inprocess.invalid");
      expect(new URL(request.url).searchParams.get("directory")).toBe(s.root);
      expect(request.headers.get("authorization")).toBe("Bearer test");
    }
    expect(globalFetch).not.toHaveBeenCalled();
  });

  it("persists decision context and injects it into planning without a transcript", async () => {
    const s = await setup();
    const started = await execute(s.hooks, "sol_discuss", { op: "start", discussion: { objective: "Add export support",
      grayAreas: [{ id: "format", title: "Export format", context: "The output contract is not selected", status: "proposed" },
        { id: "delivery", title: "Delivery", context: "The destination is already established", status: "skipped" }] } }, s.ctx);
    const ready = await execute(s.hooks, "sol_discuss", { op: "complete", discussionId: started.id, expectedRevision: started.revision,
      final: { scopeBoundary: "Add JSON export only; do not add scheduled delivery",
        grayAreas: [{ id: "format", title: "Export format", context: "The output contract is not selected", status: "selected" },
          { id: "delivery", title: "Delivery", context: "The destination is already established", status: "skipped" }],
        decisions: [{ id: "json", areaId: "format", statement: "Use JSON", source: "user", reversibility: "reversible" }],
        deferred: ["Scheduled delivery"] } }, s.ctx);
    expect(ready).toMatchObject({ status: "ready", decisions: [{ statement: "Use JSON" }] });
    s.host.work = async request => {
      const packet = JSON.parse(request.prompt) as { planningContext: Record<string, unknown> };
      expect(packet.planningContext).toMatchObject({ id: ready.id, scopeBoundary: "Add JSON export only; do not add scheduled delivery",
        decisions: [{ statement: "Use JSON" }], deferred: ["Scheduled delivery"] });
      expect(JSON.stringify(packet)).not.toContain("Which format would you like");
      return { schemaVersion: 2, summary: "Clarify acceptance", reason: "Material acceptance decision", questions: [question] } satisfies PlannerResult;
    };
    await execute(s.hooks, "sol_plan", { op: "propose", objective: "Add export support" }, s.ctx);
    expect(s.host.prompt).toHaveBeenCalledOnce();
  });

  it.each([true, false])("routes similar questions to distinct IDs across restart (identical headers: %s)", async identicalHeaders => {
    const s = await setup();
    const second = { ...question, id: "second-format", header: identicalHeaders ? question.header : "Second format" };
    const response = await execute(s.hooks, "sol_ask", { questions: [question, second] }, s.ctx);
    // Reverse differing headers so matching by question/options alone cannot pass.
    if (!identicalHeaders) response.nativeArguments.questions.reverse();
    const request = { tool: "question", sessionID: "primary", callID: "paired-questions" };
    await s.hooks["tool.execute.before"]!(request, { args: response.nativeArguments });
    await s.dispose(); const restarted = await s.start();
    await restarted.hooks["tool.execute.after"]!({ ...request, args: response.nativeArguments }, {
      title: "Answers", output: "Do not infer answers from this prose", metadata: { answers: [["JSON"], ["Plain"]] },
    });
    expect(s.core.getQuestion(question.id)).toMatchObject({ status: "answered", answers: [identicalHeaders ? "JSON" : "Plain"] });
    expect(s.core.getQuestion(second.id)).toMatchObject({ status: "answered", answers: [identicalHeaders ? "Plain" : "JSON"] });
    expect((await execute(restarted.hooks, "sol_ask", {}, s.ctx)).nativeArguments.questions).toEqual([]);
  });

  it("creates through the MCP bridge, binds native execution, records proof and integrates without changing the user index", async () => {
    const s = await setup();
    writeFileSync(join(s.root, "contract.txt"), "The output must say verified.");
    writeFileSync(join(s.root, "user.txt"), "staged user work");
    execFileSync("git", ["init", "--quiet"], { cwd: s.root });
    execFileSync("git", ["add", "user.txt"], { cwd: s.root });
    const index = readFileSync(join(s.root, ".git", "index"));
    const draft = planTemplates.fast({ objective: "Write the verified output", sources: [{ id: "contract", path: "contract.txt", reason: "Output contract" }] });
    draft.tasks[0]!.reads = ["contract.txt"]; draft.tasks[0]!.writes = ["result.txt"]; draft.tasks[0]!.sourceIds = ["contract"];
    const created = await execute(s.hooks, "sol_plan", { op: "create", draft }, s.ctx);
    expect(s.core.getPlan(created.id).draft).toEqual(draft);
    const stdout = vi.spyOn(process.stdout, "write");
    s.host.work = async input => {
      const attempt = s.core.getAttemptForSession(input.sessionId)!;
      expect(attempt).toMatchObject({ status: "running", sessionId: input.sessionId, workspacePath: input.directory });
      expect(input.directory).not.toBe(s.root);
      expect(s.host.sessions.get(input.sessionId)).toMatchObject({ parentSessionId: "primary", agent: "sol-executor", directory: input.directory });
      const child = context(input.directory, input.sessionId, input.agent);
      const assignment = await execute(s.hooks, "sol_assignment", { attemptId: attempt.id }, child) as AssignmentContext;
      expect(assignment.objective).toBe(draft.objective);
      expect(assignment.acceptance).toEqual(draft.acceptance);
      expect(assignment.sourceSnippets).toEqual([expect.objectContaining({ id: "contract", snippet: "The output must say verified.", status: "available" })]);
      expect(input.prompt).toContain(draft.objective);
      expect(input.prompt).toContain("The output must say verified.");
      await expect(execute(s.hooks, "sol_run", { planId: created.id }, child)).rejects.toThrow("primary Sol session");
      await expect(execute(s.hooks, "sol_run", { planId: created.id }, { ...child, agent: "sol" })).rejects.toThrow("Worker cannot become a coordinator");
      await expect(execute(s.hooks, "sol_observe", { attemptId: attempt.id, path: "contract.txt", claim: "forged" }, { ...child, sessionID: "stranger" })).rejects.toThrow("not assigned");
      writeFileSync(join(input.directory, "result.txt"), "verified");
      const proof = await execute(s.hooks, "sol_observe", { attemptId: attempt.id, path: "result.txt", claim: "Output matches the contract" }, child);
      return { schemaVersion: 2, outcome: "completed", summary: "Verified output", criteria: [{ id: "done", status: "satisfied", evidenceRefs: proof.evidenceRefs }], findings: [], blockers: [], artifacts: ["result.txt"] } satisfies TaskResult;
    };
    const result = await execute(s.hooks, "sol_run", { planId: created.id }, s.ctx);
    expect(result.outcome).toBe("completed");
    expect(result.issues).toEqual([]);
    expect(readFileSync(join(s.root, "result.txt"), "utf8")).toBe("verified");
    expect(readFileSync(join(s.root, ".git", "index"))).toEqual(index);
    expect(readFileSync(join(s.root, "user.txt"), "utf8")).toBe("staged user work");
    expect(s.ctx.metadata).toHaveBeenCalledWith(expect.objectContaining({ metadata: { planId: created.id, state: "running" } }));
    expect(s.ctx.metadata).toHaveBeenLastCalledWith(expect.objectContaining({ metadata: { planId: created.id, state: "completed" } }));
    expect(s.host.activity).toHaveBeenCalled();
    expect(stdout).not.toHaveBeenCalled(); stdout.mockRestore();
  });

  it("persists native question routing across restart and refines once with exact answer IDs before applying", async () => {
    const s = await setup();
    s.host.work = async () => ({ schemaVersion: 2, summary: "Choose output format", reason: "Need a material answer", questions: [question] } satisfies PlannerResult);
    const proposed = await execute(s.hooks, "sol_plan", { op: "propose", objective: "Implement output" }, s.ctx);
    const questionId = s.core.getProposal(proposed.proposalId).questionIds[0]!;
    expect(s.core.getProposal(proposed.proposalId).plan).toBeUndefined();
    expect(s.host.prompt).toHaveBeenCalledTimes(1);
    const request = { tool: "question", sessionID: "primary", callID: "native-question" };
    await s.hooks["tool.execute.before"]!(request, { args: proposed.nativeArguments });
    await s.dispose();
    const restarted = await s.start();
    await restarted.hooks["tool.execute.after"]!({ ...request, args: proposed.nativeArguments }, { title: "Answered", output: "User answered Plain (untrusted prose)", metadata: {} });
    expect(s.core.getQuestion(questionId).status).toBe("pending");
    await restarted.hooks["tool.execute.after"]!({ ...request, args: proposed.nativeArguments }, { title: "Answered", output: "Ignored transcript", metadata: { answers: [["JSON"]] } });
    expect(s.core.getQuestion(questionId)).toMatchObject({ status: "answered", answers: ["JSON"] });
    s.host.work = async input => {
      const packet = JSON.parse(input.prompt);
      expect(packet.answeredQuestions).toEqual([expect.objectContaining({ id: questionId, answers: ["JSON"], status: "answered" })]);
      expect(packet.previousProposal.id).toBe(proposed.proposalId);
      return { schemaVersion: 2, summary: "JSON output plan", reason: "Incorporated the exact answer", questions: [],
        addressedQuestionIds: [questionId], plan: planTemplates.fast({ objective: "Implement JSON output" }) } satisfies PlannerResult;
    };
    const applied = await execute(restarted.hooks, "sol_plan", { op: "apply", proposalId: proposed.proposalId }, s.ctx);
    expect(applied.status).toBe("active");
    expect(s.core.getPlan(applied.planId).draft.objective).toBe("Implement JSON output");
    expect(s.core.getProposal(proposed.proposalId)).toMatchObject({ status: "applied", addressedQuestionIds: [questionId] });
    expect(await execute(restarted.hooks, "sol_plan", { op: "apply", proposalId: proposed.proposalId }, s.ctx)).toEqual(applied);
    expect(s.host.prompt).toHaveBeenCalledTimes(2);
  });

  it("returns native question arguments without claiming or performing automatic UI interaction", async () => {
    const s = await setup();
    const { taskIds: _taskIds, ...planless } = question;
    const response = await execute(s.hooks, "sol_ask", { questions: [planless] }, s.ctx);
    expect(response).toEqual({ next: "question", nativeArguments: { questions: [{ header: question.header, question: question.question, options: question.options, multiple: false }] } });
    expect(s.core.getQuestion(question.id)).toMatchObject({ status: "pending", taskIds: [] });
    expect(s.host.prompt).not.toHaveBeenCalled(); expect(s.ctx.ask).not.toHaveBeenCalled();
    await s.dispose(); const restarted = await s.start();
    expect(await execute(restarted.hooks, "sol_ask", {}, s.ctx)).toEqual(response);
  });

  it("keeps onboarding interview questions independent from an active execution plan", async () => {
    const s = await setup();
    const plan = await execute(s.hooks, "sol_plan", { op: "create", draft: planTemplates.fast({ title: "Active work" }) }, s.ctx);
    await execute(s.hooks, "sol_project", { op: "offer", expectedRevision: 0 }, s.ctx);
    const args = { questions: [{ header: "Project users", question: "Who is this product for?",
      options: [{ label: "Consumers", description: "Individual users" }], multiple: false }] };
    await s.hooks["tool.execute.before"]!({ tool: "question", sessionID: "primary", callID: "onboarding-question" }, { args });
    expect(s.core.getQuestion("question:onboarding-question:0")).toMatchObject({ taskIds: [], status: "pending" });
    expect(s.core.getQuestion("question:onboarding-question:0")).not.toHaveProperty("planId");
    expect(s.core.getPlan(plan.id).status).toBe("active");
  });

  it("enforces a persisted design opt-in even when complete omits the choice", async () => {
    const s = await setup();
    await execute(s.hooks, "sol_project", { op: "begin", expectedRevision: 0,
      persistenceChoices: { sharedDocuments: true, privatePreferences: false } }, s.ctx);
    await execute(s.hooks, "sol_project", { op: "update", expectedRevision: 1, currentStage: "mapping", designChoice: "document" }, s.ctx);
    mkdirSync(join(s.root, ".sol", "project"), { recursive: true });
    const required = ["index.md", "project.md"] as const;
    for (const name of required) writeFileSync(join(s.root, ".sol", "project", name), canonicalKnowledge(name));
    await execute(s.hooks, "sol_project", { op: "update", expectedRevision: 2, completedDocumentIds: required }, s.ctx);
    await expect(execute(s.hooks, "sol_project", { op: "complete", expectedRevision: 3 }, s.ctx)).rejects.toThrow(/design\.md/);
  });

  it("keeps system and compaction continuity scoped to the persisted primary session", async () => {
    const s = await setup();
    const historical = s.core.createPlan(planTemplates.fast({ title: "UNRELATED_HISTORY", objective: "SECRET_HISTORICAL_OBJECTIVE" }));
    s.core.bindPlanSession(historical.id, "old-primary");
    const current = await execute(s.hooks, "sol_plan", { op: "create", draft: planTemplates.fast({ title: "Current task", objective: "LONG_CURRENT_OBJECTIVE" }) }, s.ctx);
    await s.dispose(); const restarted = await s.start();
    const system = { system: ["Original system"] }, compact = { context: ["Original context"] };
    await restarted.hooks["experimental.chat.system.transform"]!({ sessionID: "primary", model: {} as Parameters<NonNullable<Hooks["experimental.chat.system.transform"]>>[0]["model"] }, system);
    await restarted.hooks["experimental.session.compacting"]!({ sessionID: "primary" }, compact);
    for (const output of [system.system[1]!, compact.context[1]!]) {
      expect(output).toContain(current.id); expect(output).toContain("Current task");
      expect(output).not.toContain(historical.id); expect(output).not.toContain("UNRELATED_HISTORY");
      expect(output).not.toContain("SECRET_HISTORICAL_OBJECTIVE"); expect(output).not.toContain("LONG_CURRENT_OBJECTIVE");
      expect(Buffer.byteLength(output)).toBeLessThan(4096);
    }
    const unbound = { context: [] as string[] };
    await restarted.hooks["experimental.session.compacting"]!({ sessionID: "stranger" }, unbound);
    expect(unbound.context).toEqual([]);
  });
});
