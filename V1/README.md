# Sol

Sol is a local-first orchestration assistant for OpenCode. The current v2 implementation combines **Sol's own local MCP service, a trusted native plugin, persistent typed plans, and isolated worker workspaces**. Sol coordinates the conversation; native specialist sessions perform project work.

## What is implemented

- Validated version-2 plans with `fast`, `standard`, `investigation`, `critical`, and `release` templates, acceptance criteria, dependencies, file scopes, named checks, and execution budgets.
- One native `task` delegated to `explore` for bounded read-only interpretation or `sol-executor` for a clear bounded change, without a separate planning session; planned work still uses persisted role schemas.
- Planner proposals with durable question/answer history and refinement before application. Human answers come from the native question tool's metadata.
- A driver that schedules native child sessions, retains interrupted work, checks structured results and evidence, and integrates scoped changes without creating commits.
- Detached Git worktrees when a repository has `HEAD`; snapshot workspaces for unborn repositories and non-Git projects. Integration uses stored file-change artifacts and conflict checks, not worker commits.
- Local SQLite state, evidence logs and artifact references, bounded context packets, and recovery based on persisted session and workspace identities.
- Native task cards and child-session navigation for bounded delegated work. Tool-trace rendering belongs to OpenCode; Sol ships no custom TUI.
- A resumable project-initialization wizard. Four parallel native `sol-project-mapper` tasks map technology/integrations, architecture/structure, conventions/testing, and concerns. Consented product context, optional opted-in design guidance, a routed index, and optional root `SOL.md` complete the canonical project knowledge; Sol never stages, commits, or pushes it automatically.
- Decision-complete planning discussions. Before complex planning, Sol can inspect established code patterns, ask only the 2–4 material gray-area questions, persist the resulting scope and decisions without a transcript, and inject that context into Planner automatically.
- Bounded project context loading with source freshness diagnostics, a concise optional `SOL.md` entrypoint, and private per-project preferences stored in external Sol state rather than shared documents.
- Local telemetry through `SessionStore.recordUsage` and `recordTool`: token/cost counters by role and tool-output byte counts, without recording conversation text.

The native adapter contains real SDK session-create/prompt/status/abort calls. Automated driver tests use a simulated host. An installed-host smoke test also passed with OpenCode 1.18.31 and a real model using the native `general` agent, including MCP connection, structured output and persisted-result recovery. This is not a complete long-running Sol/Planner/Executor acceptance test; see [validation evidence](docs/VALIDATION.md).

## Build and test

Requirements: Node.js **22.13 or newer**, npm, and OpenCode for the installed integration. Git enables worktree mode. Configure an available model/provider in OpenCode before using native specialists.

From this repository:

```bash
npm ci
npm run build
npm test
```

`npm run check` runs the build and test suite together. These commands verify the local code; they are not a provider or deployment smoke test.

## Install and restart OpenCode

```bash
npm run install:opencode
node dist/cli/index.js doctor
```

The install command builds first. The installer writes an auto-discovered `plugins/sol.js` loader pointing to **`dist/v2/plugin.js`**, registers the local **`dist/v2/mcp.js`** service, and installs the agents and skills from `assets/`. On first install it sets `sol` as the default agent and backs up affected configuration/files. Built-in OpenCode agents remain available.

The installer manages v2 installations only. Upgrading removes a previously installer-owned Sol TUI registration without changing unrelated TUI configuration; new installs do not read or write TUI configuration. Cleanup of older global installations is otherwise a one-off operation outside this repository.

**Restart OpenCode after installation or updates**, then select Sol in the project you want to work on. The checkout and its build must remain at their installed paths; this is a source-checkout installation. `doctor` checks local installation/configuration indicators, not provider connectivity or successful model execution.

Configuration goes to `~/.config/opencode` unless `OPENCODE_CONFIG_DIR` is set. Agent model names are rendered at install time using `SOL_PRIMARY_MODEL`, `SOL_EXECUTOR_MODEL`, `SOL_REVIEW_MODEL`, and `SOL_LIGHT_MODEL`. The shipped defaults use Terra for Sol, Planner, Executor and Reviewer, and Luna for lightweight specialists and the single project mapper. Set the variables to provider/model IDs available in your OpenCode environment; the shipped names are not a guarantee of availability. Reinstalling preserves user-modified managed files, so inspect existing agent files if a model override does not take effect.

Administrative removal:

```bash
npm run uninstall:opencode
```

Restart OpenCode again. Uninstall conditionally restores/removes installer-owned settings and unchanged managed files; it preserves user edits. It is not a purge of runtime databases or retained artifacts.

## Boundaries and current limitations

- Local-first describes orchestration storage. A configured remote model or media provider can still receive task content. No remote memory server is implemented.
- Workspaces and host permissions support cooperative agents; they are **not an OS sandbox**. Secret-like filename filters are not comprehensive secret detection, and command logs can contain sensitive output.
- Dependencies such as `node_modules` and virtual environments are not copied into isolated workspaces. Declare needed setup in optional `task.environment`: `{ prepare: { command, timeoutMs? }, generatedOutputs: [] }`. The runner executes declared preparation before worker checks and again in fresh merged-tree verification. For a suitable npm project with a lockfile, use `npm ci --ignore-scripts`; choose setup for the actual project. Preparation logs are separate from check evidence. Declared generated outputs are disposable only when newly created and untracked; they cannot hide protected source or delivered artifacts.
- Revisions conservatively refuse **any active attempt**, including unrelated work in the same plan. Cancellation and recovery retain reservations when worker termination is uncertain; safety depends on the trusted driver and host confirmation.
- The package is v2-only, with exactly three exports: `.`, `./plugin`, and `./mcp`.

Inspect local state without calling a model:

```bash
node dist/cli/index.js status --project /path/to/project
node dist/cli/index.js plans --project /path/to/project
node dist/cli/index.js metrics --project /path/to/project
node dist/cli/index.js templates --template fast
```

See [Sol v2 architecture and protocol](docs/SOL-V2.md) for the lifecycle, a minimal source-valid plan, evidence, recovery, and storage details. [Memory research](docs/MEMORY-RESEARCH.md) describes a separate future project, not shipped capabilities.
