/**
 * Test harness: process 3 recent sessions in various calling patterns.
 * Usage: node scripts/test-slices.mjs
 * Output: findings/session-3/artifacts/*.jsonl + manifest.json
 */
import { copyFileSync, mkdirSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const { runSlice } = await import(join(root, "dist", "pie-session-slices.mjs"));

const SESSIONS = [
  "/home/akhil/.pi/agent/sessions/--home-akhil-configs--/2026-10-05T06-17-32-148Z_01a10ab5-d8f3-7713-bf19-51df5199a729.jsonl",
  "/home/akhil/.pi/agent/sessions/--home-akhil-configs--/2026-10-04T05-13-54-486Z_01a10555-3c35-7791-a57e-8ebc591cb769.jsonl",
  "/home/akhil/.pi/agent/sessions/--home-akhil-configs--/2026-10-04T04-20-38-106Z_01a10524-7658-7791-a57e-8eb9be6aea62.jsonl",
  "/home/akhil/.pi/agent/sessions/--home-akhil-configs-pi-extensions-pie-session-slices--/2026-09-21T20-31-53-559Z_01a0c5ab-00d6-74e0-aeef-a66de6a36b16.jsonl",
];

const PATTERNS = [
  { name: "full", selector: { type: "full" }, includeToolResults: false },
  { name: "full-tools", selector: { type: "full" }, includeToolResults: true },
  { name: "last3", selector: { type: "last", n: 3 }, includeToolResults: false },
  { name: "first2-tools", selector: { type: "first", n: 2 }, includeToolResults: true },
];

const outDir = join(root, "findings", "session-3", "artifacts");
mkdirSync(outDir, { recursive: true });

const manifest = [];
for (const sessionFile of SESSIONS) {
  const short = basename(sessionFile).slice(11, 19);
  for (const p of PATTERNS) {
    const outcome = await runSlice({
      selector: p.selector,
      includeToolResults: p.includeToolResults,
      sessionFile,
    });
    const dest = join(outDir, `slice-${short}-${p.name}.jsonl`);
    copyFileSync(outcome.path, dest);
    manifest.push({
      session: basename(sessionFile),
      pattern: p.name,
      selector: p.selector,
      includeToolResults: p.includeToolResults,
      artifact: basename(dest),
      ...outcome,
    });
    console.log(`${short} ${p.name}: turns=${outcome.turns} records=${outcome.records} pipeline=${outcome.pipeline} projector=${outcome.projector} source=${outcome.source}`);
  }
}
writeFileSync(join(outDir, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
console.log(`wrote ${manifest.length} slices + manifest.json to ${outDir}`);
