import { ExtensionAPI } from "@earendil-works/pi-coding-agent";
//#region src/slice.d.ts
type SliceKind = "user" | "assistant-text" | "subagent_task" | "subagent_result" | "subagent_steer";
interface SliceRecord {
  sourceEntryId: string;
  turnId: string;
  kind: SliceKind;
  payload: string;
}
interface ToolResultRow {
  turnId: string;
  seq: number;
  toolName: string;
  callId: string;
  text: string;
  isError: boolean;
}
interface TurnData {
  turnId: string;
  turnIdx: number;
  records: SliceRecord[];
  toolResults: ToolResultRow[];
}
type SliceSelector = {
  type: "full";
} | {
  type: "last";
  n: number;
} | {
  type: "first";
  n: number;
} | {
  type: "range";
  start: number;
  end: number;
};
interface SliceData {
  sessionId: string;
  pipeline: "wire" | "projection-only";
  /** Which projector produced the pairs (honest fallback reporting). */
  projector: "buildSessionProjection" | "contextEntries-fallback";
  turns: TurnData[];
}
//#endregion
//#region src/index.d.ts
type SessionManagerLike = {
  getSessionId(): string;
  getSessionFile(): string | undefined;
  getLeafId(): string | null | undefined;
  getEntries(): Array<Record<string, unknown>>;
};
interface SliceOutcome {
  path: string;
  sessionId: string;
  turns: number;
  records: number;
  includeToolResults: boolean;
  pipeline: SliceData["pipeline"];
  projector: SliceData["projector"] | "db";
  source: "db" | "computed";
}
declare function runSlice(opts: {
  selector: SliceSelector;
  includeToolResults: boolean;
  sessionFile?: string;
  manager?: SessionManagerLike;
}): Promise<SliceOutcome>;
declare function pieSessionSlices(pi: ExtensionAPI): void;
//#endregion
export { SliceOutcome, pieSessionSlices as default, runSlice };