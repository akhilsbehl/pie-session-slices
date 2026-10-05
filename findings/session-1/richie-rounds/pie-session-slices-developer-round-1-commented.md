# pie-session-slices — developer discovery, round 1

## Established product model

A **Session Slice** is a durable, exact extraction of selected material from the active Pi session. It is selected from user intent without placing the full session history into the model’s context.

Selection intents:

1. **Topic-based:** “extract our discussion about X.” Pi must locate relevant turns through programmatic session inspection.
2. **Positional:** “extract the first/last N turns.” This is exact and performs no relevance judgment.

Payload modes:

- `conversation`: direct human↔assistant messages only.
- `filtered`: conversation plus tool/subagent/skill material selectively retained by the relevance decision. Not applicable to positional selection.
- `all`: all material belonging to selected turns; positional selection includes all material in those turns.

A completed slice is written durably under `/tmp`, and its path is echoed into the live context. A downstream subagent receives a reference when it can resolve the source; otherwise it receives copied contents. <<ASB: [rvw_001] Comment on " A downstream subagent receives a reference when it can resolve the source; otherwise it receives copied contents.": subagent also just receives this file path reference only and reads it.>>

---

❓ **Q1 — What mechanism may inspect history to perform topic selection?**

The central constraint is contradictory unless we distinguish *Pi’s working context* from *extension-side programmatic access*. The extension can inspect `sessionManager` entries directly without adding them to the active model prompt. But topic relevance still requires a decision engine.

- **A. Deterministic metadata/text search only.** Cheap and private; weak semantic recall (misses paraphrases and implicit decisions).
- **B. One bounded model call over a compact index of session entries.** Strong semantic matching; costs tokens but does not load full history into Pi’s active context. The model outputs only selected IDs.
- **C. Progressive retrieval:** local lexical/metadata candidate search, then one bounded model call over only candidates. Best cost/quality balance; more moving pieces.

Why this matters: this is the extension’s defining mechanism. “No re-reading in context” is achievable, but “intelligent” selection needs either search heuristics or a separate bounded evaluator.

➡️ **Recommended answer: C.** Create a compact, incremental index; retrieve candidates locally; use an isolated bounded selector only when heuristics are insufficient. <<ASB: [rvw_002] Comment on block "➡️ **Recommended answer: C.** Create a compact, incremental index; retrieve candidates locally; use an isolated bounded selector only when heuristics are insufficient.": Yes, this is the crucial problem to solve for exactly. Hold on to this question. I'll come back to this - I need to do some iteration with you in-session to test if this works.>>

---

❓ **Q2 — What is a ‘turn’ for exact first/last N selection?**

Pi sessions contain user messages, assistant messages, tool calls/results, custom entries, compactions, context edits, and branches. Your `all` mode depends on a stable boundary.

- **A. User-anchored exchange:** one user message plus every subsequent assistant/tool event until the next user message. Most intuitive for “last four turns.”
- **B. Assistant-anchored exchange:** one assistant reply and its tool work, paired with the preceding user message.
- **C. Raw session entries:** N serialized entries. Exact mechanically, but not what a person normally calls a turn.

Scenario:

```text
User: “Run tests”
Assistant: starts tools A and B
Tool A/B: results
Assistant: “Tests passed”
User: “Now package it”
```

Under A, the first group is one turn. Under C, it is five entries.

➡️ **Recommended answer: A — user-anchored exchange.** It yields predictable human semantics and makes `conversation`/`all` straightforward. <<ASB: [rvw_003] Comment on block "➡️ **Recommended answer: A — user-anchored exchange.** It yields predictable human semantics and makes `conversation`/`all` straightforward.": Yes. In your example, everything from "Run tests" to "Tests passed".>>

---

❓ **Q3 — Which session projection is authoritative?**

Pi exposes raw active-branch entries and a projection that applies compaction and later context edits—the latter reflects what Pi would actually see now. These can differ.

- **A. Raw active branch is authoritative.** Best for historical fidelity; includes material Pi may have compacted away or overridden.
- **B. Context projection is authoritative.** Best for downstream continuity; respects current compaction/context edits but may not preserve raw original details.
- **C. Store both identities and make the choice explicit per slice.** More provenance, but more complexity.

Why this matters: without an explicit choice, “exact slice” is ambiguous after compaction, branching, or context edits.

➡️ **Recommended answer: C.** Preserve raw source entry IDs and record the projection used; default policy can be resolved later. <<ASB: [rvw_004] Comment on block "➡️ **Recommended answer: C.** Preserve raw source entry IDs and record the projection used; default policy can be resolved later.": A + ignore any compaction rounds and branching summaries.>>

---

❓ **Q4 — What exact artifact format should `/tmp` contain?**

The artifact must be machine-readable for downstream Pi workflows, faithful enough to audit, and inexpensive to reference.

- **A. JSONL:** one original-like entry per line plus a metadata header. Best for replay/programmatic consumption.
- **B. Markdown:** easy for people to read, but requires conversion and can lose structured content.
- **C. A directory bundle:** `manifest.json` plus `entries.jsonl` (and optional rendered Markdown). Most extensible, but more filesystem surface.

➡️ **Recommended answer: C — directory bundle.** A stable manifest can identify session, branch, projection, selector, selected IDs, and payload mode; JSONL preserves exact entries; rendering stays optional. <<ASB: [rvw_005] Comment on block "➡️ **Recommended answer: C — directory bundle.** A stable manifest can identify session, branch, projection, selector, selected IDs, and payload mode; JSONL preserves exact entries; rendering stays optional.": A.>>
