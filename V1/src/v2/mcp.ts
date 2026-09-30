import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { SolCore, planDraftSchema, planTemplates, taskSpecSchema, type PlanRecord } from "./core.js";

const id = z.string().min(1).max(96).regex(/^[a-zA-Z0-9][a-zA-Z0-9_.:-]*$/);
const count = z.number().int().nonnegative();
const status = z.enum(["active", "paused", "succeeded", "failed", "cancelled"]);
const taskStatus = z.enum(["queued", "leased", "running", "submitted", "succeeded", "failed", "lost", "cancelled"]);
const receiptSchema = z.object({
  id, revision: z.number().int().positive(), status, title: z.string().max(240),
  tasks: z.partialRecord(taskStatus, count),
}).strict();
const planSchema = z.object({
  schemaVersion: z.literal(2), id, revision: z.number().int().positive(), status,
  draft: planDraftSchema, tasks: z.array(taskSpecSchema.safeExtend({ status: taskStatus })).max(64),
  createdAt: z.string(), updatedAt: z.string(),
}).strict();
const digestSchema = z.object({
  schemaVersion: z.literal(2), plans: z.array(receiptSchema).max(8),
  events: z.array(z.object({ id: count, planId: id.nullable(), type: z.string(), entityId: id, createdAt: z.string() }).strict()).max(24),
  cursor: count,
}).strict();
const envelope = <T extends z.ZodType>(data: T) => z.object({ schemaVersion: z.literal(2), data }).strict();

function bounded(data: object): { schemaVersion: 2; data: object } {
  const result = { schemaVersion: 2 as const, data };
  if (Buffer.byteLength(JSON.stringify(result), "utf8") > 65_536) {
    throw new Error("Sol response exceeds 64KB; use sol_progress or sol_plan_list for references, and move large context to source file references before retrieving the full plan.");
  }
  return result;
}
function output(data: object) {
  return { content: [], structuredContent: bounded(data) };
}
function receipt(plan: PlanRecord): z.infer<typeof receiptSchema> {
  const tasks: z.infer<typeof receiptSchema>["tasks"] = {};
  for (const task of plan.tasks) tasks[task.status] = (tasks[task.status] ?? 0) + 1;
  return { id: plan.id, revision: plan.revision, status: plan.status, title: plan.draft.title, tasks };
}

/** The caller owns core. Only the trusted native plugin's private pipe enables writes. */
export function createSolMcpServer(core: SolCore, options: { writable?: boolean } = {}): McpServer {
  const server = new McpServer({ name: "sol-v2", version: "2.2.0" });
  const read = { readOnlyHint: true, openWorldHint: false };
  const write = { readOnlyHint: false, destructiveHint: true, openWorldHint: false };
  server.registerTool("sol_templates", {
    description: "Retrieve canonical Sol v2 plan draft templates.", inputSchema: z.object({}).strict(),
    outputSchema: envelope(z.object({ templates: z.object({ fast: planDraftSchema, standard: planDraftSchema, investigation: planDraftSchema, critical: planDraftSchema, release: planDraftSchema }).strict() }).strict()),
    annotations: read,
  }, () => output({ templates: Object.fromEntries(Object.entries(planTemplates).map(([name, make]) => [name, make()])) }));
  server.registerTool("sol_plan_get", {
    description: "Retrieve a full plan, limited to 64KB. Prefer progress for compact status.",
    inputSchema: z.object({ planId: id }).strict(), outputSchema: envelope(planSchema), annotations: read,
  }, ({ planId }) => output(core.getPlan(planId)));
  server.registerTool("sol_plan_list", {
    description: "List compact plan receipts without objectives or task instructions.",
    inputSchema: z.object({ limit: z.number().int().min(1).max(100).optional() }).strict(),
    outputSchema: envelope(z.object({ plans: z.array(receiptSchema).max(100) }).strict()), annotations: read,
  }, ({ limit }) => output({ plans: core.listPlans(limit).map(receipt) }));
  server.registerTool("sol_progress", {
    description: "Retrieve canonical compact status and cursor-based audit events.",
    inputSchema: z.object({ planId: id.optional(), afterEventId: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).optional() }).strict(),
    outputSchema: envelope(digestSchema), annotations: read,
  }, ({ planId, afterEventId }) => output(core.digest(planId, afterEventId)));

  if (options.writable === true) {
    server.registerTool("sol_plan_create", {
      description: "Trusted bridge: create a validated plan and return a compact receipt.",
      inputSchema: z.object({ draft: planDraftSchema, idempotencyKey: z.string().trim().min(1).max(256).optional() }).strict(),
      outputSchema: envelope(receiptSchema), annotations: write,
    }, ({ draft, idempotencyKey }) => output(receipt(core.createPlan(draft, idempotencyKey))));
    server.registerTool("sol_plan_revise", {
      description: "Trusted bridge: revise a plan using optimistic revision checking.",
      inputSchema: z.object({ planId: id, expectedRevision: z.number().int().positive(), draft: planDraftSchema, reason: z.string().trim().min(1).max(4000) }).strict(),
      outputSchema: envelope(receiptSchema), annotations: write,
    }, ({ planId, expectedRevision, draft, reason }) => output(receipt(core.revisePlan(planId, expectedRevision, draft, reason))));
    server.registerTool("sol_plan_cancel", {
      description: "Trusted bridge: cancel a plan and release its active reservations.",
      inputSchema: z.object({ planId: id }).strict(), outputSchema: envelope(receiptSchema), annotations: write,
    }, ({ planId }) => output(receipt(core.cancelPlan(planId))));
    server.registerTool("sol_plan_pause", {
      description: "Trusted bridge: pause scheduling and acceptance for a plan.",
      inputSchema: z.object({ planId: id }).strict(), outputSchema: envelope(receiptSchema), annotations: write,
    }, ({ planId }) => output(receipt(core.pausePlan(planId))));
    server.registerTool("sol_plan_resume", {
      description: "Trusted bridge: resume a paused plan.",
      inputSchema: z.object({ planId: id }).strict(), outputSchema: envelope(receiptSchema), annotations: write,
    }, ({ planId }) => output(receipt(core.resumePlan(planId))));
  }
  server.registerResource("sol-plan", new ResourceTemplate("sol://plans/{id}", { list: undefined }), {
    description: "Full canonical plan, bounded to 64KB; large context should use source file references.", mimeType: "application/json",
  }, (uri, variables) => ({ contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify(bounded(core.getPlan(id.parse(variables.id)))) }] }));
  return server;
}

async function main(): Promise<void> {
  const { values } = parseArgs({ options: {
    project: { type: "string", default: process.cwd() }, database: { type: "string" }, bridge: { type: "boolean", default: false },
  }, strict: true, allowPositionals: false });
  const core = new SolCore(values.project, values.database);
  const server = createSolMcpServer(core, { writable: values.bridge });
  let closing: Promise<void> | undefined;
  const cleanup = (): Promise<void> => closing ??= Promise.resolve().then(async () => {
    try { await server.close(); } finally { core.close(); }
  });
  const stop = () => { void cleanup().catch(report); };
  const report = (error: unknown) => {
    process.stderr.write(`Sol MCP: ${error instanceof Error ? error.message.slice(0, 512) : "transport error"}\n`);
    process.exitCode = 1;
  };
  process.once("SIGTERM", stop);
  process.once("SIGINT", stop);
  process.stdin.once("end", stop);
  server.server.onclose = stop;
  server.server.onerror = report;
  try { await server.connect(new StdioServerTransport()); }
  catch (error) { await cleanup(); throw error; }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  void main().catch((error: unknown) => {
    process.stderr.write(`Sol MCP: ${error instanceof Error ? error.message.slice(0, 512) : "startup failed"}\n`);
    process.exitCode = 1;
  });
}
