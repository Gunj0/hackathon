import { GoogleGenAI } from "@google/genai";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SUPPORTED_MODELS = [
  "lyria-3-clip-preview",
  "lyria-3-pro-preview",
] as const;

type SupportedModel = (typeof SUPPORTED_MODELS)[number];

type MusicRequestBody = {
  prompt?: string;
  model?: string;
  durationSec?: number;
  bpm?: number;
  instrumental?: boolean;
};

const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));

const isSupportedModel = (model: string): model is SupportedModel =>
  SUPPORTED_MODELS.includes(model as SupportedModel);

function resolveModel(
  requestedModel?: string,
  envModel?: string,
): SupportedModel {
  if (requestedModel && isSupportedModel(requestedModel)) {
    return requestedModel;
  }

  if (envModel && isSupportedModel(envModel)) {
    return envModel;
  }

  return "lyria-3-clip-preview";
}

function buildPrompt({
  prompt,
  bpm,
  durationSec,
  instrumental,
  model,
}: {
  prompt: string;
  bpm?: number;
  durationSec?: number;
  instrumental: boolean;
  model: SupportedModel;
}) {
  const parts = [prompt.trim()];

  if (instrumental) {
    parts.push("Instrumental only. No vocals.");
  }

  if (typeof bpm === "number") {
    parts.push(`Target tempo: around ${bpm} BPM.`);
  }

  if (model === "lyria-3-clip-preview") {
    parts.push("Produce a concise 30-second clip with a clear hook.");
  } else if (typeof durationSec === "number") {
    parts.push(`Aim for a song around ${durationSec} seconds long.`);
  }

  parts.push(
    "Return both the audio and a short textual description of the arrangement.",
  );

  return parts.join(" ");
}

function extractRetryDelaySeconds(message: string) {
  const match = message.match(/retry in\s+([\d.]+)s/i);

  if (!match) {
    return null;
  }

  const seconds = Number(match[1]);
  return Number.isFinite(seconds) ? Math.ceil(seconds) : null;
}

async function generateTextFallback(
  apiKey: string,
  prompt: string,
  bpm?: number,
  durationSec?: number,
  instrumental?: boolean,
) {
  const ai = new GoogleGenAI({ apiKey });

  // テキスト生成用のプロンプトを構築
  const fallbackPrompt = [
    `Music composition concept: ${prompt}`,
    instrumental ? "Instrumental only. No vocals." : "",
    bpm ? `Target tempo: around ${bpm} BPM.` : "",
    durationSec ? `Duration: around ${durationSec} seconds.` : "",
    "\n以下の内容を簡潔に日本語で提供してください：\n1. 音楽のジャンル・スタイル\n2. 主な楽器構成\n3. アレンジの特徴",
  ]
    .filter(Boolean)
    .join(" ");

  try {
    const response = await ai.models.generateContent({
      model: "gemini-2.0-flash",
      contents: fallbackPrompt,
    });

    const textContent =
      response.candidates?.[0]?.content?.parts
        ?.map((part) => (typeof part.text === "string" ? part.text : ""))
        .filter(Boolean)
        .join("\n") || "音楽生成のデモンストレーション（テキストモード）";

    return textContent;
  } catch {
    // テキスト生成が失敗してもデフォルトメッセージを返す
    return "音楽生成のデモンストレーション（テキストモード）\n入力されたプロンプトに基づいて音楽を生成します。";
  }
}

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

  let body: MusicRequestBody;

  try {
    body = (await request.json()) as MusicRequestBody;
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const prompt = body.prompt?.trim();

  if (!prompt) {
    return Response.json({ error: "prompt is required." }, { status: 400 });
  }

  const envModel = process.env.GEMINI_MUSIC_MODEL;
  const requestedModel = body.model?.trim();
  const model = resolveModel(requestedModel, envModel);

  const durationSec =
    typeof body.durationSec === "number"
      ? clamp(body.durationSec, 30, 240)
      : undefined;
  const bpm =
    typeof body.bpm === "number" ? clamp(body.bpm, 50, 190) : undefined;
  const instrumental = body.instrumental ?? true;

  const ai = new GoogleGenAI({ apiKey });
  const composedPrompt = buildPrompt({
    prompt,
    bpm,
    durationSec,
    instrumental,
    model,
  });

  try {
    const response = await ai.models.generateContent({
      model,
      contents: composedPrompt,
      config: {
        responseModalities: ["AUDIO", "TEXT"],
      },
    });

    const parts =
      response.candidates?.flatMap(
        (candidate) => candidate.content?.parts ?? [],
      ) ?? [];
    const textParts = parts
      .flatMap((part) => (typeof part.text === "string" ? [part.text] : []))
      .map((text) => text.trim())
      .filter(Boolean);
    const audioPart = parts.find((part) => part.inlineData?.data);

    if (!audioPart?.inlineData?.data) {
      return Response.json(
        { error: "The model did not return any audio data." },
        { status: 502 },
      );
    }

    return Response.json({
      audioBase64: audioPart.inlineData.data,
      audioMimeType: audioPart.inlineData.mimeType ?? "audio/mp3",
      model,
      notes: textParts.join("\n\n") || null,
      prompt: composedPrompt,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    const status =
      typeof error === "object" &&
      error !== null &&
      "status" in error &&
      typeof error.status === "number"
        ? error.status
        : 502;

    if (status === 429 || message.includes("RESOURCE_EXHAUSTED")) {
      const retryAfterSec = extractRetryDelaySeconds(message);

      // クォータ超過時はテキストモードにフォールバック
      const fallbackText = await generateTextFallback(
        apiKey,
        prompt,
        bpm,
        durationSec,
        instrumental,
      );

      // デモモード: オーディオの代わりにテキストを返す
      return Response.json({
        audioBase64: "",
        audioMimeType: "text/plain",
        model: "text-fallback",
        notes: fallbackText,
        prompt: composedPrompt,
        quotaExceeded: true,
        quotaMessage:
          retryAfterSec !== null
            ? `Lyria 3 のクォータ上限に達しました。約 ${retryAfterSec} 秒後に再試行できます。`
            : "Lyria 3 のクォータ上限に達しました。少し待って再試行してください。",
      });
    }

    return Response.json(
      { error: `Gemini music generation failed: ${message}` },
      { status },
    );
  }
}
