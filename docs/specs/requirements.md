---
title: jev-cli 要件
type: spec
status: approved
---

# jev-cli 要件

TypeSafe AIの評価モデルJev (`typesafe-ai/jev`) を呼ぶCLI。入力を受けてJevにリクエストし、応答を整形して標準出力へ出す。指定があればファイルにも書く。
主眼は**リクエストを簡単に組み立てられること**。

参考: `~/github.com/kazhs/chart-insights/automation/jev-bias-poc.mjs` (PoC)、vaultの`wiki/entities/jev.md`

## 想定する使い方

- 手元で対話的に使う
- スクリプト・バッチから呼ぶ
- AIエージェント (skill等) から呼ぶ

## 技術選定

- TypeScript / Node 22以降
- pnpm + vitest + tsup
- npm公開を前提にする。パッケージ名`jev-cli`、コマンド名`jev`。公開時期は別途決める

## MVPの範囲

### state (入力)

- 単一入力: `--state <text>` / `--state @file` / `--state -` (stdin)
- 合成: `--state key=@file`を複数並べると`{ key: ... }`のJSONにまとめる。`.json`はJSONとして、それ以外はテキストとして読む
  - 例: `--state thesis=@thesis.txt --state market=@snapshot.json` → `{ thesis: "...", market: {...} }`
- stdinを読めるのは1か所だけ

### 質問 (リクエストの組み立て)

- inlineフラグ: 型ごとにフラグを用意する (`--bool` / `--choice` / `--score`)
  - 例: `--choice direction="thesisの方向は?|long:上昇,short:下落,neutral:未定"`
  - 例: `--bool is_bullish="marketは上昇を示すか"`
- YAMLファイル: `-f questions.yaml`
  - `questions`: 質問名 → `{ type, instructions, criteria }`
  - `state`: 実行時に渡すstateのキーと型の宣言 (text / json)。渡されなかったキーはエラーにする
- `-f`とinlineは併用できる。質問名が衝突したらエラーにする
- `--dry-run`: 組み立てたリクエストbodyを出してAPIは呼ばない (キー不要)

### プロバイダ

- プロバイダを差し替えられるよう抽象化する。MVPではVercel AI Gatewayだけを実装する
- キーはプロバイダごとの環境変数から読む。名前にサービス名 (VERCEL) は含めない
  - Vercel: `AI_GATEWAY_API_KEY`
  - TypeSafe直 (MVPの後): `TYPESAFE_API_KEY`
- キーはフラグでは受け付けない
- **未確認**: エンドポイントを`/v1/evaluate` (PoCで実績あり) と`/v4/ai/evaluation-model` (既存CLIが使用) のどちらにするか。実装前に公式docsで確かめる。環境変数名も同じく確かめる

### 出力

- 形式: `text` / `json` / `md`。既定はTTYなら`text`、pipeなら`json`。`--format`で上書きする
- `--raw`: APIの応答bodyを加工せず出す
- `-o path`: 標準出力とファイルの両方に書く。ファイルの形式は拡張子で決め (`.json`→json、`.md`→md)、それ以外の拡張子は`--format`に従う
- 付帯情報として、手元計測の所要時間・プロバイダ側の所要時間・token数・コスト (`marketCost`)・generationIdを出す
- 回答の出し方
  - choice: `choice`、各選択肢の確率、`confidence`
  - boolean: 確率。Jevはconfidenceを返さないので出さない (vaultの実測でも付いていなかった)

### 終了コード

| code | 意味 |
|---|---|
| 0 | 正常 |
| 1 | APIエラー (HTTPエラー・JSONでない応答・timeout) |
| 2 | 使い方の誤り (フラグ・YAML・stateの不整合) |
| 3 | 認証 (キー未設定・401/403) |

## MVPの後に回すもの

- 質問の展開 (`for_each`で時間軸×方向のような質問を機械的に作る)
- 名前で呼べるプリセット (`jev -p thesis`)
- TypeSafe直のプロバイダ (型名`noul`と`boolean`の変換が要る)
- バッチ (JSONL/CSVの行ごとに評価する)
- 閾値で合否を返す終了コード (CIのゲート用)
- MCPサーバ

## 関連

- 同名の既存CLIの調査: [20260924-existing-jev-clis](../research/20260924-existing-jev-clis.md)
