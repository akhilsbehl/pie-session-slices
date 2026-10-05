#!/usr/bin/env node
// Session-log vs LLM-context map. Composes ONLY pi's shipped code; no custom
// reimplementation of the projection. Run: node generate.mjs [sessionFile]
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { Buffer } from "node:buffer";

const PI_CODING =
  "/home/akhil/.pi/agent/install/releases/1.0.2/node_modules/@earendil-works/pi-coding-agent/dist/core";
const PI_AI =
  "/home/akhil/.pi/agent/install/releases/1.0.2/node_modules/@earendil-works/pi-ai/dist";

const sessionFile =
  process.argv[2] ??
  "/home/akhil/.pi/agent/sessions/--home-akhil-warchives-fde-role--/2026-08-13T10-30-18-170Z_019ffaac-373a-7661-b332-c539269d210a.jsonl";

const sm = await import(`${PI_CODING}/session-manager.js`);
const codingMsg = await import(`${PI_CODING}/messages.js`);
const transcript = await import(`${PI_AI}/utils/transcript.js`);
const { transformMessages } = await import(`${PI_AI}/api/transform-messages.js`);
const { convertResponsesMessages } = await import(
  `${PI_AI}/api/openai-responses-shared.js`
);

// One OpenAI model only (per scope). gpt-4.1: non-reasoning, api openai-responses,
// input text+image. Mirrors catalog entry in pi-ai/dist/providers/data/openai.json.
const openaiModel = {
  id: "gpt-4.1",
  provider: "openai",
  api: "openai-responses",
  baseUrl: "https://api.openai.com/v1",
  reasoning: false,
  input: ["text", "image"],
  compat: { supportsStrictMode: true },
};
const allowedProviders = new Set(["openai", "openai-codex", "opencode"]);
const wireOptions = {
  supportsMidConvoSystemMessages: false,
  includeSystemPrompt: true,
};

const rawText = readFileSync(sessionFile, "utf8");
const rawLines = rawText.split("\n").filter((l) => l.length > 0);
const fileEntries = sm.loadEntriesFromFile(sessionFile);
const header = fileEntries.find((e) => e.type === "session");
const sessionEntries = fileEntries.filter((e) => e.type !== "session");
const lineBytes = rawLines.map((l) => Buffer.byteLength(l, "utf8"));
const totalDiskBytes = lineBytes.reduce((a, b) => a + b, 0) + rawLines.length; // + newlines

// Leaf path order via projection (handles compaction/edits; linear here).
const fullProj = sm.buildSessionProjection(
  sessionEntries,
  sessionEntries[sessionEntries.length - 1]?.id ?? null,
);
const leafEntries = fullProj.entries.map((e) => e.sourceEntry);
const leafIds = new Set(leafEntries.map((e) => e.id));

const words = (s) => (s.trim().length === 0 ? 0 : s.trim().split(/\s+/).length);
const bytesOf = (v) => Buffer.byteLength(JSON.stringify(v), "utf8");

function diskEntryInfo(entry) {
  const idx = sessionEntries.findIndex((e) => e.id === entry.id);
  // rawLines[0] is header; sessionEntries[i] <-> rawLines[i+1]
  const line = rawLines[idx + 1] ?? "";
  return { line, bytes: Buffer.byteLength(line, "utf8"), words: words(line) };
}
function llmOf(messages) {
  return codingMsg.convertToLlm(messages);
}
function wireOf(llmMessages) {
  const ctx = transcript.normalizeContext({ messages: llmMessages });
  return convertResponsesMessages(
    openaiModel,
    ctx,
    allowedProviders,
    wireOptions,
  );
}

// Per-assistant-turn computation: request that PRODUCED assistant k = prefix before it.
const assistantEntries = leafEntries.filter(
  (e) => e.type === "message" && e.message.role === "assistant",
);
const byId = new Map(sessionEntries.map((e) => [e.id, e]));

const turns = [];
let prevWireLen = 0;
let prevWireJson = "";
let cumWireSent = 0;
for (let k = 0; k < assistantEntries.length; k++) {
  const a = assistantEntries[k];
  const parentId = a.parentId;
  const projBefore = sm.buildSessionProjection(sessionEntries, parentId);
  const llmBefore = llmOf(projBefore.messages);
  const wireBefore = wireOf(llmBefore);
  const wireJson = JSON.stringify(wireBefore);
  const wireBytes = Buffer.byteLength(wireJson, "utf8");
  cumWireSent += wireBytes;
  // Disk cumulative up to parent (what the model could have seen) + assistant stored size
  let diskCumBefore = 0;
  {
    // sum raw lines for entries on path up to parentId inclusive
    const pathProj = sm.buildSessionProjection(sessionEntries, parentId);
    const ids = new Set(pathProj.entries.map((e) => e.sourceEntry.id));
    // include non-context entries too? For "what's on disk", count everything up to that line number.
    const lineIdx = sessionEntries.findIndex((e) => e.id === a.id);
    for (let i = 0; i < lineIdx; i++) diskCumBefore += lineBytes[i + 1] + 1;
  }
  const aInfo = diskEntryInfo(a);
  // Wire delta vs previous request (new input items since last call).
  // These ARE the disk entries since the last turn, rendered as wire items.
  const deltaItems = wireBefore.slice(prevWireLen);
  const deltaPreview = deltaItems.slice(0, 3).map((it) => {
    const s = JSON.stringify(it, null, 1);
    return s.length > 1500 ? s.slice(0, 1500) + "\n… [item truncated]" : s;
  }).join("\n---\n");
  turns.push({
    n: k + 1,
    id: a.id,
    parentId,
    timestamp: a.timestamp,
    model: a.message.model,
    stopReason: a.message.stopReason,
    toolCalls: (a.message.content || [])
      .filter((b) => b.type === "toolCall")
      .map((b) => ({ id: b.id, name: b.name, argsBytes: bytesOf(b.arguments ?? {}) })),
    thinkingChars: (a.message.content || [])
      .filter((b) => b.type === "thinking")
      .reduce((s, b) => s + (b.thinking ?? "").length, 0),
    textChars: (a.message.content || [])
      .filter((b) => b.type === "text")
      .reduce((s, b) => s + (b.text ?? "").length, 0),
    usage: a.message.usage ?? null,
    diskAssistantBytes: aInfo.bytes,
    diskAssistantLine: aInfo.line,
    diskCumBefore,
    wireReqBytes: wireBytes,
    wireReqItems: wireBefore.length,
    wireDeltaCount: deltaItems.length,
    wireDeltaBytes: bytesOf(deltaItems),
    wireDeltaPreview: deltaPreview,
    wireDeltaTruncated: deltaItems.length > 3,
    cumWireSent,
  });
  prevWireLen = wireBefore.length;
  prevWireJson = wireJson;
}

// Final full wire (after last assistant + tool results, i.e. full transcript replay)
const projFull = sm.buildSessionProjection(sessionEntries, leafEntries[leafEntries.length - 1]?.id ?? null);
const llmFull = llmOf(projFull.messages);
const wireFull = wireOf(llmFull);
const wireFullBytes = bytesOf(wireFull);

// Session-wide labels (data-driven so any session file works)
const fileModelSet = new Map();
for (const e of sessionEntries) {
  if (e.type === 'message' && e.message.role === 'assistant' && e.message.provider) {
    fileModelSet.set(`${e.message.provider}/${e.message.model ?? '?'}`, true);
  }
}
const fileModelsLabel = [...fileModelSet.keys()].join(', ') || 'none recorded';
const nUser = sessionEntries.filter((e) => e.type === 'message' && e.message.role === 'user').length;
const nTR = sessionEntries.filter((e) => e.type === 'message' && e.message.role === 'toolResult').length;
const nSys = sessionEntries.filter((e) => e.type === 'message' && e.message.role === 'system').length;
// Disk breakdown by entry type
const diskByType = {};
for (const e of sessionEntries) {
  const key = e.type === "message" ? `message:${e.message.role}` : e.type;
  const info = diskEntryInfo(e);
  diskByType[key] ??= { count: 0, bytes: 0 };
  diskByType[key].count += 1;
  diskByType[key].bytes += info.bytes;
}

// Kept vs dropped estimate on final transcript:
// kept = wire full bytes; dropped-disk-metadata estimate = totalDisk - (text/tool bytes that survive)
// Compute surviving source bytes: user text + assistant text+thinking + tool args + tool outputs.
let survivingSourceChars = 0;
for (const e of leafEntries) {
  if (e.type !== "message") continue;
  const m = e.message;
  for (const b of m.content ?? []) {
    if (b.type === "text") survivingSourceChars += (b.text ?? "").length;
    if (b.type === "thinking") survivingSourceChars += (b.thinking ?? "").length;
    if (b.type === "toolCall") survivingSourceChars += JSON.stringify(b.arguments ?? {}).length + (b.name ?? "").length;
  }
  if (m.role === "toolResult") {
    for (const b of m.content ?? []) if (b.type === "text") survivingSourceChars += (b.text ?? "").length;
  }
}

// Spot checks: 3 samples (first assistant, a mid toolResult-heavy one, last assistant)
function spotCheck(assistantId) {
  const a = byId.get(assistantId);
  const proj = sm.buildSessionProjection(sessionEntries, a.parentId);
  const llm = llmOf(proj.messages);
  const wire = wireOf(llm);
  // How does THIS assistant replay in the next request?
  const projAfter = sm.buildSessionProjection(sessionEntries, assistantId);
  const llmAfter = llmOf(projAfter.messages);
  const wireAfter = wireOf(llmAfter);
  const newItems = wireAfter.slice(wire.length);
  return {
    assistantStoredKeys: Object.keys(a.message),
    contentTypes: (a.message.content ?? []).map((b) => b.type),
    hasThoughtSignature: (a.message.content ?? []).some((b) => b.thoughtSignature),
    wireReqItemsBefore: wire.length,
    replayedAs: newItems,
  };
}
const firstA = assistantEntries[0]?.id;
const lastA = assistantEntries[assistantEntries.length - 1]?.id;
const midA =
  assistantEntries[Math.floor(assistantEntries.length / 2)]?.id;
const spots = {};
if (firstA) spots.first = { id: firstA, ...spotCheck(firstA) };
if (midA) spots.mid = { id: midA, ...spotCheck(midA) };
if (lastA) spots.last = { id: lastA, ...spotCheck(lastA) };

// Persist machine-readable evidence to /tmp/session-maps (ephemeral, per constraints)
mkdirSync("/tmp/session-maps", { recursive: true });
const evidence = {
  sessionFile,
  sessionId: header?.id,
  piVersion: "1.0.2",
  model: openaiModel,
  totalDiskBytes,
  totalLines: rawLines.length,
  diskByType,
  turns: turns.map((t) => ({ ...t, diskAssistantLine: undefined })),
  wireFullItems: wireFull.length,
  wireFullBytes,
  cumWireSent,
  survivingSourceChars,
  spots: Object.fromEntries(
    Object.entries(spots).map(([k, v]) => [k, { ...v, replayedAs: v.replayedAs }]),
  ),
  callStack: [
    "session-manager.js: loadEntriesFromFile()",
    "session-manager.js: buildSessionProjection(entries, leafId) -> sessionEntryToContextMessages() per entry",
    "agent-session.js: AgentSession wires Agent.convertToLlm = messages.js convertToLlm()",
    "agent-loop.js (pi-agent-core): streamAssistantResponse() calls convertToLlm() then normalizeContext()",
    "pi-ai/utils/transcript.js: normalizeContext() folds systemPrompt+tools into leading system message; resolveTranscript() collapses mid-convo system for OpenAI",
    "pi-ai/api/transform-messages.js: transformMessages() (thinking->text cross-model, strip thoughtSignature, orphan tool-result synthesis)",
    "pi-ai/api/openai-responses-shared.js: convertResponsesMessages() -> POST https://api.openai.com/v1/responses",
  ],
};
writeFileSync(
  "/tmp/session-maps/evidence.json",
  JSON.stringify(evidence, null, 2),
);
writeFileSync(
  "/tmp/session-maps/wire-final.json",
  JSON.stringify(wireFull, null, 2),
);

const esc = (s) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const pretty = (v, max = 6000) => {
  let s = JSON.stringify(v, null, 2);
  if (s.length > max) s = s.slice(0, max) + `\n… [truncated ${s.length - max} chars]`;
  return esc(s);
};
const fmt = (n) => n.toLocaleString("en-US");

function phaseOf(turnIndex) {
  // user lines at file lines 5, 95, 161 -> assistant turns split
  const a = assistantEntries[turnIndex];
  const lineIdx = sessionEntries.findIndex((e) => e.id === a.id);
  if (lineIdx < 95) return "Phase 1 · process inbox";
  if (lineIdx < 161) return "Phase 2 · project hygiene";
  return "Phase 3 · Check comments";
}

let lastPhase = "";
let turnCards = "";
for (let i = 0; i < turns.length; i++) {
  const t = turns[i];
  const phase = phaseOf(i);
  if (phase !== lastPhase) {
    turnCards += `<div class="phase">${esc(phase)}</div>`;
    lastPhase = phase;
  }
  const a = byId.get(t.id);
  const toolNames = t.toolCalls.map((x) => esc(x.name)).join(", ") || "—";
  const pct = t.diskCumBefore > 0 ? Math.min(100, (t.wireReqBytes / t.diskCumBefore) * 100) : 0;
  turnCards += `
  <details class="turn" id="turn-${t.n}">
    <summary>
      <span class="tn">Turn ${t.n}</span>
      <span class="tid">${esc(t.id.slice(0, 8))}</span>
      <span class="tools">${toolNames}</span>
      <span class="nums">disk cum ${fmt(t.diskCumBefore)} B · wire req ${fmt(t.wireReqBytes)} B (${t.wireReqItems} items, +${t.wireDeltaCount})</span>
      <span class="bar"><span style="width:${pct.toFixed(1)}%"></span></span>
    </summary>
    <div class="ab">
      <div class="col disk">
        <h4>💾 A · On disk <span class="b">${fmt(t.diskAssistantBytes)} B this entry</span></h4>
        <div class="kv">role <b>assistant</b> · stop <b>${esc(String(t.stopReason))}</b> · model <b>${esc(String(t.model))}</b></div>
        <div class="kv">thinking chars <b>${fmt(t.thinkingChars)}</b> · text chars <b>${fmt(t.textChars)}</b> · tool calls <b>${t.toolCalls.length}</b></div>
        <div class="kv">usage <b>${t.usage ? `in ${fmt(t.usage.input ?? 0)} / out ${fmt(t.usage.output ?? 0)} / cacheRead ${fmt(t.usage.cacheRead ?? 0)}` : "—"}</b></div>
        <details><summary>Raw JSONL line (exact bytes on disk)</summary><pre>${pretty(JSON.parse(t.diskAssistantLine))}</pre></details>
        <div class="drop">Never sent: <code>timestamp</code>, <code>responseId</code>, <code>usage{input,output,cacheRead,cacheWrite,reasoning,totalTokens,cost}</code>, <code>provider/api/model</code>, <code>stopReason/rawStopReason</code>, <code>thoughtSignature</code> (provider sig stripped unless same provider+api+model), empty <code>text:""</code> blocks.</div>
      </div>
      <div class="col wire">
        <h4>🧠 B · LLM saw to produce it <span class="b">${fmt(t.wireReqBytes)} B · ${t.wireReqItems} items</span></h4>
        <div class="kv">Request = all prior transcript as OpenAI <b>Responses</b> items (<code>input_text</code> / <code>output_text</code> / <code>function_call</code> / <code>function_call_output</code>). +${t.wireDeltaCount} new items since turn ${t.n - 1}.</div>
        <div class="kv">Thinking blocks arrived as <b>plain assistant text</b> (<code>transformMessages</code> cross-model rule); toolCall <code>thoughtSignature</code> stripped; toolCall ids sanitised to <code>[A-Za-z0-9_-]{1,64}</code>.</div>
        <details><summary>New wire items in THIS request (+${t.wireDeltaCount}, ${fmt(t.wireDeltaBytes)} B) — the disk delta above, as the model saw it</summary><pre>${esc(t.wireDeltaPreview)}${t.wireDeltaTruncated ? "\n… [" + (t.wireDeltaCount - 3) + " more items — see full final payload §5]" : ""}</pre></details>
      </div>
    </div>
  </details>`;
}

const diskRows = Object.entries(diskByType)
  .sort((a, b) => b[1].bytes - a[1].bytes)
  .map(
    ([k, v]) =>
      `<tr><td><code>${esc(k)}</code></td><td>${v.count}</td><td>${fmt(v.bytes)} B</td><td>${((v.bytes / totalDiskBytes) * 100).toFixed(1)}%</td></tr>`,
  )
  .join("");

const html = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Session log ↔ LLM context · ${esc(header?.id ?? "")}</title>
<style>
:root{--bg:#0f1420;--panel:#182031;--line:#2a3550;--ink:#e8edf7;--mut:#9aa7c4;--a:#7fd6a4;--b:#8fb8ff;--warn:#ffcf7f}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:14px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
header{padding:22px 26px;border-bottom:1px solid var(--line);background:linear-gradient(180deg,#141c30,#0f1420)}
h1{font-size:20px;margin:0 0 6px}h2{font-size:16px;margin:26px 0 10px}h4{margin:0 0 8px;font-size:13px}
.sub{color:var(--mut);max-width:90ch}
.wrap{padding:18px 26px 80px;max-width:1200px;margin:0 auto}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:10px;margin:14px 0}
.card{background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:12px}
.card b{font-size:18px}.card span{color:var(--mut);font-size:12px}
table{border-collapse:collapse;width:100%;background:var(--panel);border-radius:10px;overflow:hidden}
td,th{border-bottom:1px solid var(--line);padding:6px 10px;text-align:left;font-size:13px}th{color:var(--mut);font-weight:600}
code{background:#0b1120;padding:1px 5px;border-radius:5px;font-size:12px}
pre{background:#0b1120;border:1px solid var(--line);border-radius:8px;padding:10px;overflow:auto;max-height:420px;font-size:12px}
details.turn{background:var(--panel);border:1px solid var(--line);border-radius:10px;margin:8px 0}
details.turn>summary{cursor:pointer;padding:9px 12px;display:flex;gap:10px;align-items:center;flex-wrap:wrap;list-style:none}
details.turn>summary::-webkit-details-marker{display:none}
.tn{font-weight:700}.tid{color:var(--mut)}.tools{color:var(--b)}.nums{margin-left:auto;color:var(--mut);font-size:12px}
.bar{flex-basis:100%;height:6px;background:#0b1120;border-radius:4px;overflow:hidden}.bar>span{display:block;height:100%;background:linear-gradient(90deg,var(--b),var(--a))}
.phase{position:sticky;top:0;background:#0f1420;padding:8px 2px;font-weight:700;color:var(--warn);z-index:1}
.ab{display:grid;grid-template-columns:1fr 1fr;gap:10px;padding:0 12px 12px}@media(max-width:900px){.ab{grid-template-columns:1fr}}
.col{border:1px solid var(--line);border-radius:8px;padding:10px}.disk{border-left:4px solid var(--a)}.wire{border-left:4px solid var(--b)}
.b{color:var(--mut);font-weight:400}.kv{font-size:12px;color:var(--mut);margin:4px 0}.kv b{color:var(--ink)}
.drop{font-size:12px;color:var(--mut);margin-top:6px}
.stack{background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:12px}.stack li{margin:4px 0;font-size:13px}
.note{background:#231d0e;border:1px solid #6b5518;border-radius:10px;padding:10px 12px;margin:12px 0;font-size:13px}
a{color:var(--b)}
</style></head><body>
<header><h1>💾 ↔ 🧠 Session log vs LLM context — turn-by-turn A/B</h1>
<div class="sub">Session <code>${esc(header?.id ?? "")}</code> · ${esc(header?.cwd ?? "")} · ${rawLines.length} lines · model(s) in file: <b>${esc(fileModelsLabel)}</b> · emulated wire: <b>openai/gpt-4.1</b> (<code>openai-responses</code> → <code>POST https://api.openai.com/v1/responses</code>) · pi v1.0.2 · All mappings computed by importing pi's shipped functions (no reimplementation). Runtime prompt deltas + tool schemas beyond any persisted system lines are rebuilt at runtime and therefore <b>excluded</b> from wire byte counts below (real requests are larger).</div></header>
<div class="wrap">
<h2>0 · Headline proportions</h2>
<div class="cards">
<div class="card"><b>${fmt(totalDiskBytes)} B</b><br><span>on disk (file, incl. newlines)</span></div>
<div class="card"><b>${fmt(wireFullBytes)} B</b><br><span>final transcript as OpenAI Responses items (no system prompt/tools)</span></div>
<div class="card"><b>${fmt(cumWireSent)} B</b><br><span>sum of all ${turns.length} request bodies (resent every turn) ≈ ${(cumWireSent / totalDiskBytes).toFixed(1)}× disk</span></div>
<div class="card"><b>${((wireFullBytes / totalDiskBytes) * 100).toFixed(1)}%</b><br><span>final wire / disk byte ratio (transcript only)</span></div>
<div class="card"><b>${turns.length} calls</b><br><span>one LLM request per assistant message; ${nUser} user msgs; ${nTR} toolResults; ${nSys} system lines on disk</span></div>
</div>
<div class="note"><b>Why wire &lt; disk here, yet bills more:</b> per request the model sees only text/tool-call/tool-output strings (metadata stripped), so the <i>final</i> context (${fmt(wireFullBytes)} B) is smaller than the whole file (${fmt(totalDiskBytes)} B, which accumulates ${turns.length} responses' metadata). But the API <i>resends</i> the growing transcript on every one of the ${turns.length} calls, totalling ${fmt(cumWireSent)} B across the wire — the number that actually drives cost/latency. The runtime <b>system prompt + tool definitions</b> (absent from disk) are prepended to <i>every</i> request on top of these counts.</div>
<h2>1 · What's on disk (by entry type)</h2>
<table><tr><th>entry</th><th>count</th><th>bytes</th><th>share</th></tr>${diskRows}</table>
<h2>2 · Call stack actually executed (imports used by the generator)</h2>
<ol class="stack">
<li><code>pi-coding-agent/dist/core/session-manager.js</code> :: <b>loadEntriesFromFile()</b> → <b>buildSessionProjection(entries, leafId)</b> → <b>sessionEntryToContextMessages()</b> — leaf-path + compaction/context-edit aware projection. Non-message entries (<code>model_change</code>, <code>thinking_level_change</code>, <code>custom:background-tasks-state</code>) project to <b>zero</b> messages.</li>
<li><code>pi-coding-agent/dist/core/messages.js</code> :: <b>convertToLlm()</b> — AgentMessage[] → LLM Message[] (identity for user/assistant/toolResult here; custom/compaction/branch rewrites only if present — none in this session).</li>
<li><code>pi-agent-core/dist/agent-loop.js</code> :: <b>streamAssistantResponse()</b> — calls <code>convertToLlm()</code>, then <code>normalizeContext()</code>, then provider <code>stream(model, llmContext)</code>. Turn loop: assistant → execute tools → toolResult → next request.</li>
<li><code>pi-ai/dist/utils/transcript.js</code> :: <b>normalizeContext()</b> (folds runtime systemPrompt+tools into leading system msg) → <b>resolveTranscript(ctx, false)</b> collapses mid-convo system for OpenAI.</li>
<li><code>pi-ai/dist/api/transform-messages.js</code> :: <b>transformMessages(msgs, gpt-4.1, normalizeId)</b> — cross-provider rules that fired here: thinking→text, strip <code>thoughtSignature</code>, sanitise tool ids, synthesise <code>"No result provided"</code> for orphans, drop <code>stopReason:error/aborted</code>.</li>
<li><code>pi-ai/dist/api/openai-responses-shared.js</code> :: <b>convertResponsesMessages(model, ctx, {openai,openai-codex,opencode}, {supportsMidConvoSystemMessages:false})</b> — user→<code>input_text</code>, text→<code>output_text</code>, toolCall→<code>function_call</code>, toolResult→<code>function_call_output</code>. Then <code>buildParams()</code> adds tools/instructions → <code>POST /v1/responses</code>.</li>
</ol>
<h2>3 · Field-level keep / drop (OpenAI Responses, cross-model Gemini → GPT-4.1)</h2>
<table><tr><th>stored on disk</th><th>sent?</th><th>how</th></tr>
<tr><td><code>user.content[].text</code></td><td>✅</td><td><code>input_text</code>, surrogate-sanitised; empty texts dropped</td></tr>
<tr><td><code>assistant.content thinking</code></td><td>✅ as text</td><td>no OpenAI reasoning passthrough (source sig isn't same-model Responses reasoning) → plain <code>output_text</code> via transformMessages</td></tr>
<tr><td><code>assistant.content text (non-empty)</code></td><td>✅</td><td><code>output_text</code></td></tr>
<tr><td><code>assistant.content text ""</code></td><td>➖</td><td>empty assistant text still emits an (empty) message item in Responses path; Completions path would drop it</td></tr>
<tr><td><code>toolCall {id,name,arguments}</code></td><td>✅</td><td><code>function_call{call_id,name,arguments:JSON}</code>; id sanitised ≤64ch; <code>thoughtSignature</code> deleted</td></tr>
<tr><td><code>toolResult.content text</code></td><td>✅</td><td><code>function_call_output{call_id,output:string}</code>; images→input_image only if model takes images</td></tr>
<tr><td><code>timestamp, responseId, provider/api/model, stopReason/rawStopReason, usage{…}, cost, isError, toolName(on output)</code></td><td>❌</td><td>pi-only bookkeeping; <code>isError</code> not encoded in output string</td></tr>
<tr><td><code>model_change / thinking_level_change / custom(state)</code></td><td>❌</td><td>project to zero messages (settings/state, not context)</td></tr>
<tr><td>system prompt + tool schemas</td><td>✅ but <b>absent from disk</b></td><td>rebuilt by <code>AgentSession._rebuildSystemPrompt/_preparePromptAndToolLoadout</code> from skills/context-files/tools each run</td></tr>
</table>
<h2>4 · Turn-by-turn A/B (click to expand; left = stored bytes, right = what the LLM was shown)</h2>
${turnCards}
<h2>5 · Full final wire payload (transcript-only, last turn)</h2>
<details><summary>Show ${fmt(wireFullBytes)} B · ${wireFull.length} Responses items (also saved to <code>/tmp/session-maps/wire-final.json</code>)</summary><pre>${pretty(wireFull, 60000)}</pre></details>
<h2>6 · Spot checks (pi-computed, not hand-claimed)</h2>
<div class="note">Each check replays the stored assistant <b>alone</b> (prefix ending at the assistant, without its tool result) through the same pi functions — so <code>transformMessages</code> correctly synthesises a <code>"No result provided"</code> tool-result for the orphaned call (see <code>first.replayedAs[3]</code>). Real next-turn requests carry the actual tool result instead; the synthesis only fires for genuinely unresolved calls.</div>
<details open><summary>First / middle / last assistant replay</summary><pre>${pretty(spots, 20000)}</pre></details>
<h2>7 · Re-run on any session</h2>
<div class="note">Generator lives next to this HTML (<code>generate.mjs</code>) and only imports pi's shipped <code>dist</code> files — no copied logic. Re-run: <code>node generate.mjs /path/to/session.jsonl</code>. Evidence JSON: <code>/tmp/session-maps/evidence.json</code>.</div>
</div></body></html>`;

const outName = `session-map-${(header?.id ?? "session").slice(0, 8)}.html`;
writeFileSync(outName, html);
console.log(`wrote ${outName} (${Buffer.byteLength(html, "utf8")} bytes)`);
console.log(`disk=${totalDiskBytes} wireFinal=${wireFullBytes} cumWire=${cumWireSent} turns=${turns.length}`);
