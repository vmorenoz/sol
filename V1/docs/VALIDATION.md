# Installation and validation — Sol 2.0.0

Validated on 2026-09-20 UTC, macOS, Node 24.18.0 and OpenCode 1.18.31.

## Repository and installation

- `npm run check`: TypeScript build and **233 tests in 12 files passed**.
- Build starts by removing this package's generated `dist` directory, preventing deleted source from remaining distributed as stale JavaScript.
- Only the current runtime, SQLite adapter, media capability and CLI remain. There is no legacy package export or previous runtime implementation.
- Eight agent definitions are installed: Sol, Planner, Executor, Scout, Researcher, Reviewer, Verifier and Creator.
- Effective configuration, host agent listing, model availability, v2 install manifest, plugin loader and local MCP entrypoint were checked after installation.
- The previous installation and orphan generated files were archived outside the repository. Old execution history is not loaded as current plans.

## Native-host smoke

A temporary authenticated loopback OpenCode server loaded the installed plugin and connected its Sol MCP. The test executed **only the native `general` agent**, configured with `openai/gpt-5.6-luna`; no Sol or Pulso agent was invoked.

Observed final result:

```json
{
  "installedPluginLoaded": true,
  "installedMcp": "connected",
  "nativeSessionCreate": "passed",
  "realModel": "openai/gpt-5.6-luna",
  "executedAgent": "general",
  "structuredOutput": "passed",
  "persistedResultRecovery": "passed",
  "durationMs": 3943
}
```

Temporary sessions and the owned server were stopped and removed afterward.

The native test exposed two integration details now covered by regression tests:

1. A wildcard deny also denies `StructuredOutput`. Worker definitions and runtime-created sessions explicitly allow this result-only capability.
2. The host's legacy HTTP history route returned a serialization error for a history containing user JSON-schema format metadata. Recovery now asks for the latest response (`limit: 1`), which is the assignment's result, instead of retrieving unrelated prior history. This retrieval was verified against the real host.

## Operational defects corrected before installation

- Declared environment preparation runs in worker and fresh merged-verification workspaces. Preparation errors remain distinct from implementation defects.
- Declared disposable generated outputs no longer invalidate normal builds; existing/tracked source and deliverable artifacts remain protected.
- Confirmed no-creation failures release reservations and follow bounded retry policy. Ambiguous creation retains its conservative reconciliation path.
- Dependency reports are retrieved by bounded, lossless pages rather than embedded in full in downstream assignments.
- Unverifiable artifactless inspection evidence is rejected.

## Remaining verification and improvement scope

- A complete real Sol conversation covering Planner clarification, human question UI, concurrent Executors, integration and restart is still separate acceptance work. Native transport/model success is not a claim that this whole sequence has been exercised with real agents.
- Long-duration load, model-quality comparisons and measured token savings need representative workloads.
- Worktrees are cleaned, while evidence, archives and snapshots are retained; configurable retention and storage quotas remain an improvement.
- Isolation is cooperative rather than an OS sandbox. No remote multiuser memory platform is included.

After changing global configuration, fully restart OpenCode. An already-running process continues to use its previously loaded plugin and agent definitions.
