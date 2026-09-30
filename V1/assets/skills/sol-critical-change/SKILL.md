---
name: sol-critical-change
description: Use only when a change modifies trust boundaries, permissions, sensitive data, payments, migrations, production state or release-critical behavior.
---

# Critical Change

Do not select this workflow from feature names alone. UI, copy and navigation work inside auth, KYC or onboarding remains standard unless it changes authorization, sensitive-data handling or irreversible server state.

Recorded-fact lookups use fresh `sol_query` observations, not a critical plan. A bounded inspection can use one native `task` with explicit read-only scope and no shell or tests unless requested. Critical work with multiple dependent steps or material decisions uses Planner; validate nonempty scopes early and ensure each task `acceptance` references existing root acceptance IDs. Do not add an unrequested health suite.

For genuinely critical work, use the canonical critical template and persisted draft schema through `sol_plan`. Bound reads/writes, acceptance, threat-sensitive constraints and task `skills: string[]`; select only relevant knowledge via `sourceIds`/`decisionIds`. The schema requires a scoped read-only reviewer downstream of writers. Add a verifier only for a materially different uncertainty. For complex planning use `sol_plan({op: 'propose', objective, planId?})`; retain the returned proposalId and apply it after any questions, rather than copying a proposal into a new plan. Launch execution through `sol_run({planId})`, never native task prompt copying.

Workers use trusted packets or recover via `sol_assignment({attemptId})`, run `sol_check({attemptId, checkId})` and record source-backed inspection via `sol_observe({attemptId, path, claim})`. Return runtime-selected validated JSON with `evidenceRefs`, never LLM-estimated durations. Keep repairs in the existing plan and gates pending until evidence exists. Use `sol_progress({planId})` for status. `sol_ask` or propose returns `nativeArguments`; the primary calls native `question` with them. The after hook captures exact `metadata.answers`; apply automatically refines a proposal using persisted answers. Neither `sol_ask` nor propose opens question UI itself. Never use legacy orchestration or a parallel MCP mutation path.
