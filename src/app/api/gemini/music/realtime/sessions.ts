import type { LiveMusicSession } from "@google/genai";

/**
 * 再生中の Lyria RealTime セッションをプロセス内で保持する。
 * シングルインスタンス環境（開発・デモ）向けのインメモリストア。
 */
type SessionEntry = {
  session: LiveMusicSession;
  /** 最後に適用した BPM（全体 config 再送信のために保持） */
  bpm: number | undefined;
};

export const activeSessions = new Map<string, SessionEntry>();
