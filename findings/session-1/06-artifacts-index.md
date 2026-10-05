# 06 — Artifacts index

## In this handoff (`exp/handoff-2026-10-05/`)

- `README.md`, `01`–`07` (this set) — new, written 2026-10-05 from the session folder.
- `artifacts/` — verbatim copies of all 7 `subagent-artifacts/outputs/*/*.md`:
  `repo-setup-result`, `pi-extension-feasibility`, `consumer-round-1-feedback`,
  `session-log-structure`, `pi-semantic-projection-analysis`,
  `jq-semantic-trim-prototype`, `pi-aware-semantic-slice-prototype`.

## Source sessions (read-only; do not move)

- `~/.pi/agent/sessions/--home-akhil-configs-pi-extensions-pie-session-slices--/`
  - `2026-09-21T20-31-53-559Z_01a0c5ab…jsonl` (152 lines) — the work session.
  - `2026-09-22T21-14-08-648Z_01a0caf8…jsonl` (8 lines) — delegate stub.
  - `2026-09-24T15-38-24-117Z_01a0d411…jsonl` (7 lines) — "hi"/error ping.
  - `2026-09-21…/ ` (9 UUID dirs) — per-subagent run records.
  - `subagent-artifacts/outputs/` (7 reports) — origin of `artifacts/`.

## Referenced but NOT in the session folder (pointers only)

- Richie rounds: copied into `richie-rounds/` in this handoff (9 files: consumer R1/R2,
  developer R1/R2/R3 + `-commented` variants with ASB replies; consumer-R2 has no
  `-commented` variant — feedback arrived via session). Origins still at
  `~/.richie/ephemeral/pie-session-slices-*.md`.
- Repo state: `github.com:akhilsbehl/pie-session-slices` @ `ba3af56`; local
  submodule checkout `~/configs/pi/extensions/pie-session-slices` (`main`,
  `AGENTS.md` + `exp/` untracked, nothing committed since init).
- Later mapping work (Oct 4–5, separate from these sessions): `exp/generate.mjs`,
  `exp/session-map-*.html`, `exp/capture-note.md`, `exp/session-map-notes.md`;
  ephemeral evidence `/tmp/session-maps/` (evidence.json, wire-final.json, previews).

## Expired (do not go looking)

- `/tmp/pi-aware-semantic-slice-1353-188645/` (E5 script + 46-record slice) — gone.
- `/tmp/jq-semantic-trim-prototype-5156e6d4/` (E3 copy + filter + output) — gone.
- Both are reproducible from the reports (exact commands/filters/hashes inside).
