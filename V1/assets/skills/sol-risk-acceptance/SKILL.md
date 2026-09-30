---
name: sol-risk-acceptance
description: Use when the user explicitly accepts a known risk or asks to close work with debt.
---

# Risk Acceptance

Keep the exact unresolved condition, impact, scope and revisit trigger through `sol_plan` revision using the canonical persisted schema. Carry explicit acceptance through trusted decisions and select it for relevant tasks via `decisionIds`; use `sourceIds` for relevant sources and `skills: string[]` for required skills. Do not infer consent or invent status enums. For missing material decisions, `sol_ask` persists questions and returns `nativeArguments`; the primary then calls native `question` with those arguments. The plugin after hook captures exact `metadata.answers`; `sol_ask` does not open UI or accept model-supplied answers.

Recorded facts use fresh `sol_query` observations. One bounded investigation or action uses one native `task` with explicit scope, constraints, acceptance, and focused verification; its result must not claim registered Sol evidence. Existing multi-step work runs through `sol_run({planId})`, where workers use trusted packets, `sol_assignment`, `sol_check`, and `sol_observe`. Accepted risk is not a passing check, a fixed defect or permission to skip mandatory gates. Separate release limitations from functional acceptance, original Project Git from transient workspace metadata, and missing registered evidence from cleanup failures.
