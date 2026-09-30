# Memory research: a separate future project

**Status: research direction, not implemented Sol v2 functionality.** Sol currently has local execution records, selected source context, and local usage telemetry. It does not ship the remote memory service, multiuser platform, hybrid retrieval, or learning system described here. This project would need its own design, implementation, security model, and evaluation before integration with Sol.

## Research foundations

These papers are relevant starting points, not evidence that Sol implements their methods or achieves their results. No performance comparison or improvement claim is made here.

| Reference | Question to investigate |
| --- | --- |
| [A-MEM: Agentic Memory for LLM Agents](https://arxiv.org/abs/2502.12110) | How can structured notes, links, and memory evolution help organize agent knowledge without losing original evidence? |
| [Zep: A Temporal Knowledge Graph Architecture for Agent Memory](https://arxiv.org/abs/2501.13956) | How should temporal facts and changing relationships be represented and retrieved? |
| [HippoRAG: Neurobiologically Inspired Long-Term Memory for Large Language Models](https://arxiv.org/abs/2405.14831) | When does associative graph retrieval help connect evidence across sources? |
| [Mem0: Building Production-Ready AI Agents with Scalable Long-Term Memory](https://arxiv.org/abs/2504.19413) | What extraction, updating, and retrieval policies are useful for persistent agent memory? |
| [LongMemEval: Benchmarking Chat Assistants on Long-Term Interactive Memory](https://arxiv.org/abs/2410.10813) | How should temporal reasoning, knowledge updates, multi-session questions, and abstention be evaluated? |

Read full methods and evaluation settings before adopting a design. Results reported for one benchmark, model, corpus, or memory budget do not establish results for a new platform. The proposed work combines and evaluates established ideas; it does not claim an unprecedented memory algorithm.

## Proposed platform boundary

Explore a standalone service usable by multiple applications, users, and agents. A user could belong to several spaces: personal, team, project, or explicitly shared. Membership and permissions must be enforced at ingestion, retrieval, update, export, and deletion—not merely encoded as instructions in a prompt. Cross-space retrieval should require explicit authorization and preserve the source space's visibility.

Sol could eventually act as one client through a separately versioned interface, potentially MCP. Its current local orchestration MCP is not that remote memory service. Execution authority, permission to remember, and permission to retrieve are distinct capabilities. A retrieved instruction or remembered preference must not grant tool authority or override current user intent.

## Memory records: evidence before summaries

A candidate record should retain enough information to answer **who asserted this, from what exact source, when was it valid, and under which conditions?** The following are conceptual requirements, not a shipped schema:

- Stable identity, owner/space, access policy, retention policy, and record type: observation, sourced fact, hypothesis, decision, preference, procedure, or derived summary.
- Exact provenance: source identifier, source version/content hash, location/span or message reference, author/producer, acquisition method, and derivation links. A URL alone is insufficient when its contents can change.
- Separate event/valid time from ingestion/recording time. Support validity intervals, supersession, retraction, and “known as of” queries without silently rewriting history.
- Conditions of applicability: project, branch or source version, dependency/runtime versions, environment, jurisdiction where relevant, and explicit preconditions. An old implementation fact may be historically correct but invalid for the current checkout.
- Confidence and verification status tied to evidence and evaluation, not to how confidently or frequently a model repeats a statement.
- Distinct hypotheses and contradictions. Store alternatives and the observations that would confirm or falsify them. Unknown and expired are useful states, not failures to fill with plausible text.

Derived summaries should point to exact supporting versions and carry their own generation metadata. Updating a source must allow dependent summaries, indexes, and recommendations to be invalidated or recomputed. A source-backed statement still needs interpretation; provenance alone is not proof of truth.

## Retrieval hypothesis

Evaluate a hybrid pipeline combining lexical search, semantic/vector retrieval, structured metadata/time filters, and graph traversal. Authorization and space boundaries must constrain candidates before content is exposed; cached results need the same boundary. Then evaluate reranking by query relevance, source reliability, temporal/conditional validity, and diversity of evidence.

Return a bounded evidence packet containing exact source references, validity conditions, unresolved contradictions, and reasons for inclusion. Avoid retrieving all historical context into every prompt. Prefer original evidence when a derived summary is stale or its source version is unavailable. Retrieval should be able to abstain when no authorized, applicable evidence supports an answer.

The useful contribution would be measured retrieval behavior and operational reliability for a defined workload. Whether graph traversal, embeddings, or any combination is beneficial remains an empirical question.

## Learning must be evaluated

Repeated retrieval or model agreement must not promote hallucinations into durable facts. Record user corrections and execution feedback with provenance; treat any generalized policy or procedure as a hypothesis until evaluated. A successful isolated execution is evidence for its recorded conditions, not universal correctness.

A proposed learning loop would:

1. Capture a candidate update and its supporting/contradicting evidence.
2. Check scope, source version, temporal validity, and authorization.
3. Evaluate on held-out queries/tasks, including counterexamples and changed conditions.
4. Compare with a fixed baseline under matched model, retrieval, token, and cost budgets.
5. Promote, reject, or retain as a hypothesis with a recorded decision and reversible version.

Separate retrieval improvements from model changes, prompt changes, and increased context budgets. Prevent benchmark/test data from leaking into learned memory. Track regressions and uncertainty rather than selecting only favorable examples.

## Deletion and correction propagation

Deletion must reach original records and their derived summaries, links, embeddings, search indexes, caches, exports, and downstream replicas where the service controls them. Maintain derivation lineage so a deletion or access revocation can invalidate dependent material. Shared records require a precise policy for independent sources and permissions; copying into a summary must not bypass revocation.

Define tombstones, backup retention/expiry, restoration behavior, and client invalidation protocols before promising deletion guarantees. A stale backup must not silently reintroduce deleted records. Already disclosed material outside the platform's control has a different boundary; document it rather than claiming universal recall. Correcting a fact also requires retrieval/index propagation, while retaining authorized historical context where policy allows.

## Evaluation agenda and decision gates

Start with a versioned corpus and explicit source-of-truth annotations, plus synthetic temporal/conflict cases and representative consented project tasks. Use LongMemEval as one reference workload alongside application-specific tests, subject to its data/license conditions.

Evaluate:

- Retrieval relevance and source/version attribution, not just fluent final answers.
- Knowledge updates, time-sensitive queries, conditional validity, contradiction handling, and abstention when evidence is absent.
- Cross-user/space isolation, membership changes, revoked access, and deletion propagation through every derived representation.
- Resistance to poisoned or instruction-bearing sources and repeated unsupported claims.
- End-to-end latency, storage, retrieval/token budgets, and operational cost, reported with workload and configuration.
- Ablations for lexical-only, vector-only, graph-assisted, hybrid, and no-memory baselines; reproducibility across runs and model versions.

Proceed from a provenance/temporal prototype to retrieval experiments, then evaluated updates and multiuser service hardening. Connect Sol only after the platform's contracts and evidence justify it. Until then, this document is a research plan—not a product capability, performance promise, or algorithmic novelty claim.
