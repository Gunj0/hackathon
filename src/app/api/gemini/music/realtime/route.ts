import { GoogleGenAI, type LiveMusicServerMessage } from "@google/genai";
import { activeSessions } from "./sessions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Lyria RealTime はストリーミングが長くなるため最大 5 分まで許容する
export const maxDuration = 300;

type RealtimeRequestBody = {
  prompt?: string;
  bpm?: number;
};

export async function POST(request: Request) {
  const apiKey = process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY;

  if (!apiKey) {
    return Response.json(
      {
        error:
          "GEMINI_API_KEY is not set. Add it to .env.local before using the demo.",
      },
      { status: 500 },
    );
  }

  let body: RealtimeRequestBody;

  try {
    body = (await request.json()) as RealtimeRequestBody;
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const prompt = body.prompt?.trim();

  if (!prompt) {
    return Response.json({ error: "prompt is required." }, { status: 400 });
  }

  const bpm =
    typeof body.bpm === "number"
      ? Math.max(60, Math.min(200, body.bpm))
      : undefined;

  const ai = new GoogleGenAI({ apiKey, apiVersion: "v1alpha" });

  // セッション参照はキャンセルハンドラとコールバックで共有する
  let session: Awaited<
    ReturnType<(typeof ai.live.music)["connect"]>
  > | null = null;

  // クライアントが PATCH でセッションを参照するための ID
  const sessionId = crypto.randomUUID();

  const encode = (data: object) =>
    new TextEncoder().encode(`data: ${JSON.stringify(data)}\n\n`);

  const stream = new ReadableStream({
    async start(controller) {
      try {
        session = await ai.live.music.connect({
          model: "models/lyria-realtime-exp",
          callbacks: {
            onmessage: (message: LiveMusicServerMessage) => {
              if (message.serverContent?.audioChunks) {
                for (const chunk of message.serverContent.audioChunks) {
                  if (chunk.data) {
                    try {
                      controller.enqueue(encode({ audioChunk: chunk.data }));
                    } catch {
                      // ストリームが既に閉じている場合は無視
                    }
                  }
                }
              }
            },
            onerror: (e) => {
              try {
                controller.enqueue(encode({ error: String(e) }));
                controller.close();
              } catch {
                // Already closed
              }
              activeSessions.delete(sessionId);
            },
            onclose: () => {
              try {
                controller.enqueue(encode({ done: true }));
                controller.close();
              } catch {
                // Already closed
              }
              activeSessions.delete(sessionId);
            },
          },
        });

        await session.setWeightedPrompts({
          weightedPrompts: [{ text: prompt, weight: 1.0 }],
        });

        await session.setMusicGenerationConfig({
          musicGenerationConfig: bpm !== undefined ? { bpm } : {},
        });

        session.play();
        // セッション ID をストアに登録してから SSE で通知する
        activeSessions.set(sessionId, { session, bpm });
        controller.enqueue(encode({ status: "playing", sessionId }));
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Unknown error";
        try {
          controller.enqueue(encode({ error: message }));
          controller.close();
        } catch {
          // Already closed
        }
      }
    },

    cancel() {
      // クライアント切断またはAbortController発火時にセッションを停止
      activeSessions.delete(sessionId);
      try {
        session?.stop();
      } catch {
        // クリーンアップエラーは無視
      }
    },
  });

  // request.signal はクライアント切断時に abort される（ReadableStream.cancel の補完）
  request.signal.addEventListener("abort", () => {
    activeSessions.delete(sessionId);
    try {
      session?.stop();
    } catch {
      // Ignore
    }
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}

// ---------------------------------------------------------------------------
// PATCH /api/gemini/music/realtime
// 再生中のセッションのプロンプトまたは BPM を更新する。
// ---------------------------------------------------------------------------
type PatchBody = {
  sessionId?: string;
  prompt?: string;
  bpm?: number;
};

export async function PATCH(request: Request) {
  let body: PatchBody;
  try {
    body = (await request.json()) as PatchBody;
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const { sessionId, prompt, bpm } = body;

  if (!sessionId) {
    return Response.json({ error: "sessionId is required." }, { status: 400 });
  }

  const entry = activeSessions.get(sessionId);
  if (!entry) {
    return Response.json(
      { error: "Session not found or already closed." },
      { status: 404 },
    );
  }

  const { session } = entry;

  if (prompt !== undefined) {
    await session.setWeightedPrompts({
      weightedPrompts: [{ text: prompt.trim(), weight: 1.0 }],
    });
  }

  if (bpm !== undefined) {
    const clampedBpm = Math.max(60, Math.min(200, bpm));
    // BPM 変更は全体 config の再送信が必要。未設定フィールドはモデルが決定する。
    await session.setMusicGenerationConfig({
      musicGenerationConfig: { bpm: clampedBpm },
    });
    // BPM 変更後はコンテキストリセットでモデルに新値を認識させる
    session.resetContext();
    // ストアの bpm を更新
    entry.bpm = clampedBpm;
  }

  return Response.json({ ok: true });
}
