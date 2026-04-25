"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type RealtimeStatus =
  | "idle"
  | "connecting"
  | "playing"
  | "stopping"
  | "error";

type SseEvent = {
  status?: string;
  sessionId?: string;
  audioChunk?: string;
  done?: boolean;
  error?: string;
};

// 更新フィードバックの種類
type UpdateFeedback = "prompt" | "bpm" | null;

const REALTIME_PRESETS = [
  {
    label: "Techno",
    prompt:
      "Minimal techno with deep bass, sparse percussion, and atmospheric synths",
    bpm: 130,
  },
  {
    label: "Ambient",
    prompt:
      "Peaceful ambient music with soft pads, gentle arpeggios, and flowing textures",
    bpm: 70,
  },
  {
    label: "Funk",
    prompt:
      "Funky groove with slap bass, wah guitar, tight snare, and horn stabs",
    bpm: 100,
  },
  {
    label: "Jazz",
    prompt:
      "Late night jazz trio with walking double bass, brushed drums, and mellow piano chords",
    bpm: 120,
  },
];

/**
 * 16bit signed PCM ステレオ (48kHz) を Web Audio API でスケジューリング再生する。
 * 前のチャンクの終了時刻に続けて再生することでシームレスな音声を実現する。
 */
function scheduleAudioChunk(
  base64: string,
  ctx: AudioContext,
  nextPlayTimeRef: React.MutableRefObject<number>,
) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }

  // 16bit signed PCM → Float32 に変換（ステレオ: L/R 交互）
  const int16 = new Int16Array(bytes.buffer);
  const frameCount = int16.length / 2; // 2チャンネル

  const audioBuffer = ctx.createBuffer(2, frameCount, 48000);
  const left = audioBuffer.getChannelData(0);
  const right = audioBuffer.getChannelData(1);

  for (let i = 0; i < frameCount; i++) {
    left[i] = int16[i * 2] / 32768;
    right[i] = int16[i * 2 + 1] / 32768;
  }

  const source = ctx.createBufferSource();
  source.buffer = audioBuffer;
  source.connect(ctx.destination);

  // 100ms 先行バッファでネットワークジッターを吸収する
  const now = ctx.currentTime;
  if (nextPlayTimeRef.current < now + 0.1) {
    nextPlayTimeRef.current = now + 0.1;
  }
  source.start(nextPlayTimeRef.current);
  nextPlayTimeRef.current += audioBuffer.duration;
}

export function RealtimeMusicPanel() {
  const [status, setStatus] = useState<RealtimeStatus>("idle");
  const [prompt, setPrompt] = useState(REALTIME_PRESETS[0].prompt);
  const [bpm, setBpm] = useState(REALTIME_PRESETS[0].bpm);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [updateFeedback, setUpdateFeedback] = useState<UpdateFeedback>(null);

  const abortRef = useRef<AbortController | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const nextPlayTimeRef = useRef<number>(0);
  // 開始時のパラメータ — 初回不要なデバウンス更新をスキップするために使用
  const initialParamsRef = useRef<{ prompt: string; bpm: number } | null>(null);

  // アンマウント時にリソースを解放
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      audioCtxRef.current?.close().catch(() => {});
    };
  }, []);

  // ---- ライブ更新: プロンプト (800ms デバウンス) ----
  useEffect(() => {
    if (status !== "playing" || !sessionId) return;
    // 開始時と同じプロンプトなら送信不要
    if (initialParamsRef.current?.prompt === prompt) return;

    const timer = setTimeout(async () => {
      try {
        await fetch("/api/gemini/music/realtime", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionId, prompt }),
        });
        setUpdateFeedback("prompt");
        setTimeout(() => setUpdateFeedback(null), 2000);
      } catch {
        // サイレント — ストリームが生きていれば次の変更で再試行できる
      }
    }, 800);

    return () => clearTimeout(timer);
  }, [prompt, sessionId, status]);

  // ---- ライブ更新: BPM (1200ms デバウンス + resetContext) ----
  useEffect(() => {
    if (status !== "playing" || !sessionId) return;
    if (initialParamsRef.current?.bpm === bpm) return;

    const timer = setTimeout(async () => {
      try {
        await fetch("/api/gemini/music/realtime", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionId, bpm }),
        });
        setUpdateFeedback("bpm");
        setTimeout(() => setUpdateFeedback(null), 2500);
      } catch {
        // サイレント
      }
    }, 1200);

    return () => clearTimeout(timer);
  }, [bpm, sessionId, status]);

  const handleStart = useCallback(async () => {
    setStatus("connecting");
    setErrorMsg(null);
    setSessionId(null);
    setUpdateFeedback(null);
    initialParamsRef.current = { prompt, bpm };

    const abort = new AbortController();
    abortRef.current = abort;

    // AudioContext はユーザー操作（クリック）のタイミングで生成する
    const ctx = new AudioContext({ sampleRate: 48000 });
    audioCtxRef.current = ctx;
    nextPlayTimeRef.current = 0;

    try {
      const response = await fetch("/api/gemini/music/realtime", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt, bpm }),
        signal: abort.signal,
      });

      if (!response.ok || !response.body) {
        const err = await response.json().catch(() => ({})) as { error?: string };
        throw new Error(err.error ?? "Lyria RealTime への接続に失敗しました。");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let sseBuffer = "";

      // SSE イベントをストリーミングで読み込む
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        sseBuffer += decoder.decode(value, { stream: true });

        // SSE イベントは "\n\n" で区切られる
        const parts = sseBuffer.split("\n\n");
        sseBuffer = parts.pop() ?? "";

        for (const part of parts) {
          if (!part.startsWith("data: ")) continue;
          const data = JSON.parse(part.slice(6)) as SseEvent;

          if (data.status === "playing") {
            setStatus("playing");
            if (data.sessionId) setSessionId(data.sessionId);
          } else if (data.audioChunk) {
            scheduleAudioChunk(data.audioChunk, ctx, nextPlayTimeRef);
          } else if (data.done) {
            break;
          } else if (data.error) {
            throw new Error(data.error);
          }
        }
      }

      setStatus("idle");
      setSessionId(null);
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        setStatus("idle");
        setSessionId(null);
      } else {
        setErrorMsg(error instanceof Error ? error.message : "Unknown error");
        setStatus("error");
      }
    } finally {
      await ctx.close().catch(() => {});
      audioCtxRef.current = null;
    }
  }, [prompt, bpm]);

  const handleStop = useCallback(() => {
    setStatus("stopping");
    abortRef.current?.abort();
  }, []);

  const isActive = status === "connecting" || status === "playing";

  return (
    <section className="rounded-4xl border border-teal-300/20 bg-[#071414]/80 p-8 backdrop-blur">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm uppercase tracking-[0.35em] text-teal-200/80">
            Lyria RealTime
          </p>
          <h2 className="mt-2 text-2xl font-medium text-white">
            リアルタイム音楽生成
          </h2>
        </div>

        {/* ステータスインジケーター */}
        <div className="flex items-center gap-2">
          <span className="text-xs text-stone-400">
            {status === "connecting"
              ? "接続中..."
              : status === "playing"
                ? "Streaming"
                : status === "stopping"
                  ? "停止中..."
                  : status === "error"
                    ? "エラー"
                    : "待機中"}
          </span>
          <span
            className={[
              "h-3 w-3 rounded-full transition-all duration-300",
              status === "playing"
                ? "bg-teal-400 shadow-[0_0_10px_var(--color-teal-400)] animate-pulse"
                : status === "connecting"
                  ? "bg-amber-400 animate-pulse"
                  : status === "error"
                    ? "bg-red-400"
                    : "bg-stone-600",
            ].join(" ")}
          />
        </div>
      </div>

      <p className="mt-3 text-sm leading-6 text-stone-400">
        WebSocket ストリーミングでリアルタイムに音楽を生成します。PCM
        チャンクを Web Audio API で直接再生するため、待ち時間なしで音が出ます。
        モデル:{" "}
        <code className="rounded px-1 py-0.5 text-teal-300 bg-teal-950/50">
          lyria-realtime-exp
        </code>
      </p>

      {/* プリセット */}
      <div className="mt-6 grid gap-3">
        <p className="text-sm text-stone-300">
          Presets
          {status === "playing" && (
            <span className="ml-2 text-xs text-teal-400/70">
              再生中でも選択すると即時反映されます
            </span>
          )}
        </p>
        <div className="flex flex-wrap gap-2">
          {REALTIME_PRESETS.map((preset) => (
            <button
              key={preset.label}
              type="button"
              onClick={() => {
                setPrompt(preset.prompt);
                setBpm(preset.bpm);
              }}
              className="rounded-full border border-teal-300/20 bg-teal-500/10 px-4 py-2 text-sm text-teal-100 transition hover:border-teal-300/50 hover:bg-teal-500/20 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {preset.label}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-5 grid gap-5 md:grid-cols-[1fr_auto]">
        {/* プロンプト */}
        <label className="grid gap-2 md:col-span-2">
          <span className="flex items-center justify-between text-sm text-stone-300">
            Prompt
            {updateFeedback === "prompt" && (
              <span className="text-xs text-teal-400 transition-opacity animate-pulse">
                ✓ プロンプト更新済み
              </span>
            )}
            {status === "playing" && updateFeedback !== "prompt" && (
              <span className="text-xs text-stone-500">変更後 0.8秒で自動更新</span>
            )}
          </span>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={3}
            className={[
              "rounded-3xl border bg-white/5 px-5 py-4 text-sm text-white outline-none transition placeholder:text-stone-500",
              status === "playing"
                ? "border-teal-300/30 focus:border-teal-300/60"
                : "border-white/10 focus:border-teal-300/60",
            ].join(" ")}
            placeholder="Describe genre, mood, instruments..."
          />
        </label>

        {/* BPM */}
        <label className="grid gap-2">
          <span className="flex items-center justify-between text-sm text-stone-300">
            BPM (60–200)
            {updateFeedback === "bpm" && (
              <span className="text-xs text-amber-400 animate-pulse">
                ✓ BPM 適用済み（移行中）
              </span>
            )}
          </span>
          <input
            type="number"
            min={60}
            max={200}
            value={bpm}
            onChange={(e) => setBpm(Number(e.target.value))}
            className={[
              "rounded-2xl border bg-white/5 px-4 py-3 text-white outline-none transition",
              status === "playing"
                ? "border-teal-300/30 focus:border-teal-300/60"
                : "border-white/10 focus:border-teal-300/60",
            ].join(" ")}
          />
          {status === "playing" && (
            <p className="text-xs text-stone-500">変更後 1.2秒で適用（音が一瞬変化します）</p>
          )}
        </label>

        {/* コントロールボタン */}
        <div className="flex items-end gap-4 md:col-span-2">
          {!isActive ? (
            <button
              type="button"
              onClick={handleStart}
              disabled={!prompt.trim() || status === "stopping"}
              className="rounded-full bg-linear-to-r from-teal-400 via-cyan-300 to-emerald-300 px-8 py-3 font-medium text-stone-950 transition hover:scale-[1.01] disabled:cursor-not-allowed disabled:opacity-60"
            >
              ▶&ensp;Realtime Generate
            </button>
          ) : (
            <button
              type="button"
              onClick={handleStop}
              className="rounded-full border border-red-400/50 bg-red-500/10 px-8 py-3 font-medium text-red-200 transition hover:bg-red-500/20"
            >
              ■&ensp;Stop
            </button>
          )}

          {status === "playing" && (
            <div className="flex items-center gap-2 text-sm text-teal-300">
              {/* 音量バーアニメーション */}
              <span className="flex items-end gap-0.75 h-5">
                {[0.5, 0.9, 0.7, 1.0, 0.6, 0.8, 0.4].map((h, i) => (
                  <span
                    key={i}
                    className="w-0.75 rounded-full bg-teal-400 animate-bounce"
                    style={{
                      height: `${h * 100}%`,
                      animationDelay: `${i * 80}ms`,
                      animationDuration: "600ms",
                    }}
                  />
                ))}
              </span>
              音楽をストリーミング中...
            </div>
          )}

          {status === "connecting" && (
            <p className="text-sm text-amber-300 animate-pulse">
              WebSocket に接続中...
            </p>
          )}
        </div>
      </div>

      {errorMsg && (
        <p className="mt-5 rounded-2xl border border-red-300/30 bg-red-400/10 px-4 py-3 text-sm text-red-100">
          {errorMsg}
        </p>
      )}

      {/* 技術情報 */}
      <div className="mt-6 grid gap-3 md:grid-cols-3">
        <TechBadge label="出力形式" value="RAW 16bit PCM" />
        <TechBadge label="サンプルレート" value="48 kHz" />
        <TechBadge label="チャンネル" value="Stereo (2ch)" />
      </div>
    </section>
  );
}

function TechBadge({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-white/8 bg-white/5 px-4 py-3">
      <p className="text-xs uppercase tracking-[0.2em] text-stone-500">
        {label}
      </p>
      <p className="mt-1 text-sm font-medium text-teal-200">{value}</p>
    </div>
  );
}
