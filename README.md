# Lyria 3 Music Demo

Google の Gemini API から Lyria 3 を呼び出して、テキストプロンプトから音楽を生成する簡単なデモです。Next.js の Route Handler で `@google/genai` を使い、返ってきた音声データをそのままブラウザで再生します。

## 調査結果

- 必須 SDK は `@google/genai`。Gemini / Lyria 3 の現行 JavaScript SDK です。
- API キーは `GEMINI_API_KEY` をサーバー側環境変数として設定します。互換で `GOOGLE_API_KEY` も使えます。
- 短い試行には `lyria-3-clip-preview`、長尺の楽曲には `lyria-3-pro-preview` が適しています。
- 音声再生に追加ライブラリは不要です。返却された base64 を `audio` 要素へ渡すだけでプレビューできます。

## セットアップ

`.env.local` を作成して API キーを設定します。

```bash
GEMINI_API_KEY=your_google_ai_studio_key
# Optional
GEMINI_MUSIC_MODEL=lyria-3-clip-preview
```

依存関係を入れて開発サーバーを起動します。

```bash
npm install
npm run dev
```

ブラウザで `http://localhost:3000` を開くと、プロンプト入力、モデル選択、音声再生付きのデモ画面が表示されます。

## API

- `POST /api/gemini/music`
- body: `{ prompt, model, durationSec, bpm, instrumental }`
- response: `{ audioBase64, audioMimeType, notes, model, prompt }`

## 実装メモ

- `lyria-3-clip-preview` は 30 秒固定クリップ向けです。
- `lyria-3-pro-preview` は数分単位の生成向けなので、待ち時間とコストが増えます。
- デモでは `AUDIO` と `TEXT` の両方を要求し、音声と補足説明をまとめて表示します。

## 参考

- https://ai.google.dev/gemini-api/docs/music-generation
- https://ai.google.dev/gemini-api/docs/quickstart
- https://github.com/googleapis/js-genai
