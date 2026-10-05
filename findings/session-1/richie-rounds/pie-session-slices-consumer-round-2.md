# pie-session-slices — consumer discovery, round 2

## What we have settled

- The first release must support both **briefing a helper** and **saving a focused record**.
- Pi should choose and use the slice automatically—no approval screen—while avoiding both frequent irrelevant material and dangerous omissions.
- A slice is an **exact set of original conversation messages**, not a recap or interpretation.
- The normal default is simple reuse of your own session history: no extra permission ceremony.

The key design principle is therefore: **you state your intent; Pi identifies the relevant message IDs without rereading the entire session in its working conversation.**

---

❓ **Q5 — What should you be able to point to when naming a slice?**

You said the agent should simply say which `message_ids` to copy. The question is how you want to find or express those IDs in everyday use.

- **A. Message IDs only.** Most precise and token-efficient, but you need a way to see or retrieve IDs.
- **B. Natural landmarks as well.** For example: “from my request to the decision about exports,” or “the last three user requests.” Pi resolves those to exact IDs internally.
- **C. Both.** IDs for exact control; landmarks for convenience.

Scenario:

> “Delegate the testing discussion.”
>
> Pi could select the exact messages internally, then hand off only their IDs and source location. Or you could say: “messages `u_120` through `a_143`.”

Why this matters: the first option best protects token use; the second is much easier to use when you do not have IDs at hand.

➡️ **Recommended answer: C — both.** Internally every slice remains exact IDs, while you retain a fast human way to name the intended region.

---

❓ **Q6 — What should a helper receive first?**

A message ID alone is only useful if the helper can retrieve the original content. There are two ways to make that happen:

- **A. A reference only:** Pi tells the helper which session and message IDs to retrieve. This uses the fewest tokens, but only works if the helper has safe access to that session.
- **B. The original messages copied into the helper’s starting brief.** This works even for an isolated helper, but spends tokens proportional to slice size.
- **C. A reference by default, with automatic copying only when the helper cannot access the source.**

Why this matters: your goal is low token cost, but the helper must still be able to act. A reference that the helper cannot open is an empty handover.

➡️ **Recommended answer: C — reference first; copy only when necessary.**

---

❓ **Q7 — When Pi is uncertain, what failure should it prefer?**

Automatic selection cannot be perfect. Choose the default bias:

- **A. Include a little extra surrounding conversation.** The helper may see some noise, but is less likely to miss the decision that changes the answer.
- **B. Keep slices aggressively narrow.** The helper gets less noise, but may need to come back for missing context.
- **C. Let the request wording decide:** broad requests favour inclusion; explicitly bounded requests stay strict.

You flagged omissions as more dangerous, unless excess material happens frequently enough to make slices poor packages.

➡️ **Recommended answer: C — request-sensitive, with a small inclusion bias by default.** It turns your stated trade-off into an observable rule rather than a guess.

---

❓ **Q8 — How should a saved slice behave over time?**

A saved slice may be used later, after the conversation has continued or branched.

- **A. A live bookmark:** it remembers the message IDs and opens the original material when needed. Small and faithful, but dependent on the original session remaining available.
- **B. A frozen copy:** it stores the original messages as they were. Portable and durable, but duplicates private material.
- **C. Both forms:** default to a live bookmark; offer an explicit frozen export when portability matters.

➡️ **Recommended answer: C — live bookmark by default; frozen copy on request.** It honours low-token reuse without closing off durable handover files.
