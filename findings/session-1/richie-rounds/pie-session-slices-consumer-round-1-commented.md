# pie-session-slices — consumer discovery, round 1

## The promise we are testing

Imagine Pi has been helping you for a long time. Instead of re-reading the entire conversation whenever it needs to bring someone else in or save a useful record, Pi could make a focused **slice**: the relevant decisions, requests, and evidence for one specific job.

For example:

> “Give my research helper only the discussion about choosing a travel policy—not the unrelated debugging conversation.”

Before deciding how this should work, we need to agree what a slice is *for* and who controls it.

---

❓ **Q1 — What is the first job you want a slice to do?**

The first job determines what “good” means. A slice can be useful in several different ways:

- **A. Brief a helper:** Pi prepares a compact handover so another assistant can continue one part of the work.
- **B. Preserve a record:** Pi saves a focused, readable extract to a file for you to revisit or share.
- **C. Help Pi re-orient itself:** Pi creates a compact working brief for the current conversation when it has become long.
- **D. All three from the start.**

Why this matters: a handover must retain instructions and unresolved questions; a record must be readable and trustworthy; a working brief can be more temporary. Trying to satisfy all three immediately may make the first version less reliable.

➡️ **Recommended answer: A — brief a helper first.** It has the clearest success test: does the helper get enough relevant background to deliver useful work without being overloaded? <<ASB: [rvw_001] Comment on block "➡️ **Recommended answer: A — brief a helper first.** It has the clearest success test: does the helper get enough relevant background to deliver useful work without being overloaded?": A and B>>

---

❓ **Q2 — Who chooses what belongs in a slice?**

Consider this moment:

> You say, “Ask a helper to compare the two approaches we discussed earlier.”

Pi could:

- **A. Ask you to identify the relevant part.** Maximum control, but more effort each time.
- **B. Make a suggested slice and show you a short preview before it is used or saved.** A practical balance: Pi does the searching; you approve the boundary.
- **C. Choose and use the slice automatically.** Fastest, but Pi may include something irrelevant or omit a crucial decision.

Why this matters: a slice is a claim about what context another person or assistant needs. A bad boundary can quietly lead to bad work.

➡️ **Recommended answer: B — Pi proposes; you approve.** Later, automation can be added for low-risk cases once trust is earned. <<ASB: [rvw_002] Comment on block "➡️ **Recommended answer: B — Pi proposes; you approve.** Later, automation can be added for low-risk cases once trust is earned.": C - errors of omission of something important are riskier than errors of inclusion but if errors of inclusion occur very frequently, then this is a poor package. But given how frequently this will be used with subagents, I don't need to add a review step.>>

---

❓ **Q3 — How faithful should a slice be to the original conversation?**

A slice can be:

- **A. Exact excerpts:** the original words, in order. Easy to verify, but sometimes long and messy.
- **B. A plain-language recap:** shorter and easier to consume, but it can accidentally change meaning.
- **C. Both:** a short recap paired with supporting original excerpts.

Scenario:

> “We rejected option X because it would expose customer data.”

A recap is easy for a helper to use, while the original exchange lets you check that the recap has not overstated or distorted the decision.

➡️ **Recommended answer: C — recap plus supporting excerpts.** It balances speed with trust, and gives the recipient a route back to the evidence. <<ASB: [rvw_003] Comment on block "➡️ **Recommended answer: C — recap plus supporting excerpts.** It balances speed with trust, and gives the recipient a route back to the evidence.": A - the idea is a 'slice' of session history - not a summary or interpretation. More importantly, this should require the least little number of tokens spent - the agent should just say - the following message_ids - copy them over. The rest should be programmatic. No token burning on this step.>>

---

❓ **Q4 — What should happen when a slice might contain sensitive information?**

Conversation history can include personal details, client information, credentials, or private reasoning. The product could:

- **A. Treat every slice as private and require an explicit confirmation before it leaves the current conversation or is written to disk.**
- **B. Warn only when Pi thinks information looks sensitive.** Less interruption, but detection will miss things.
- **C. Assume normal work is safe unless you opt in to protection.** Fast, but unsafe as a default.

➡️ **Recommended answer: A — explicit confirmation for any external handover or saved file.** The first version should optimize for trust, not friction. <<ASB: [rvw_004] Comment on block "➡️ **Recommended answer: A — explicit confirmation for any external handover or saved file.** The first version should optimize for trust, not friction.": C - there is no opt-in. It's just part of my session history for reuse by me. Keep it simple - none of this security theatre.>>
