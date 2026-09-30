---
name: sol-release
description: Use only when the objective explicitly includes building, signing, deploying or distributing a release.
---

# Release

Use Planner for this multi-step workflow and validate nonempty scopes and task `acceptance` references to existing root acceptance IDs before submission. A recorded-state question uses a fresh `sol_query` observation; a single explicitly requested check can use one native `task` with that exact verification and no invented release objective or health suite.

Use `sol_plan` with the canonical release template and persisted draft schema only for the explicit release objective. Use canonical executor tasks for authorized release work and scoped read-only downstream reviewer gates. Include task `skills: string[]`, selected knowledge via `sourceIds`/`decisionIds`, and checks for applicable artifacts, signing, configuration, rollback and health. Launch through `sol_run({planId})`, not native task prompt copying.

Workers use trusted packets or recover via `sol_assignment({attemptId})`, invoke `sol_check({attemptId, checkId})` and record source-backed inspection via `sol_observe({attemptId, path, claim})`. Cite returned `evidenceRefs` in runtime-selected validated JSON; never provide LLM-estimated durations. Keep release failures separate from functional acceptance in the supplied schema; do not invent status enums or weaken gates. For authorization questions, `sol_ask` persists them and returns `nativeArguments`, then the primary calls native `question` with those arguments. The after hook captures exact `metadata.answers`; `sol_ask` does not open UI.
