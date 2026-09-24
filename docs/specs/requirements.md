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
- `key=`の形として扱うのは、keyが識別子 (英字か`_`で始まる英数字と`_`) のときだけ。`識別子=`で始まるテキストをそのまま渡すなら、`@file`かstdinを使う
- `@`で始まるテキストは`@@`で書く (`@@mention` → `@mention`)
- ファイルとstdinから読んだ値は、末尾の改行を1つだけ落とす

### 質問 (リクエストの組み立て)

- inlineフラグ: 型ごとにフラグを用意する (`--bool` / `--choice` / `--score`)。値は`name=質問文|criteria`
  - criteriaは`,`区切り。boolean・choiceは`key:説明`、scoreは段階を低い順に並べる
  - choiceは説明を省くと、選択肢名をそのまま説明に使う
  - 質問文とcriteriaは最後の`|`で分ける。説明に`,`や`|`を含めるなら質問ファイルを使う
  - 例: `--choice direction="thesisの方向は?|long:上昇,short:下落,neutral:未定"`
  - 例: `--bool is_bullish="marketは上昇を示すか"`
- YAMLファイル: `-f questions.yaml`
  - `questions`: 質問名 → `{ type, instructions, criteria }`
  - `state`: 実行時に渡すstateのキーと型の宣言 (text / json)。渡されなかったキーはエラーにする
- 質問名は英字か`_`で始め、英数字・`_`・`-`だけで書く
- 型ごとの制約はAPIに送る前に検証する (choiceは2〜255択、scoreは2〜10段階)
- `-f`とinlineは併用できる。質問名が衝突したらエラーにする
- `--model`でモデルを変えられる。優先順位は`--model` > 質問ファイルの`model` > `typesafe-ai/jev`
- `--dry-run`: 組み立てたリクエストbodyを出してAPIは呼ばない (キー不要)

### プロバイダ

- プロバイダを差し替えられるよう抽象化する。MVPではVercel AI Gatewayだけを実装する
- キーはプロバイダごとに分けて持つ。環境変数の名前にサービス名 (VERCEL) は含めない
  - Vercel: `AI_GATEWAY_API_KEY`
  - TypeSafe直 (MVPの後): `TYPESAFE_API_KEY`
- キーは次の順に探し、最初に見つかったものを使う
  1. 環境変数 (`AI_GATEWAY_API_KEY`)
  2. `<環境変数>_FILE`で指定したファイル (`AI_GATEWAY_API_KEY_FILE`)。前後の空白を落として使う。所有者以外が読める権限なら警告を出す (止めはしない)
  3. macOSのKeychain (service `jev-cli`、account = プロバイダ名)。macOS以外では探さない
- キーはフラグでもコマンドの引数でも受け付けない
- `jev auth`で、Keychainに入れたキーを管理する
  - `set`: Keychainに保存する。キーは`security`コマンドが端末で聞く (引数で渡すと、プロセス一覧からキーが見えるため)。端末が無ければ使い方の誤りにする
  - `status`: キーをどこから読むかを出す。キーの値は出さない。見つからなければ認証エラー
  - `delete`: Keychainから消す
- Vercelのエンドポイントは`POST https://ai-gateway.vercel.sh/v1/evaluate`、認証は`Authorization: Bearer $AI_GATEWAY_API_KEY` ([Vercel changelog](https://vercel.com/changelog/ai-gateway-now-supports-typesafe-clients-and-http-api-for-jev))
- 質問の型と応答の形 ([Vercel KB](https://vercel.com/kb/guide/typesafe-jev-and-ai-sdk))
  - `boolean`: `criteria`は`true` / `false`の説明で、省略できる。応答は`probability`
  - `choice`: `criteria`は選択肢名 → 説明のmapで、選択肢は255個まで。応答は`choice`と`probabilities`
  - `score`: `criteria`は段階の説明の配列 (低い段階から並べる) で、2〜10段階。応答は`score` (小数) と`probabilities` (段階の番号 → 確率)

### 出力

- 形式: `text` / `json` / `md`。既定はTTYなら`text`、pipeなら`json`。`--format`で上書きする
- `--raw`: APIの応答bodyを加工せず出す
- `-o path`: 標準出力とファイルの両方に書く。ファイルの形式は拡張子で決め (`.json`→json、`.md`→md)、それ以外の拡張子は`--format`に従う
- 付帯情報として、手元計測の所要時間・プロバイダ側の所要時間・token数・コスト (`marketCost`)・generationIdを出す
- 回答の出し方
  - choice: `choice`、各選択肢の確率、`confidence`
  - boolean: 確率。Jevはconfidenceを返さないので出さない (vaultの実測でも付いていなかった)
  - score: `score`と各段階の確率
- 応答に無い値は`n/a`と出す。jsonでは、取れなかった回答をキーごと落とさず`null`にする

### 終了コード

| code | 意味 |
|---|---|
| 0 | 正常 |
| 1 | APIエラー (HTTPエラー・JSONでない応答・timeout) |
| 2 | 使い方の誤り (フラグ・YAML・stateの不整合) |
| 3 | 認証 (キー未設定・キーファイルが読めない / 空・Keychainの操作の失敗・401/403) |

## MVPの後に回すもの

- 質問の展開 (`for_each`で時間軸×方向のような質問を機械的に作る)
- 名前で呼べるプリセット (`jev -p thesis`)
- TypeSafe直のプロバイダ (型名`noul`と`boolean`の変換が要る)
- バッチ (JSONL/CSVの行ごとに評価する)
- 閾値で合否を返す終了コード (CIのゲート用)
- MCPサーバ

## 関連

- 同名の既存CLIの調査: [20260924-existing-jev-clis](../research/20260924-existing-jev-clis.md)
