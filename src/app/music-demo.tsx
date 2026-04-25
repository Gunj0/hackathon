"use client";

import { useMemo, useState, useTransition } from "react";
import { RealtimeMusicPanel } from "./realtime-music-panel";

const presets = [
  {
    label: "Lo-fi",
    prompt:
      "A dusty lo-fi hip hop loop with Rhodes chords, brushed drums, vinyl crackle, and a warm upright bass line for late-night coding.",
  },
  {
    label: "Cinematic",
    prompt:
      "An uplifting cinematic cue that starts with piano, builds with strings and percussion, and lands on a hopeful finale.",
  },
  {
    label: "Game OST",
    prompt:
      "A bright retro game soundtrack in 8-bit style with arpeggiated synths, punchy drums, and adventurous energy.",
  },
];

type MusicResponse = {
  audioBase64: string;
  audioMimeType: string;
  model: string;
  notes: string | null;
  prompt: string;
  quotaExceeded?: boolean;
  quotaMessage?: string;
};

type MusicErrorResponse = {
  error?: string;
  reason?: string;
  retryAfterSec?: number | null;
};

export function MusicDemo() {
  const [prompt, setPrompt] = useState(presets[0].prompt);
  const [model, setModel] = useState("lyria-3-clip-preview");
  const [durationSec, setDurationSec] = useState(90);
  const [bpm, setBpm] = useState(92);
  const [instrumental, setInstrumental] = useState(true);
  const [result, setResult] = useState<MusicResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const audioUrl = useMemo(() => {
    if (!result) {
      return null;
    }

    return `data:${result.audioMimeType};base64,${result.audioBase64}`;
  }, [result]);

  const handleGenerate = () => {
    setError(null);

    startTransition(async () => {
      try {
        const response = await fetch("/api/gemini/music", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            prompt,
            model,
            durationSec,
            bpm,
            instrumental,
          }),
        });

        const payload = (await response.json()) as MusicResponse &
          MusicErrorResponse;

        if (!response.ok) {
          if (payload.reason === "quota_exceeded") {
            const retryHint =
              typeof payload.retryAfterSec === "number"
                ? ` 再試行目安: ${payload.retryAfterSec} 秒後。`
                : "";

            throw new Error(
              `${payload.error ?? "Lyria 3 のクォータ上限に達しました。"}${retryHint}`,
            );
          }

          throw new Error(payload.error ?? "Music generation failed.");
        }

        // フォールバック状態（quotaExceeded=true）を確認
        if (payload.quotaExceeded) {
          setError(
            payload.quotaMessage ||
              "デモモード：テキスト生成による説明を表示しています。",
          );
        }

        setResult(payload);
      } catch (caughtError) {
        const message =
          caughtError instanceof Error
            ? caughtError.message
            : "Music generation failed.";

        setResult(null);
        setError(message);
      }
    });
  };

  return (
    <main className="relative isolate min-h-screen overflow-hidden bg-[radial-gradient(circle_at_top_left,rgba(255,212,163,0.35),transparent_32%),linear-gradient(135deg,#130d07_0%,#22180e_38%,#0d1b1e_100%)] text-stone-100">
      <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.05)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.04)_1px,transparent_1px)] bg-size-[32px_32px] opacity-20" />
      <div className="relative mx-auto flex min-h-screen w-full max-w-7xl flex-col gap-10 px-6 py-10 lg:px-10">
        <section className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
          <div className="rounded-4xl border border-white/10 bg-white/8 p-8 backdrop-blur">
            <p className="text-sm uppercase tracking-[0.35em] text-amber-200/80">
              Google Lyria 3 Demo
            </p>
            <h1 className="mt-4 max-w-2xl text-4xl font-semibold tracking-tight text-white md:text-6xl">
              テキストから音楽を生成して、その場で再生するデモ
            </h1>
            <p className="mt-5 max-w-2xl text-base leading-7 text-stone-300 md:text-lg">
              @google/genai で Gemini API を呼び、Lyria 3 の音楽生成結果を
              Next.js の Route Handler
              経由で受け取ります。追加の音声再生ライブラリは不要で、ブラウザ標準の
              audio 要素だけで確認できます。
            </p>
            <div className="mt-8 grid gap-4 md:grid-cols-3">
              <InfoCard
                label="必要ライブラリ"
                value="@google/genai"
                note="Google Gen AI SDK。API キーはサーバー側だけで保持。"
              />
              <InfoCard
                label="推奨モデル"
                value="lyria-3-clip-preview"
                note="30 秒クリップ。プロンプト反復用に向いています。"
              />
              <InfoCard
                label="長尺生成"
                value="lyria-3-pro-preview"
                note="数分単位の楽曲向け。コストと待ち時間は増えます。"
              />
            </div>
          </div>

          <div className="rounded-4xl border border-amber-300/20 bg-stone-950/60 p-8 shadow-2xl shadow-black/20">
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-medium text-white">Prompt Presets</h2>
              <span className="rounded-full border border-white/10 px-3 py-1 text-xs text-stone-300">
                clip first, pro later
              </span>
            </div>
            <div className="mt-5 grid gap-3">
              {presets.map((preset) => (
                <button
                  key={preset.label}
                  type="button"
                  className="rounded-2xl border border-white/10 bg-white/5 px-4 py-4 text-left transition hover:border-amber-200/50 hover:bg-white/10"
                  onClick={() => setPrompt(preset.prompt)}
                >
                  <div className="text-sm uppercase tracking-[0.2em] text-amber-200/80">
                    {preset.label}
                  </div>
                  <p className="mt-2 text-sm leading-6 text-stone-300">
                    {preset.prompt}
                  </p>
                </button>
              ))}
            </div>
          </div>
        </section>

        <section className="grid gap-6 xl:grid-cols-[0.92fr_1.08fr]">
          <div className="rounded-4xl border border-white/10 bg-[#101418]/80 p-8 backdrop-blur">
            <div className="flex items-center justify-between">
              <h2 className="text-2xl font-medium text-white">Generate</h2>
              <span className="text-sm text-stone-400">
                server-side API key
              </span>
            </div>

            <div className="mt-6 grid gap-5">
              <label className="grid gap-2">
                <span className="text-sm text-stone-300">Prompt</span>
                <textarea
                  value={prompt}
                  onChange={(event) => setPrompt(event.target.value)}
                  className="min-h-40 rounded-3xl border border-white/10 bg-white/5 px-5 py-4 text-base text-white outline-none transition placeholder:text-stone-500 focus:border-amber-200/60"
                  placeholder="Describe genre, mood, instruments, BPM, structure..."
                />
              </label>

              <div className="grid gap-4 md:grid-cols-2">
                <label className="grid gap-2">
                  <span className="text-sm text-stone-300">Model</span>
                  <select
                    value={model}
                    onChange={(event) => setModel(event.target.value)}
                    className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-white outline-none focus:border-amber-200/60"
                  >
                    <option value="lyria-3-clip-preview">
                      lyria-3-clip-preview
                    </option>
                    <option value="lyria-3-pro-preview">
                      lyria-3-pro-preview
                    </option>
                  </select>
                </label>

                <label className="grid gap-2">
                  <span className="text-sm text-stone-300">BPM</span>
                  <input
                    type="number"
                    min={50}
                    max={190}
                    value={bpm}
                    onChange={(event) => setBpm(Number(event.target.value))}
                    className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-white outline-none focus:border-amber-200/60"
                  />
                </label>
              </div>

              <div className="grid gap-4 md:grid-cols-[1fr_auto] md:items-end">
                <label className="grid gap-2">
                  <span className="text-sm text-stone-300">Desired length</span>
                  <input
                    type="range"
                    min={30}
                    max={240}
                    step={15}
                    value={durationSec}
                    onChange={(event) =>
                      setDurationSec(Number(event.target.value))
                    }
                    disabled={model === "lyria-3-clip-preview"}
                    className="accent-amber-300"
                  />
                  <span className="text-sm text-stone-400">
                    {model === "lyria-3-clip-preview"
                      ? "Clip model is fixed to 30 seconds."
                      : `About ${durationSec} seconds`}
                  </span>
                </label>

                <label className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-stone-200">
                  <input
                    type="checkbox"
                    checked={instrumental}
                    onChange={(event) => setInstrumental(event.target.checked)}
                    className="h-4 w-4 accent-amber-300"
                  />
                  Instrumental only
                </label>
              </div>

              <button
                type="button"
                onClick={handleGenerate}
                disabled={isPending || !prompt.trim()}
                className="rounded-full bg-linear-to-r from-amber-300 via-orange-300 to-teal-300 px-6 py-3 font-medium text-stone-950 transition hover:scale-[1.01] disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isPending ? "Generating..." : "Generate Music"}
              </button>

              {error ? (
                <p className="rounded-2xl border border-red-300/30 bg-red-400/10 px-4 py-3 text-sm text-red-100">
                  {error}
                </p>
              ) : null}
            </div>
          </div>

          <div className="rounded-4xl border border-white/10 bg-white/8 p-8 backdrop-blur">
            <div className="flex items-center justify-between">
              <h2 className="text-2xl font-medium text-white">Result</h2>
              <span className="text-sm text-stone-400">
                {result ? result.model : "No track yet"}
              </span>
            </div>

            {result ? (
              <div className="mt-6 grid gap-6">
                {result.quotaExceeded ? (
                  <div className="rounded-[1.75rem] border border-amber-300/40 bg-amber-500/10 p-6">
                    <div className="flex items-start gap-4">
                      <div className="mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-amber-400/20 text-amber-300">
                        ✓
                      </div>
                      <div className="flex-1">
                        <p className="text-sm uppercase tracking-[0.24em] text-amber-200/80">
                          Demo Mode: Text Generation
                        </p>
                        <p className="mt-2 text-white">
                          Lyria 3
                          のクォータが超過したため、テキストモードで概要を生成しました
                        </p>
                      </div>
                    </div>
                  </div>
                ) : audioUrl ? (
                  <div className="rounded-[1.75rem] border border-white/10 bg-stone-950/60 p-6">
                    <div className="flex items-center justify-between gap-4">
                      <div>
                        <p className="text-sm uppercase tracking-[0.24em] text-amber-200/80">
                          Generated Audio
                        </p>
                        <p className="mt-2 text-lg text-white">
                          Preview in browser
                        </p>
                      </div>
                      <div className="h-16 w-16 rounded-full bg-[conic-gradient(from_180deg,#fcd34d,#fdba74,#5eead4,#fcd34d)] p-px">
                        <div className="flex h-full w-full items-center justify-center rounded-full bg-stone-950 text-xs uppercase tracking-[0.24em] text-stone-300">
                          mp3
                        </div>
                      </div>
                    </div>
                    <audio className="mt-6 w-full" controls src={audioUrl} />
                  </div>
                ) : null}

                <div className="grid gap-4 md:grid-cols-2">
                  <ResultCard
                    title="Prompt sent to API"
                    content={result.prompt}
                  />
                  <ResultCard
                    title={
                      result.quotaExceeded ? "Description" : "Arrangement notes"
                    }
                    content={
                      result.notes ??
                      "The model returned audio without textual notes."
                    }
                  />
                </div>
              </div>
            ) : (
              <div className="mt-6 flex min-h-80 flex-col items-center justify-center rounded-[1.75rem] border border-dashed border-white/15 bg-stone-950/40 px-8 text-center">
                <p className="text-sm uppercase tracking-[0.24em] text-stone-400">
                  Waiting for generation
                </p>
                <p className="mt-4 max-w-lg text-lg leading-8 text-stone-300">
                  プロンプトを入力して実行すると、ここに生成音声とモデルから返った補足テキストを表示します。
                </p>
              </div>
            )}
          </div>
        </section>

        <RealtimeMusicPanel />
      </div>
    </main>
  );
}

function InfoCard({
  label,
  note,
  value,
}: {
  label: string;
  note: string;
  value: string;
}) {
  return (
    <div className="rounded-3xl border border-white/10 bg-black/15 p-5">
      <p className="text-xs uppercase tracking-[0.24em] text-stone-400">
        {label}
      </p>
      <p className="mt-3 text-lg font-medium text-white">{value}</p>
      <p className="mt-2 text-sm leading-6 text-stone-300">{note}</p>
    </div>
  );
}

function ResultCard({ content, title }: { content: string; title: string }) {
  return (
    <div className="rounded-3xl border border-white/10 bg-stone-950/55 p-5">
      <p className="text-xs uppercase tracking-[0.24em] text-stone-400">
        {title}
      </p>
      <p className="mt-3 whitespace-pre-wrap text-sm leading-7 text-stone-200">
        {content}
      </p>
    </div>
  );
}
