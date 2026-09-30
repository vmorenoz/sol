# Sol v2: implemented architecture and operating contract

This document describes the current `src/v2/` implementation, shipped agent/skill assets, and `src/cli/installer.ts`. Source contracts take precedence over aspirational behavior. Build, test, install, and restart instructions are in the [README](../README.md).

## Architecture and evolution

```text
OpenCode primary Sol session
  ├─ native task → one bounded sol-executor job
  ├─ native task → parallel sol-project-mapper initialization jobs
  └─ native plugin tools + trusted host session context
       ├─ private local MCP pipe → typed plan operations → SQLite
       ├─ planner proposal / native question routing → SQLite
       └─ execution driver
            ├─ OpenCode SDK → native child sessions
            ├─ isolated workspaces → change artifacts → integration
            └─ evidence runner → command logs / inspection receipts

Configured public local MCP → read-only plans, templates, progress
```

The package is v2-only. Its exports are `.`, `./plugin`, and `./mcp`; the installer uses the v2 plugin and MCP build paths and manages v2 installations only. Older global installation cleanup is a one-off operation outside this repository, not a supported installer migration path.

v2 uses typed plans, persisted attempts, native session bindings, and evidence references. Continuity hooks recover the current session's plan/proposal by reference rather than reconstructing superseded tasks from transcript summaries. There is no remote memory server, embedding index, or multiuser memory platform in this implementation.

### Source map

| Module | Responsibility |
| --- | --- |
| `protocol.ts` | Strict schemas, canonical template factories, record types |
| `core.ts` | Transactional plans/revisions/attempts, reservations, proposals, questions, evidence references, audit events |
| `mcp.ts`, `transport.ts` | Local stdio MCP server and private writable plugin client |
| `plugin.ts` | Host-bound tool authorization, coordination, question hooks, compact continuity |
| `host.ts`, `opencode-host.ts` | Host interface and OpenCode SDK adapter |
| `session-store.ts` | Immutable session bindings, question-call routing, latest activity |
| `driver.ts` | Scheduling, retry checkpoints, recovery, integration and cancellation coordination |
| `workspace.ts` | Worktree/snapshot creation, scope-checked artifacts, journals and cleanup |
| `evidence.ts` | Measured checks, source observations, fingerprint validation, merged-tree check receipts |
| `context.ts` | Selected source snippets and hashes for bounded task context |

## Trust and transport boundaries

The installer registers a local stdio MCP server without `--bridge`. That public surface exposes `sol_templates`, `sol_plan_get`, `sol_plan_list`, `sol_progress`, and the `sol://plans/{id}` resource template. Responses use a versioned structured envelope, bounded to 64 KiB.

The native plugin creates a separate private stdio connection with an explicit project root, database path, and `--bridge`. That process also enables plan creation, revision, pause, resume, and cancellation operations. The flag selects a trusted local capability; it is not remote authentication or a protection against arbitrary local shell access. Worker sessions must not receive this writable pipe.

The installer captures the Node executable for this private connection. A Bun-compiled OpenCode executable must not be treated as the Node interpreter. Direct plugin loading can override it with `SOL_NODE_PATH` (or plugin option `nodeExecutable`). Native session calls reuse the host-provided SDK client, including its in-process transport and authentication; they do not require a separately listening localhost server.

The primary agent uses OpenCode's native `task` for one bounded specialist job and plugin tools `sol_query`, `sol_project`, `sol_discuss`, `sol_plan`, `sol_run`, `sol_progress`, `sol_ask`, and `sol_cancel`. Native task prompts must state scope, constraints, acceptance, and focused verification. Host context, rather than a model-supplied role field, determines plugin-tool authorization. Planned workers check the persisted session/attempt binding, role, running status, and actual workspace directory. The plugin blocks direct project tools but does not block native `task` in a bound primary Sol session.

`sol_query` has stable `project-status` (the compatible default) and `sol-status` selectors. `sol-status` reads project-scoped runtime/session aggregates plus bounded workspace/evidence inventories and fixed project-local markers. It creates no query row, plan, session, agent, workspace, test, or MCP request, and excludes objectives, prompts, answers, logs, event payloads, artifact contents, and changed filenames. Legacy database rows are labelled legacy Sol. A `.pulso` result reports only that project-local marker; its absence is not evidence that no Pulso installation or history exists.

The native adapter uses the installed `@opencode-ai/sdk/v2` types and the session `create`, `prompt`, `get`, `status`, `messages`, and `abort` methods. Structured results are read from `info.structured`. Treat this as a version-sensitive host contract, not support for arbitrary SDK releases. There is no assumed SDK “ask” endpoint or custom activity-panel endpoint: questions use native tool hooks, and the adapter's activity callback is optional. Unsupported or missing results must remain errors/unknown state rather than simulated success.

The plugin-provided client is typed with SDK v1 request shapes (`body`, `path`, `query`); the adapter preserves the host transport while sending the pinned server's v2 body fields. This is a host SDK boundary, not Sol legacy compatibility.

## Native project initialization mapping

Project initialization uses OpenCode's native task system rather than a Sol execution plan. The primary coordinates the trusted `sol_project` plugin tool using only `status`, `offer`, `begin`, `update`, `refresh`, `complete`, `context`, `snooze`, and `decline`. The tool persists progress and reads bounded context but never launches agents or writes project documents. Interviews use native `question`. Every file writer is a specialized native mapper task, so each mapper appears as its own host task card and child session.

Before a materially ambiguous multi-step plan, `sol_discuss` stores a resumable, revision-checked planning context scoped to the primary session and project. The coordinator first uses bounded native read-only exploration to identify reusable assets, established patterns, integration points, and canonical references. It then presents only two to four outcome-changing gray areas through native `question`. The ready record contains the scope boundary, confirmed user decisions, delegated discretion, specifics, references, code context, deferred ideas, and completion timestamps; it deliberately excludes raw option lists and a Q&A transcript. Planner receives the latest ready context automatically and must keep deferred ideas out of scope without turning inference into requirements.

When status says mapping is missing and an offer is allowed, the primary automatically offers **Initialize**, **Later**, or **Don't ask** once at a natural boundary. The offer must not block or delay the work the user actually requested. The project workflow records deferral/suppression so Sol does not repeatedly nag; a later explicit initialization request still takes precedence.

### Outputs and visibility

One native subagent, `sol-project-mapper`, handles every mapping focus with `SOL_LIGHT_MODEL`. Its assignment must name one exact focus and its exact output allowlist: `tech` writes `stack.md` and `integrations.md`; `architecture` writes `architecture.md` and `structure.md`; `quality` writes `conventions.md` and `testing.md`; `concerns` writes `concerns.md`; `project` writes `project.md`; `design` writes `design.md`; `index` writes `index.md`; and `entrypoint` writes root `SOL.md`. Host permissions confine edits to `.sol/project/*.md` plus root `SOL.md`; the assignment narrows that envelope to the focus-specific files. These are repository files and therefore potentially shared through version control.

Private workflow state, raw interview answers, deferrals and private preferences belong behind the trusted `sol_project` boundary, not in mapped files. Initialization requires consent to repository-resident `.sol/project` documents; Sol never stages, commits or pushes them. Product answers enter `project.md` only after that consent and only with approved documentation. Private preferences are stored externally and are sent to the configured model only when selected through bounded context loading. `SOL.md` and the index exclude private or unconsented material.

Every canonical output distinguishes **Facts**, **Inferences**, **Open questions**, and **Sources**. Repository facts cite actual repository-relative paths and available trusted hashes; interview facts cite clear user-confirmed provenance. Policy is distinct from observed practice. Missing evidence uses `Not detected`; genuinely irrelevant topics use `Not applicable` with a reason. Existing manual content is preserved with contextual patches. Contradictions are surfaced rather than resolved by deleting user guidance. Mappers describe current state, use representative examples instead of vague lists, and never invent versions or commands.

The ten canonical documents are `stack.md`, `integrations.md`, `architecture.md`, `structure.md`, `conventions.md`, `testing.md`, `concerns.md`, `project.md`, `design.md`, and `index.md`. Their stable templates live in the mapper contract. `project.md` covers product definition, users, core value, workflows, validated/current capabilities, goals, non-goals, constraints, success measures, vocabulary, decisions, and open questions.

Canonical documents are plain Markdown. Required substantive headings determine usability; optional frontmatter never gates a useful document. The runtime derives bounded provenance from repository-relative inline-code bullets in `## Sources`, then captures trusted document and readable source hashes. Unreadable or budget-limited sources degrade freshness without discarding the document. Later `status` calls compare the baseline without following symlinks and report changed, deleted, or unreadable sources plus affected mapping focuses. Refresh transitions ready context back to active mapping using `full-refresh`, `focus-refresh`, or exact-path `incremental` mode; a full refresh clears retired Sol document IDs and successful completion replaces the baseline.

`design.md` is separately opt-in and covers:

- Scope, status, product surfaces, users and contexts
- Experience principles and key flows
- Information architecture and navigation
- Approved references and provenance
- Visual language
- Design tokens and typography
- Layout and responsive behavior
- Components, composition, interaction and states
- Accessibility and known gaps
- Content and microcopy
- Assets, iconography and design-system governance
- Decisions
- Open questions

### Concurrency and sequencing

Initialization begins with four simultaneous native mapper tasks for `tech`, `architecture`, `quality`, and `concerns`; their output allowlists do not overlap. Product mapping starts only after the user has explicitly consented, answered the bounded interview, and approved documentation sources; native question batches contain at most three business questions. Design mapping starts only after separate explicit opt-in.

After each successful task, the coordinator records only its successful files. A quality failure reruns only the affected focus. After all selected topic tasks complete, an `index` focus writes `.sol/project/index.md` from recorded completed outputs instead of reopening broad repository exploration. If explicitly selected, an `entrypoint` focus writes root `SOL.md` after the index. Refreshes use stale-document scopes; incremental updates use exact changed paths and only affected focuses, preserving user edits. The coordinator reports progress through native task cards and uses the trusted project tool for workflow status/context; it does not hide mapping inside a Sol plan or create commits.

### Mapper safety boundary

The mapper can read, glob, grep and edit only within its host edit boundary. It has no bash, native task, native question, skill, Sol, or MCP capability. It runs no tests, installs or builds and performs no staging, commits or pushes. A mandatory strategy reads existing outputs first, inventories only the assigned scope, checks declarations before representative implementations, triangulates claims, and re-reads edits. Secret-bearing filename patterns are never opened or searched; discovery is handled by existence only without values. The `project` focus receives already answered, consented material and never interviews. `index` and `entrypoint` consume only completed documents explicitly assigned to them. Completion returns file confirmation and line counts, never mapped content.

Future work loads bounded context by intent: stack/integrations for technology and external services; architecture/structure for runtime boundaries and placement; conventions/testing for implementation and verification; concerns for risk, security, reliability, performance and debt; project for product behavior and vocabulary; design for opted-in UI/UX work; index for orientation; and `SOL.md` for concise repository-wide guidance.

## Plans and templates

`planDraftSchema` is the single canonical draft format. MCP templates, direct creation/revision, planner proposals, and persisted revisions all use it. Prefer a compact draft or a canonical template instead of inventing formats or repeatedly pasting large schemas into prompts. Runtime-selected result schemas are supplied to native specialists.

| Template | Enforced constraint |
| --- | --- |
| `fast` | Exactly one task with role `executor` |
| `standard` | General validated task DAG; no mandatory extra review task |
| `investigation` | Every task has an empty write scope |
| `critical` | At least one scoped read-only reviewer, with every writer upstream of such a review |
| `release` | The same scoped downstream review requirement as critical |

`release` does not itself deploy, sign, or distribute anything. Those actions require explicit tasks, checks, environment, and authorization. Template factories initially use broad `src/**` scopes and generic acceptance; narrow them to the actual objective.

Roles are `executor`, `planner`, `scout`, `researcher`, `reviewer`, `verifier`, and `creator`. The driver routes a role to `sol-${role}`. Relevant skills are task references; assets instruct specialists to load them, rather than the runtime automatically applying skill behavior.

### Minimal source-valid plan

This small fast draft reads a source document and declares a non-mutating check. It can be passed as `draft` to native `sol_plan` with `op: "create"`. It describes proposed work, not evidence that the work has run.

```json
{
  "schemaVersion": 2,
  "template": "fast",
  "title": "Inspect the README",
  "objective": "Confirm the README is present and summarize its setup instructions.",
  "acceptance": [
    {
      "id": "readme-reviewed",
      "description": "README.md is nonempty and its setup instructions are summarized with source-backed evidence."
    }
  ],
  "tasks": [
    {
      "id": "inspect",
      "title": "Read and check the README",
      "role": "executor",
      "reads": ["README.md"],
      "writes": [],
      "acceptance": ["readme-reviewed"],
      "checks": [
        { "id": "readme-present", "command": "test -s README.md" }
      ]
    }
  ]
}
```

The example is checked against the source schema: its sole executor covers the declared criterion; IDs are unique; paths are safe project-relative paths; there are no unknown fields or dependency cycles. The omitted task arrays `dependsOn`, `resources`, `skills`, `sourceIds`, and `decisionIds` default to `[]`. Task `reads`, `writes`, and `checks` also default to `[]` when omitted. Plan `constraints`, `sources`, and `decisions` default to `[]`; `sourceMessageRefs` is optional.

Default budgets are `maxAttempts: 2`, `maxParallel: 4`, and `maxDurationMs: 3600000`. Attempts are counted per task/revision. Duration is aggregate worker running time in the current revision, not elapsed conversation time or full end-to-end orchestration time. Revision establishes fresh budgets. An omitted check timeout is executed with the runner's 120-second default. The example's shell check assumes a POSIX environment.

The schema also rejects missing criterion coverage, unknown dependencies/source/decision references, duplicates, and cycles. Scope validation rejects absolute/traversal paths. Workspace capture supports a deliberately small glob grammar: literal paths, `*`, `**`, and `?`; do not assume all glob dialects have identical behavior across components.

## Planner proposals and human decisions

Clear fast work creates a draft directly. For material planning complexity:

1. `sol_plan` with `op: "propose"` launches a native `sol-planner` session with a trusted packet and `plannerResultSchema`. An existing plan can be supplied for revision. Proposal sessions have no execution attempt ID.
2. The result becomes a durable `proposed` record with an optional draft, reason, and question history. Initial questions receive persisted generated IDs. A proposal is not yet an active plan.
3. The receipt returns `nativeArguments` when clarification is needed. The primary calls OpenCode's native `question` tool. `sol_ask` can also persist questions and return arguments; it does not itself display UI.
4. The before hook persists/routes question IDs by session and tool call. The after hook records exact `output.metadata.answers`. It does not infer human decisions from prose, model arguments, or a nonexistent SDK endpoint. Without valid answer metadata the question remains unresolved.
5. `op: "apply"` invokes refinement when answered questions have not been acknowledged. The planner receives the persisted answers and must return their exact IDs in `addressedQuestionIds`. Pending questions are not silently bypassed or reasked as new decisions.
6. Applying creates or revises the plan, links answers to it, binds it to the primary session, and marks the proposal `applied`. Reapplying an applied proposal returns its plan.

At most three questions can be pending project-wide. Material plan questions block affected tasks (or the whole plan when unscoped), including acceptance. New-plan questions cannot reference nonexistent tasks. Revisions use `expectedRevision`; the current implementation rejects revision while **any** attempt is leased, running, or submitted, even if unrelated to the change. Unchanged successful tasks are preserved only when their semantic context and preserved dependencies match; material new answers can invalidate that preservation.

## Execution, progress, and native host UI

`sol_run` schedules ready tasks or reconciles existing active attempts. Dependencies must succeed before downstream work is ready. Resource IDs reserve shared resources across active attempts in the project. In a shared workspace, conservative scope overlap prevents conflicting access; separate isolated workspaces can execute overlapping scopes, with conflicts checked later at integration. Disjoint work is the simpler parallel case.

Each attempt moves through `leased → running → submitted → succeeded`, with failure, loss, and cancellation paths. Before prompting a worker, the driver persists its native session identity. The packet includes its workspace, baseline snapshot, acceptance, selected sources/decisions, answered questions, and bounded summaries/references for accepted dependency results. The driver does not assume that a child inherits the parent's transcript.

Workers recover assignments with `sol_assignment({attemptId})`. For dependency detail, use `sol_assignment({attemptId, dependencyAttemptId: resultRef, section: 'findings', offset, limit})`, taking `resultRef` from the assignment. Supported sections are `summary`, `findings`, `criteria`, `artifacts`, and `blockers`. Request only needed sections/pages; do not copy full reports into prompts or tool calls.

Workers return validated outcomes (`completed`, `partial`, `blocked`, or `failed`), criterion statuses/evidence references, findings classified as facts/hypotheses/recommendations, blockers, and artifact paths. Submission is not acceptance. Writer acceptance additionally requires integration identity and driver checks. Retryable technical failures may reuse the existing workspace and prior-result references within budget; unavailable checkpoints require refinement rather than silently starting over.

`sol_progress` returns bounded canonical state or a selected attempt/result by reference. Plan history is explicitly requested through `sol_plan`; old plans are not injected on every turn. OpenCode's native `task` supplies native cards and child-session navigation for a bounded direct job. Planned execution uses `ToolContext.metadata` on existing tool cards. OpenCode owns all tool-trace and child-session presentation; Sol ships no custom TUI or rendering layer.

## Workspaces, change artifacts, and cleanup

`WorkspaceManager` snapshots eligible working-tree contents, including eligible dirty and untracked files. With a repository-root `HEAD`, it creates a detached no-checkout worktree and materializes that baseline. Unborn repositories and non-Git directories use an ordinary isolated snapshot directory. No initial commit is needed and no workspace method creates commits, stages the primary index, or requires worker commits.

The patch-like artifacts are JSON change manifests referencing content-addressed snapshots, not necessarily textual `.patch` files. Capture checks all eligible changes against declared write scopes. Integration preflights each changed path against its baseline, applies only those paths, and records a durable journal and integrated snapshot. Unrelated paths and the primary index are left alone. Conflicting same-path edits are rejected rather than automatically merged.

Integration recovery either recognizes a durable matching receipt or rolls back values still equal to Sol's own output. Intervening edits become conflicts for explicit repair. A failed merged-tree check does not imply rollback or successful acceptance: integrated progress remains in the primary tree, the failed attempt is archived, and a bounded corrective attempt starts from the effective main tree. Exhausting that budget settles failure and releases reservations so the plan can be revised. Pauses and pending material questions defer acceptance without turning a completed worker into a failure.

Cleanup archives eligible dirty contents before removing an owned workspace. Preservation-only archives cannot authorize integration, and the accepted integration artifact is retained separately. Journals block cleanup until reconciled. Records, snapshots, logs, and archives survive workspace removal; there is no documented automatic retention/garbage-collection policy. Filtered files are not promised preservation.

Exclusions include dependency/cache directories, `.git`, `.sol`, common credential filenames, most `.env` files, and key-like extensions; `.env.example` and `.env.sample` are allowed. Untracked generated `dist`, `build`, and `target` trees are normally omitted. These are filename heuristics, not content-based secret detection. Credentials under ordinary names can still be copied, and process environment or command output can still expose secrets.

Dependencies and virtual environments are **not copied**. The primary and planner must explicitly declare setup needed by checks in optional `task.environment`; the runtime does not infer installation commands. For example, for an npm project with a suitable lockfile:

```json
{
  "environment": {
    "prepare": { "command": "npm ci --ignore-scripts", "timeoutMs": 120000 },
    "generatedOutputs": ["coverage/**"]
  }
}
```

`prepare` and its `timeoutMs` are optional; `generatedOutputs` defaults to `[]`. Choose commands and disposable output scopes for the actual language, package manager, lockfile, and checks. Do not routinely schedule `npm test` in isolation without its dependency setup. The runner automatically executes declared preparation before worker checks and again in fresh merged-tree verification, subject to host authorization. Successful setup can be reused while its command and protected-source fingerprint remain unchanged; setup failure or protected-source mutation blocks validation.

`generatedOutputs` declares disposable outputs only for newly created, untracked paths. It cannot hide tracked or baseline source, protected source changes, or delivered artifacts. Keep deliverables in write scopes and out of disposable output declarations. These cooperative workspaces and host permissions are not filesystem, process, network, or credential sandboxes.

## Evidence and acceptance

- `sol_check` runs a predefined named command after requesting native bash permission. The runner measures actual exit status/duration and captures bounded stdout/stderr in external logs, rather than trusting model-supplied timing or pasted output.
- Evidence is tied to an attempt, task, revision, and assigned baseline snapshot. Referenced evidence must belong to that attempt; a failed command cannot satisfy a criterion.
- Each named check's latest evidence must pass and be cited. The driver additionally validates runner sidecars against current workspace and selected-source fingerprints. Changes after a check can require it to run again. Only eligible disposable generated outputs are excluded; protected source and delivered artifacts remain subject to validation.
- Environment preparation has separate `preparations/` logs and execution sidecars. Preparation success is not named-check evidence or acceptance proof; worker checks and fresh merged-tree checks retain their own logs/receipts.
- `sol_observe` captures a scoped source hash and a claim. Its explicit meaning is **source observed, claim not independently verified**. An inspection is not a passing test or automatic proof of correctness.
- Successful native `webfetch` results in bound worker sessions can produce host-recorded external-reference evidence. HTTPS source, content hash, observation time and a capped excerpt are retained; the model cannot submit invented retrieved content. This is historical source observation, not proof that a claim is true or that the remote document has not changed later.
- Before success, tasks with checks are also verified in a separate snapshot of the merged project. Those logs/receipts remain separate from worker evidence; recovery reruns merged checks rather than treating historical receipts as current proof.

Logs are capped at 1 MiB per execution and stored outside the conversation; observation and integration ledgers are separate JSON artifacts. Returned `evidenceRefs`, attempt/result references, and artifact paths let callers request focused detail. Evidence-relative paths such as `checks/<id>.log` resolve under that project's evidence storage, not under the source checkout. Raw logs are not automatically sanitized and may contain sensitive output. Native paths use the trusted runner, but low-level `SolCore` methods alone do not enforce every runner-side filesystem proof.

## Recovery and cancellation

Persistent session bindings, attempt records, workspace checkpoints, integration journals, and results support reconciliation after interruption. A disconnect does not release reservations. Recovery probes the host:

- Running or unknown sessions retain reservations.
- A confirmed missing session can mark a non-submitted attempt lost and retry it within budget.
- An idle session with a structured result can continue submission/acceptance; a confirmed idle session without a result retries within budget from its checkpoint.
- Submitted attempts retain their result and can resume validation/integration after pause or a material question is resolved.
- A lease without a session identity is not proven safe merely by age. Typed `HostCreationError` distinguishes confirmed non-creation (`created: "no"`) from ambiguous creation (`created: "unknown"`). Confirmed rejection permits failure settlement and retry only when retryable and within budget. Timeouts, transport failures, missing identities, and ambiguous server responses retain reservations until reconciled; they are not proof that no child exists. The core's trusted orphan-recovery API requires ownership/no-session proof.
- A session identity returned after cancellation/timeout is retained and its termination confirmed before releasing reservations. Recovery propagates the native tool's cancellation signal, including during merged verification.

Pause blocks new scheduling and acceptance, not necessarily an already-running worker. Cancellation through `sol_cancel` uses the driver to abort sessions and confirm stopped state before releasing active reservations and cleaning workspaces. A timeout or failed abort does not prove termination. The public MCP is read-only; even the private MCP cancellation method cannot supply the core's trusted stopped-worker assertion for active work. **Do not generalize driver cancellation guarantees to a direct core call or assume that any cancelled writer has been safely stopped by the workspace manager.**

## Storage, metrics, and context limits

By default, SQLite is at `$XDG_DATA_HOME/sol/sol.db`, falling back to `~/.local/share/sol/sol.db`. The plugin honors `SOL_DATABASE_PATH` and passes that path to its private MCP process. A separately launched MCP server accepts `--database`; it does not independently interpret that plugin environment override. Keep separately configured readers aligned if changing storage.

Plugin workspace/evidence storage defaults to `$XDG_DATA_HOME/sol/v2/<project-root-hash>/` (with the same home fallback), under `isolation/` and `evidence/`. Host sessions/questions/activity are persisted in dedicated v2 tables. The project root scopes core state. `.sol/` can hold selected project-local knowledge; it is not the canonical v2 execution database or a remote memory store.

v2 records deterministic audit events, worker running durations, measured command durations/outcomes, and latest activity. `SessionStore.recordUsage` records host token, cache, reasoning and cost counters by message; `recordTool` records tool-output byte counts by call, scoped to project and role. `sol metrics --project <path>` reports these aggregates without conversation content. There is no preference-profile API, automatic learning, or complete insights pipeline. Actual token savings and productivity gains still require comparable workload measurements.

Context is explicitly bounded: core assignment packets at 32 KiB; selected-source snippets share a 12 KiB budget and hash complete source contents; planning packets at 64 KiB; routine system continuity at 4 KiB; core digests at 8 KiB with at most 24 events. Different native tool responses have their own caps. Missing source contents are marked unknown rather than invented. Task `sourceIds` and `decisionIds` select relevant persisted knowledge. A reference in `sourceMessageRefs` is not automatic transcript retrieval. Limits bound model-facing context, not total disk storage or all filesystem work.

Explicitly selected sources in `.sol/knowledge/`, `.sol/decisions/`, `.sol/PROJECT.md`, `.sol/STRATEGY.md`, and `.sol/POLICIES.yml` can be read from the original project when absent from isolated snapshots. Their origin is marked `project-knowledge`; current content participates in source fingerprints. Other runtime `.sol` files are not a fallback knowledge source.

Local-first does not mean offline inference: the configured host/provider receives prompts and any content sent through its tools. The code does not implement remote memory synchronization, multiuser access control, semantic retrieval, or evaluated learning.

## Verification boundary

The repository contains protocol/core/MCP/context/workspace/evidence/driver tests and installer tests. The driver suite uses a `FakeHost` while exercising local scheduling and filesystem behavior. A separate installed-host smoke passed on OpenCode 1.18.31 with the native `general` agent and a real model: MCP connection, typed output and persisted-result recovery were exercised. Worker sessions explicitly allow the host's `StructuredOutput` capability. Recovery requests the latest response instead of full user-format history. See [validation evidence](VALIDATION.md). A full real Sol/Planner/Executor conversation, human question UI and long-session acceptance remain separate validation; the native smoke is not a substitute for them.
