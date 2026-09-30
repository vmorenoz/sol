---
name: sol-existing-project
description: Use when Sol encounters an unfamiliar existing repository and needs incremental project knowledge without onboarding.
---

# Existing Project

For “is there project state evidence?”, use `sol_query({kind: 'project', queryId: 'project-status'})`; it always makes a fresh observation and returns a separate `observationId`. It needs no skill loading, mapping, plan or Executor. Only when interpretation or source inspection is needed, use one native `task` with `subagent_type: 'explore'`, a bounded read-only prompt, explicit reads, and no tests or health analysis unless requested. Never require onboarding or an exhaustive map. Reserve `sol-executor` for bounded changes and `sol_plan` with Planner and `sol_run` for multi-step work, dependencies or material decisions.

Distinguish original Project Git metadata from transient workspace metadata; isolated HEAD does not identify the user's root branch. Report missing registered evidence separately from cleanup problems and retain partial findings faithfully.

Workers use trusted packets or recover via `sol_assignment({attemptId})`, load relevant skills and return runtime-selected validated JSON. Assigned checks use `sol_check({attemptId, checkId})`; source-backed observations use `sol_observe({attemptId, path, claim})`. Cite returned `evidenceRefs`, never LLM-estimated durations. Parallel ownership must be non-overlapping. Material unknowns return structurally to the coordinator: `sol_ask` persists questions and returns `nativeArguments`, then the primary calls native `question` with them. The after hook captures exact `metadata.answers`; `sol_ask` does not open UI.
