---
name: sol-fast-change
description: Use for a small, local, low-risk change delegated to one general executor with focused verification.
---

# Fast Change

Use one native `task` call with `subagent_type: 'sol-executor'` for one bounded change. The prompt must give the objective, explicit read/write scope, constraints, unrelated-work preservation, relevant skills, acceptance criteria, and exact focused verification. No explicit `sol_plan` or `sol_run` is needed. Reserve those workflows for multi-step work, dependencies or material decisions. Do not add a default reviewer/verifier pair or an unrequested health suite.

The native task prompt is the executor's assignment; require appropriate non-Sol UI/design skills when requested. It reports changed files and exact verification results without inventing Sol evidence or durations. For material unknowns returned by the specialist, the primary normally uses native `question` directly and leaves completion unresolved until answered. Planned work still uses trusted packets, `sol_assignment`, `sol_check`, and `sol_observe`. An explicit no-orchestration request uses the host built-in agent instead; do not launch workers.
