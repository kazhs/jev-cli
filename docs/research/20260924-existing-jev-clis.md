---
title: 同名の既存jev-cliの調査
type: research
---

# 同名の既存jev-cliの調査 (2026-09-24)

GitHubに`jev-cli`という名前のリポジトリが5件あった。設計の参考にするため、各CLIの形と、どのCLIにも無い機能を調べた。

- 調べ方: `gh api` (READMEとソース) と、npm・crates.io・PyPIのレジストリ。cloneはしていない
- 5件ともTypeSafe AIのJevを呼ぶCLIで、作られたのは2026-09-17〜21
- star数・最終commit日は調査日時点の値

## API面で分かったこと

- 5件のどれも、Vercel Gatewayの`POST https://ai-gateway.vercel.sh/v1/evaluate`を呼んでいない
  - TypeSafe直のAPIは`https://api.typesafe.ai/v1/systemone` (tumfのソースより)。直APIではyes/noの型を`noul`と呼ぶ
  - Vercel Gateway経由だと同じ型を`boolean`と呼ぶ。tumfはVercelを使うときに`noul`↔`boolean`を変換している
  - tumfはGatewayの`https://ai-gateway.vercel.sh/v4/ai/evaluation-model`に送っている。jtsang4は`@ai-sdk/gateway`の`evaluationModel()`を使っていて、その既定のbaseは`https://ai-gateway.vercel.sh/v4/ai`
- `/v1/evaluate`は、このCLIを作る前のPoCで実際に叩いて応答が返っている。`/v4/ai/...`との関係は未確認

## 各CLI

### shaharia-lab/jev-cli

- 言語はRust。25 star、最終commit 2026-09-21。ライセンスはMIT OR Apache-2.0 (GitHub上はApache-2.0と表示される)
- 配布: crates.io `jev-cli`、brew (`shaharia-lab/tap/jev`)、`cargo binstall`、インストールスクリプト、署名付きのバイナリ。コマンド名は`jev`
- プロバイダ: TypeSafe直のみ (`TYPESAFE_BASE_URL`で上書きできる)。Vercelには対応していない
- コマンド: `eval -f req.yaml`、ショートカット`noul` / `choice` / `score`、`validate`、`batch run`、`models list`、`auth`、`profile`、`config`、`schema`、`spec`、`mcp serve`、`completion`、`update`
- state: `--state <text>` / `--state-file`。バッチではJSONL/CSVの行からstateを選ぶ (`--state-field`等)
- 質問: inlineのフラグ、またはYAML/JSONのリクエストファイル
- 出力: `-o table|json|yaml|jsonl`。TTYならtable、pipeならJSON。値を1つだけ取り出す`--field <path>`、応答をそのまま出す`--raw`
- ファイル出力: バッチの`--out`のみ。途中から再開する`--resume`付き
- 認証: `TYPESAFE_API_KEY`、または0600の認証ファイル。キーをフラグでは受けない
- 参考になる点
  - 終了コードが安定していて、合否の判定にも使える (10 = `--fail-under` / `--fail-over`で不合格、11 = `--abstain-band`の範囲内)
  - `validate`と`--dry-run`はキー無し・オフラインで動き、コストの見積もりも出す
  - 応答ごとに`cost_usd` / `request_id` / `latency_ms`を出す
  - `spec`でCLIの仕様全体をJSONで出す (エージェント向け)。`schema`でJSON Schemaを出す
- 弱い点: TypeSafe直しか使えない。機能が非常に多い

### Nasrallah-AL/jev-cli

- 言語はTypeScript (Node 20.12以降)。21 star、最終commit 2026-09-20、MIT
- 配布: npm `jevctl` (コマンド名`jev`)。`@typesafe-ai/sdk`に依存している
- プロバイダ: TypeSafe / OpenRouter / Cloudflare Workers AI。Vercelには対応していない。`-P auto`だと、手元にあるキーのプロバイダへ黙って切り替わる
- コマンドが用途別に分かれている: `verify` / `screen` / `classify` / `extract` / `find` / `rerank` / `match` / `route` / `compact`。汎用には`ask` / `batch`
- 入力: 値はそのままならテキスト、`@path`ならファイル、`-`ならstdin (`@@`で`@`自体を書く)。`--state-json`でオブジェクトとして送る
- 質問: `--choice id="Q?|a:desc,b"`の形のinlineフラグ、または`-Q`でJSONを渡す
- 出力: text / json / jsonl / md / csv / tsv。`--pluck`でパスを指定して値を取り出す
- 終了コード: 0 = 正常、1 = エラー、2 = `--fail-on`の条件に当たった
- 認証: `TYPESAFE_API_KEY`、またはOSのキーチェーン
- 参考になる点
  - PRコメントや`$GITHUB_STEP_SUMMARY`に貼るためのMarkdown出力がある
  - `@file` / `-`で入力を指定する書き方
  - `--pluck`のパスを打ち間違えると、空の値を出さずにエラーにする
- 弱い点: エラーの種類を問わず終了コードが1になる。Vercelに対応していない。YAMLで質問を書けない

### tumf/jev-cli

- 言語はPython 3.13以降で、依存無し。13 star、最終commit 2026-09-23、MIT
- 配布: PyPI `jev-cli` (`uv tool install`)。コマンドは`jev`と`jev-mcp`
- プロバイダ: `official` / `vercel` / `openrouter` / `custom`
- コマンド: `noul` / `choice` / `score` (`-q`で質問、`-s`でstate、`-o KEY=DESC`、`-l`で段階)。`run request.json|-`でリクエスト全体を渡す。`auth set|status|test`
- 出力: 既定は1行のJSON。`--pretty`で整形、`--value`で主な値だけを出す。表形式とファイル出力は無い
- 終了コード: 0 / 1 / 2 / 3 (認証) / 4 (一時的なエラー・レート制限)
- 認証: プロバイダごとに`TYPESAFE_API_KEY` / `AI_GATEWAY_API_KEY` / `OPENROUTER_API_KEY` / `JEV_API_KEY`
- 参考になる点: プロバイダの差を吸収して応答の形を揃えている (`noul`↔`boolean`)。キーをプロバイダごとに分けている。`auth test`で小さなリクエストを実際に投げてキーを確かめる
- 弱い点: YAMLで質問を書けない。バッチ・人間向けの出力・合否判定が無い

### jtsang4/jev-cli

- 言語はTypeScript (Bun / Node 22以降)。3 star、最終commit 2026-09-18、MIT
- 配布: npm `@jtsang/jev-cli` (コマンド名`jev-cli`)
- プロバイダ: `jev` (直) と`vercel`。`vercel`はAI SDKの`@ai-sdk/gateway`経由で呼び、既定のモデルは`typesafe-ai/jev`
- コマンド: `eval`、`config`、`doctor`
- 入力: `-s` / `--state-file`、`-q` / `--questions-file` (質問はJSON)。`-`でstdin (どちらか一方だけ)
- 出力: JSONのみ。`--full`でusageとプロバイダのメタデータを足す
- 終了コード: 0 / 1 (プロバイダ) / 2 (使い方) / 3 (認証)
- 認証: `JEV_CLI_API_KEY`、または`TYPESAFE_API_KEY` / `AI_GATEWAY_API_KEY`。キーを設定ファイルに平文で保存することもできる
- 参考になる点: AI SDKの公式のGatewayクライアントを使っている。優先順位 (フラグ > 環境変数 > 設定ファイル) を文書にしている
- 弱い点: 質問はJSONでしか書けない。人間向けの出力・バッチ・ファイル出力が無い。`JEV_CLI_API_KEY`が1つのため、別のプロバイダへキーが送られうる (README自身が注意している)

### joshLong145/jev-cli

- 言語はPython 3.11以降 (`typesafe-sdk`、typer、rich)。3 star、最終commit 2026-09-21
- ライセンス: LICENSEファイルが無い (`pyproject.toml`にはMITと書いてある)
- どこにも公開していない。コマンドは`jcli`
- 用途: ログの解析。`jcli analyze <files|->`でJSON / NDJSON / テキストのログを読む
- 質問: YAMLの「pack」(`logs.triage`等) として持ち、上から重ねて上書きできる (`--questions` / `--set` / `--drop`)
- 出力: json / ndjson / table / csv / summary
- 合否判定: `--fail-on 'a>=0.8 and b>=1.5'`で終了コード6
- 参考になる点
  - 質問をpackにまとめて、層を重ねて上書きできる
  - booleanに`|p-0.5|×2`の確かさを出す。APIのconfidenceではなく自前で計算した値だと明示している
  - 送る前に秘密情報を伏せる (`--redact-preset secrets`)
- 弱い点: 公開されていない。LICENSEファイルが無い。TypeSafe直しか使えない。ログ解析に特化している

## 比較

| | 言語 | 配布 | star | 最終commit | Vercel | 質問ファイル | 出力 | バッチ | 合否の終了コード | MCP |
|---|---|---|---|---|---|---|---|---|---|---|
| shaharia-lab | Rust | crates / brew / バイナリ | 25 | 09-21 | 無し | YAML / JSON | table / json / yaml / jsonl | あり (再開可) | あり (10 / 11) | あり |
| Nasrallah-AL | TS | npm `jevctl` | 21 | 09-20 | 無し | JSON + inline | text / json / jsonl / md / csv / tsv | あり | あり (2) | 無し |
| tumf | Python | PyPI `jev-cli` | 13 | 09-23 | あり (`/v4/ai/evaluation-model`) | JSONのリクエストのみ | JSON / 値のみ | 無し | 無し | あり |
| jtsang4 | TS | npm `@jtsang/jev-cli` | 3 | 09-18 | あり (AI SDK) | JSONのみ | JSONのみ | 無し | 無し | 無し |
| joshLong145 | Python | 未公開 | 3 | 09-21 | 無し | YAMLのpack | json / ndjson / table / csv / summary | 区切って実行 | あり (6) | 無し |

## どのCLIにも無かったもの

- Vercel Gatewayに対応したうえで、YAMLの質問定義と人間向けの出力を両方持つもの (Vercelに対応しているtumfとjtsang4は、どちらもJSON出力だけ)
- 1回の評価結果を`-o file`でファイルに書くもの (ファイル出力はバッチだけにある)
- 同じ質問を複数のstateに当てて比べる機能
- Markdown出力はNasrallah-ALだけにあり、そのNasrallah-ALはVercelに対応していない。コストの見積もりはshaharia-labだけにあり、shaharia-labはTypeSafe直しか使えない
- 次は調べていない: 英語以外のstateの扱い、各CLIの速度とコスト

## npmのパッケージ名

- `jev-cli`: 空き (レジストリが404を返した)
- `jev`: 使用中。2022-05-06から更新が無く放置されているようだが、使えない
- 近い名前: `jevcli`は2026-09-17に作られた0.0.1の仮置き。`jevctl`はNasrallah-AL、`@jtsang/jev-cli`はjtsang4が使っている
