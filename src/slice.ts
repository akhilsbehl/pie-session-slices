/**
 * pie-session-slices — slice core.
 *
 * Persistence-first design: turns are captured live in order and stored in
 * DuckDB (see store.ts). This module builds slice data either from live
 * session-manager entries or from a session JSONL file (fallback for old
 * sessions + write-through cache seeding).
 *
 * Pipeline per projected entry (preserves sourceEntryId attribution):
 *   buildSessionProjection() → per-pair convertToLlm() → text extraction.
 * If convertToLlm throws, falls back to projection-only with the same explicit
 * strip list, and marks pipeline: "projection-only".
 *
 * Strip contract (applies in BOTH paths):
 *   keep: user text, assistant visible text.
 *   extract: subagent task/steer prompts (toolCall blocks), subagent results
 *     (subagent-notify envelopes), tool result text (verbatim, separate table).
 *   drop: thinking, images, toolCall blocks (except subagent task/steer),
 *     system messages, compaction/branch summaries, model/thinking-level
 *     changes, usage, labels, custom state, subagent/bg-task control notices,
 *     timestamps/ids/models/tokens metadata.
 */
import {
  buildContextEntries,
  convertToLlm,
  getAgentDir,
  sessionEntryToContextMessages,
} from "@earendil-works/pi-coding-agent";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

export type SliceKind =
  | "user"
  | "assistant-text"
  | "subagent_task"
  | "subagent_result"
  | "subagent_steer";

export interface SliceRecord {
  sourceEntryId: string;
  turnId: string;
  kind: SliceKind;
  payload: string;
}

export interface ToolResultRow {
  turnId: string;
  seq: number;
  toolName: string;
  callId: string;
  text: string;
  isError: boolean;
}

export interface TurnData {
  turnId: string;
  turnIdx: number;
  records: SliceRecord[];
  toolResults: ToolResultRow[];
}

export type SliceSelector =
  | { type: "full" }
  | { type: "last"; n: number }
  | { type: "first"; n: number }
  | { type: "range"; start: number; end: number };

export interface SliceData {
  sessionId: string;
  pipeline: "wire" | "projection-only";
  /** Which projector produced the pairs (honest fallback reporting). */
  projector: "buildSessionProjection" | "contextEntries-fallback";
  turns: TurnData[];
}

type ProjectedPair = {
  sourceEntry: Record<string, unknown>;
  messages: Array<Record<string, unknown>>;
};

type BuildSessionProjectionFn = (
  entries: unknown,
  leafId?: string | null,
  byId?: Map<string, unknown>,
) => { entries: ProjectedPair[] };

let projectorCache: { fn: BuildSessionProjectionFn; name: SliceData["projector"] } | null = null;

/**
 * Resolve the active-branch projector for the running Pi install.
 * 1. Root export (Pi >= 1.0: buildSessionProjection).
 * 2. Install-dir dist file (same symbol, file-based).
 * 3. buildContextEntries + sessionEntryToContextMessages emulation (older Pi).
 */
async function resolveProjector(): Promise<{ fn: BuildSessionProjectionFn; name: SliceData["projector"] }> {
  if (projectorCache) return projectorCache;
  try {
    const root = (await import("@earendil-works/pi-coding-agent")) as Record<string, unknown>;
    if (typeof root["buildSessionProjection"] === "function") {
      projectorCache = {
        fn: root["buildSessionProjection"] as BuildSessionProjectionFn,
        name: "buildSessionProjection",
      };
      return projectorCache;
    }
  } catch {
    // Fall through.
  }
  try {
    const candidates: string[] = [
      join(
        getAgentDir(),
        "npm",
        "node_modules",
        "@earendil-works/pi-coding-agent",
        "dist",
        "core",
        "session-manager.js",
      ),
    ];
    try {
      const { readdirSync } = await import("node:fs");
      const releases = join(getAgentDir(), "install", "releases");
      for (const release of readdirSync(releases).sort().reverse()) {
        candidates.push(
          join(
            releases,
            release,
            "node_modules",
            "@earendil-works/pi-coding-agent",
            "dist",
            "core",
            "session-manager.js",
          ),
        );
      }
    } catch {
      // No releases dir: keep the default candidate only.
    }
    for (const distFile of candidates) {
      try {
        const mod = (await import(pathToFileURL(distFile).href)) as Record<string, unknown>;
        if (typeof mod["buildSessionProjection"] === "function") {
          projectorCache = {
            fn: mod["buildSessionProjection"] as BuildSessionProjectionFn,
            name: "buildSessionProjection",
          };
          return projectorCache;
        }
      } catch {
        // Try the next candidate.
      }
    }
  } catch {
    // Fall through to emulation.
  }
  const emulate: BuildSessionProjectionFn = (entries) => ({
    entries: (
      buildContextEntries as unknown as (
        e: Array<Record<string, unknown>>,
        leafId?: string | null,
      ) => Array<Record<string, unknown>>
    )(entries as Array<Record<string, unknown>>).map((sourceEntry) => ({
      sourceEntry,
      messages: (sessionEntryToContextMessages as unknown as (
        e: Record<string, unknown>,
      ) => Array<Record<string, unknown>>)(sourceEntry),
    })),
  });
  // Note: emulation ignores the leafId third-arg index form; buildContextEntries
  // accepts (entries, leafId) which is sufficient for the active-branch path.
  projectorCache = { fn: emulate, name: "contextEntries-fallback" };
  return projectorCache;
}

/** Join text blocks from a message content field (string or content array). */
function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  const parts: string[] = [];
  for (const block of content) {
    if (block && typeof block === "object") {
      const b = block as Record<string, unknown>;
      if (b["type"] === "text" && typeof b["text"] === "string") parts.push(b["text"] as string);
    }
  }
  return parts.join("\n");
}

/** Raw toolCall blocks from a message content array. */
function toolCallsOf(content: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(content)) return [];
  return content.filter(
    (b): b is Record<string, unknown> =>
      !!b && typeof b === "object" && (b as Record<string, unknown>)["type"] === "toolCall",
  ) as Array<Record<string, unknown>>;
}

const TEXT_ARGS = new Set(["task", "message", "prompt", "text"]);

/**
 * Observed-behavior subagent extraction (see findings E5). Deliberately narrow:
 * unknown envelopes are dropped, never guessed.
 */
function extractSubagent(
  sourceEntry: Record<string, unknown>,
  turnId: string,
): Array<{ kind: SliceKind; payload: string }> {
  const out: Array<{ kind: SliceKind; payload: string }> = [];
  const entryType = sourceEntry["type"];

  if (entryType === "message") {
    const msg = sourceEntry["message"] as Record<string, unknown> | undefined;
    if (msg?.["role"] === "assistant") {
      for (const call of toolCallsOf(msg["content"])) {
        if (call["name"] !== "subagent") continue;
        const args = (call["arguments"] ?? {}) as Record<string, unknown>;
        const action = typeof args["action"] === "string" ? (args["action"] as string) : undefined;
        if (action === "steer" || action === "follow_up") {
          const text = [args["message"], args["task"], args["prompt"]]
            .filter((v): v is string => typeof v === "string" && v.trim().length > 0)
            .join("\n");
          if (text.trim()) out.push({ kind: "subagent_steer", payload: text.trim() });
          continue;
        }
        if (!action) {
          const task = args["task"];
          if (typeof task === "string" && task.trim()) {
            out.push({ kind: "subagent_task", payload: task.trim() });
          }
        }
        // Any other subagent action (list/status/wait) is control: dropped.
      }
    }
  }

  if (entryType === "custom_message") {
    const customType = sourceEntry["customType"];
    const content = sourceEntry["content"];
    const text = textOf(content);
    if (customType === "subagent-notify" && text.trim()) {
      // Strip the "Background task completed|failed: **agent** agent:" envelope.
      const stripped = text
        .replace(
          /^(Background task|Detached foreground task) (completed|failed|paused|stopped):\s*\*\*([^*]+)\*\*\s*\3:\s*/,
          "",
        )
        .trim();
      if (stripped) out.push({ kind: "subagent_result", payload: stripped });
    } else if (
      (customType === "subagent_supervisor_request" ||
        customType === "subagent-supervisor-request" ||
        customType === "subagent_steering_notice" ||
        customType === "subagent-steering-notice") &&
      text.trim()
    ) {
      out.push({ kind: "subagent_steer", payload: text.trim() });
    }
    // All other custom types (bg-task-notification, control notices, etc.): dropped.
  }

  return out.map((r) => ({ ...r, turnId } as { kind: SliceKind; payload: string } & { turnId: string })) as Array<{
    kind: SliceKind;
    payload: string;
  }>;
}

/** Verbatim tool result text rows from a toolResult message entry. */
function extractToolResults(
  sourceEntry: Record<string, unknown>,
  turnId: string,
  seqStart: number,
): ToolResultRow[] {
  if (sourceEntry["type"] !== "message") return [];
  const msg = sourceEntry["message"] as Record<string, unknown> | undefined;
  if (msg?.["role"] !== "toolResult") return [];
  const text = textOf(msg["content"]);
  if (!text.trim()) return [];
  const details = (msg["details"] ?? {}) as Record<string, unknown>;
  return [
    {
      turnId,
      seq: seqStart,
      toolName: typeof msg["toolName"] === "string" ? (msg["toolName"] as string) : "unknown",
      callId: typeof details["callId"] === "string" ? (details["callId"] as string) : "",
      text,
      isError: details["isError"] === true,
    },
  ];
}

/** Extract user/assistant visible text from wire (convertToLlm) messages. */
function wireText(msgs: Array<Record<string, unknown>>): Array<{ role: string; text: string }> {
  const out: Array<{ role: string; text: string }> = [];
  for (const m of msgs) {
    const role = m["role"];
    if (role !== "user" && role !== "assistant") continue;
    const text = textOf(m["content"]);
    if (text.trim()) out.push({ role: role as string, text });
  }
  return out;
}

/** Manual strip of per-entry AgentMessages (projection-only fallback). */
function manualText(
  pairMessages: Array<Record<string, unknown>>,
): Array<{ role: string; text: string }> {
  const out: Array<{ role: string; text: string }> = [];
  for (const m of pairMessages) {
    const role = m["role"];
    if (role !== "user" && role !== "assistant") continue;
    if (role === "assistant") {
      // Assistant: visible text blocks only; toolCall/thinking/image blocks dropped.
      const content = m["content"];
      const text = Array.isArray(content)
        ? (content as Array<Record<string, unknown>>)
            .filter((b) => b?.["type"] === "text" && typeof b["text"] === "string")
            .map((b) => b["text"] as string)
            .join("\n")
        : typeof content === "string"
          ? content
          : "";
      if (text.trim()) out.push({ role: "assistant", text });
    } else {
      const text = textOf(m["content"]);
      if (text.trim()) out.push({ role: "user", text });
    }
  }
  return out;
}

export async function buildSliceData(
  entries: Array<Record<string, unknown>>,
  opts: { sessionId: string; leafId?: string | null },
): Promise<SliceData> {
  const { fn: project, name: projector } = await resolveProjector();
  // NB: leafId must stay undefined (not null) when unknown: the real
  // buildSessionProjection treats null as an empty path but undefined as
  // "last entry", which is what file-based reads want.
  const projection = project(entries, opts.leafId ?? undefined) as unknown as {
    entries: Array<{ sourceEntry: Record<string, unknown>; messages: Array<Record<string, unknown>> }>;
  };

  // Detect whether the wire stage works in this install (addresses plan rvw_004).
  let wireOk = true;
  try {
    const flat = projection.entries.flatMap((p) => p.messages);
    convertToLlm(flat as unknown as Parameters<typeof convertToLlm>[0]);
  } catch {
    wireOk = false;
  }
  const pipeline: SliceData["pipeline"] = wireOk ? "wire" : "projection-only";

  const turns: TurnData[] = [];
  let turnIdx = 0;
  let current: TurnData | null = null;

  const newTurn = (): TurnData => {
    turnIdx += 1;
    const turnId = `t${String(turnIdx).padStart(4, "0")}`;
    const turn: TurnData = { turnId, turnIdx, records: [], toolResults: [] };
    turns.push(turn);
    return turn;
  };

  for (const pair of projection.entries) {
    const sourceEntry = pair.sourceEntry;
    const sourceEntryId =
      typeof sourceEntry["id"] === "string" ? (sourceEntry["id"] as string) : "unknown";

    // Per-pair wire conversion preserves sourceEntryId attribution. On failure,
    // the same explicit strip list applies (plan rev-2 rvw_001 resolution).
    let texts: Array<{ role: string; text: string }>;
    if (wireOk) {
      try {
        const llm = convertToLlm(
          pair.messages as unknown as Parameters<typeof convertToLlm>[0],
        ) as unknown as Array<Record<string, unknown>>;
        texts = wireText(llm);
      } catch {
        texts = manualText(pair.messages);
      }
    } else {
      texts = manualText(pair.messages);
    }

    for (const t of texts) {
      if (t.role === "user") {
        current = newTurn();
        current.records.push({
          sourceEntryId,
          turnId: current.turnId,
          kind: "user",
          payload: t.text,
        });
      } else {
        current ??= newTurn();
        current.records.push({
          sourceEntryId,
          turnId: current.turnId,
          kind: "assistant-text",
          payload: t.text,
        });
      }
    }

    // Subagent task/steer/result extraction from the raw source entry.
    current ??= newTurn();
    for (const s of extractSubagent(sourceEntry, current.turnId)) {
      current.records.push({ sourceEntryId, turnId: current.turnId, ...s });
    }

    // Tool results: verbatim, separate rows (plan rev-2 rvw_003 resolution).
    for (const row of extractToolResults(sourceEntry, current.turnId, current.toolResults.length)) {
      current.toolResults.push(row);
    }
  }

  // Drop empty turns (control-only stretches with no kept content).
  const kept = turns.filter((t) => t.records.length > 0 || t.toolResults.length > 0);
  kept.forEach((t, i) => {
    const newId = `t${String(i + 1).padStart(4, "0")}`;
    if (newId !== t.turnId) {
      t.turnId = newId;
      t.turnIdx = i + 1;
      for (const r of t.records) r.turnId = newId;
      for (const r of t.toolResults) r.turnId = newId;
    }
  });

  return { sessionId: opts.sessionId, pipeline, projector, turns: kept };
}

export function selectTurns(turns: TurnData[], selector: SliceSelector): TurnData[] {
  switch (selector.type) {
    case "full":
      return turns;
    case "last":
      return turns.slice(Math.max(0, turns.length - selector.n));
    case "first":
      return turns.slice(0, selector.n);
    case "range": {
      const start = Math.max(1, selector.start);
      const end = Math.min(turns.length, selector.end);
      if (end < start) return [];
      return turns.slice(start - 1, end);
    }
  }
}

/** Serialize selected turns to JSONL lines (tool results joined iff requested). */
export function toJsonLines(turns: TurnData[], includeToolResults: boolean): string[] {
  const lines: string[] = [];
  for (const t of turns) {
    for (const r of t.records) lines.push(JSON.stringify(r));
    if (includeToolResults) {
      for (const tr of t.toolResults) {
        lines.push(
          JSON.stringify({
            sourceEntryId: `${tr.callId || tr.toolName}:${tr.seq}`,
            turnId: tr.turnId,
            kind: "toolResult",
            payload: tr.text,
            toolName: tr.toolName,
            isError: tr.isError,
          }),
        );
      }
    }
  }
  return lines;
}
