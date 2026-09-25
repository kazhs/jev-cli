# jev-cli

[English](README.md) | 日本語

TypeSafe AIの評価モデル[Jev](https://typesafe.ai/blog/introducing-system-one-models-and-jev)を呼ぶコマンドラインクライアント。

Jevは文章を生成しない。*state* (テキストかJSON) と型付きの*質問*を渡すと、確率を返す。yes/noの質問なら確率を、選択肢の質問なら選ばれた1つを、段階の質問ならスコアを返す。`jev`はフラグかYAMLファイルからリクエストを組み立て、[Vercel AI Gateway](https://vercel.com/docs/ai-gateway/modalities/evaluation)経由でモデルを呼び、回答をtext・JSON・Markdownで出す。

```console
$ jev -s "I was charged twice for my subscription" \
    --bool "refund=Is the customer asking for money back?" \
    --score "urgency=How urgent is this ticket?|low,medium,high"
refund: 77.0%
  question: Is the customer asking for money back?
urgency: 1.26  (0:low 3.0% / 1:medium 68.0% / 2:high 29.0% / confidence 0.52)
  question: How urgent is this ticket?
  criteria: 0: low / 1: medium / 2: high

state:
  I was charged twice for my subscription

startedAt: 2026-09-25T06:44:50.582Z
provider: vercel / typesafe-ai/jev
elapsed: 948ms (local) / provider 97ms
tokens: input 318 / output 34
marketCost: 0.000013356
generationId: gen_01M3BMYGJ1NXKNY3CGSV78Q68H
```

## インストール

Node.js 22以降が要る。

```sh
npm install -g jev-cli
```

ソースから`~/.local/bin`に入れる場合:

```sh
git clone https://github.com/kazhs/jev-cli.git
cd jev-cli
pnpm install
pnpm run install-local     # ビルド・pack・npm --prefix ~/.localでのインストールまで行う
jev --help
```

入れたものは`~/.local/lib/node_modules/jev-cli`に置かれ、clone先には依存しない。入れたあとでclone先を移動しても消しても動く。更新するときは`pnpm run install-local`をもう一度実行し、外すときは`pnpm run uninstall-local`を実行する。別の場所に入れるなら`PREFIX`を指定する (`PREFIX=/opt/jev pnpm run install-local`なら`/opt/jev/bin`に入る)。

### Claude Codeから入れる

このrepoには、project skillの`jev-dev-install` (`.claude/skills/jev-dev-install/`) が入っている。Claude Codeでrepoを開き、「jevをインストールして」と頼むか、`/jev-dev-install`を実行すると、次を行う。

- PATH上の入れ先を決める (候補が複数あれば聞く)
- `pnpm run install-local`で入れ、入ったビルドを確かめる
- `jev auth status`でAPIキーを確かめ、見つからなければKeychainかキーファイルでの設定を案内する
- 実行の記録を残すディレクトリ (`JEV_CLI_OUTPUT_DIR`) を確かめ、無ければ作るか、設定するかを聞く。設定するなら、shellの設定ファイルに`export`の行を書き足すことを提案する

shellの設定ファイルを書き換えるのは、承認を得てその1行を足すときだけ。APIキーを読むことも入力することもしない。

## 認証

`jev`には[AI GatewayのAPIキー](https://vercel.com/docs/ai-gateway)が要る。キーは次の順に探し、最初に見つかったものを使う。

1. `AI_GATEWAY_API_KEY` — キーそのもの
2. `AI_GATEWAY_API_KEY_FILE` — キーを書いたファイルのパス。前後の空白は無視する。所有者以外が読めるか書ける権限なら警告を出す
3. macOSのKeychain (service `jev-cli`、account `vercel`)

キーはフラグでも引数でも受け付けない。引数はプロセス一覧から見えるため。

### macOSのKeychain

```sh
jev auth set      # キーを入力させ、Keychainに保存する
jev auth status   # キーをどこから読むかを出す (キーそのものは出さない)
jev auth delete   # Keychainからキーを消す
```

`jev auth set`は端末から実行する。キーは`security`コマンドのプロンプトで入力する。

### キーファイル

Linux、CI、またはKeychainを使わない場合:

```sh
mkdir -p ~/.config/jev
install -m 600 /dev/null ~/.config/jev/ai-gateway-key   # 自分だけが読める空のファイルを作る
$EDITOR ~/.config/jev/ai-gateway-key                   # キーを貼る
export AI_GATEWAY_API_KEY_FILE=~/.config/jev/ai-gateway-key
```

## state

`-s, --state`には次のどれかを渡す。

| 値 | 意味 |
| --- | --- |
| `some text` | そのテキスト |
| `@path` | ファイルの中身。`.json`のファイルはJSONとして読み、それ以外はテキストとして送る |
| `-` | 標準入力 |
| `@@text` | `@`で始まるテキスト (`@@mention`は`@mention`を送る) |

ファイルと標準入力から読んだ値は、末尾の改行を1つ落とす。

`-s key=<値>`を繰り返すと、複数の入力を1つのJSONオブジェクトにまとめる。

```sh
jev -s thesis=@thesis.txt -s market=@snapshot.json --bool "consistent=Does the thesis agree with the market data?"
# 送られるstate: { "thesis": "...", "market": { ... } }
```

`key=`として扱うのは、keyが識別子 (英字・数字・`_`で、数字では始まらない) のときだけ。`word=`で始まるテキストをそのまま送るなら、`@file`か`-`を使う。

標準入力から読める`--state`は1つだけ。

## 質問

### inlineフラグ

```sh
# boolean: その文が正しい確率。criteriaは省ける
--bool  "refund=Is the customer asking for money back?"
--bool  "passed=Did the build succeed?|true:exit code 0,false:any non-zero exit code"

# choice: 選択肢から1つを選ぶ。"名前:説明" か、名前だけ
--choice "route=Route this ticket|billing:payment problems,shipping:delivery problems,technical"

# score: 段階で評価する。段階は低い順に並べる
--score "urgency=How urgent is this ticket?|low,medium,high"
```

質問文とcriteriaは最後の`|`で分け、criteriaの各項目は`,`で区切る。説明に`,`や`|`を含めるなら、質問ファイルを使う。

質問名は英字か`_`で始め、英字・数字・`_`・`-`だけで書く。

### 質問ファイル

```yaml
# questions/thesis.yaml
state:                   # 省略可: -sで渡すべきキーを宣言する
  thesis: text
  market: json

questions:
  direction:
    type: choice
    instructions: Which direction does the thesis argue for?
    criteria:
      long: expects the price to rise
      short: expects the price to fall
      neutral: no direction, or expects a range

  quality:
    type: score
    instructions: How well is the thesis supported by evidence?
    criteria:
      - no evidence
      - some evidence
      - strong evidence

  mentions_risk:
    type: boolean
    instructions: Does the thesis mention a stop loss or a risk limit?
```

```sh
jev -f questions/thesis.yaml -s thesis=@thesis.txt -s market=@snapshot.json
```

`state`を宣言したら、宣言したキーは全部渡す必要があり、それ以外のキーは渡せない。宣言した型 (`text` / `json`) は、ファイルの拡張子より優先する。

質問ファイルとinlineフラグは併用できる。両方で同じ質問名を使うとエラーになる。

質問は、リクエストを送る前に検証する。

| 型 | `criteria` |
| --- | --- |
| `boolean` | 省略可。`true`と`false`の説明 (片方だけでもよい) |
| `choice` | 選択肢名 → 説明。2〜255個 |
| `score` | 段階の説明の配列。低い段階から並べ、2〜10個 |

Jevは1つのリクエストの質問を、それぞれ独立に並列で評価する。そのため、ある質問から別の質問の答えを参照することはできない。

## 出力

| フラグ | 効果 |
| --- | --- |
| `--format text\|json\|md` | 出力形式。既定は、標準出力が端末なら`text`、それ以外なら`json` |
| `-o, --output <path>` | 結果をファイルにも書く。`.json`と`.md`は拡張子で形式が決まり、それ以外は`--format`に従う |
| `--raw` | APIの応答bodyをそのまま出す |
| `--dry-run` | リクエストbodyを出して終わる。APIは呼ばない (キーは要らない) |

choiceとscoreの回答には、選択肢や段階ごとの確率を出し、APIが返したときは`confidence`も出す。応答に無い値は、textとMarkdownでは`n/a`、JSONでは`null`になる。

どの出力にも入力を残す。textは質問ごとに質問文とcriteriaを出し、最後にstateを出す。Markdownは`## State`と`## Questions`の節を足す。JSONは`request`を持つ。scoreの段階は説明つきで出す (`3:excellent 98.0%`)。

JSON出力の形は次のとおり。

```json
{
  "request": {
    "model": "typesafe-ai/jev",
    "state": "I was charged twice",
    "questions": {
      "refund": { "type": "boolean", "instructions": "Is the customer asking for money back?" }
    }
  },
  "answers": {
    "refund": { "type": "boolean", "probability": 0.79 }
  },
  "meta": {
    "provider": "vercel",
    "startedAt": "2026-09-25T02:15:30.123Z",
    "model": "typesafe-ai/jev",
    "elapsedMs": 1098,
    "providerMs": 122,
    "inputTokens": 278,
    "outputTokens": 20,
    "marketCost": "0.000011676",
    "generationId": "gen_01M39ZKKYNNKFH2RNP93G2YAY0"
  }
}
```

`elapsedMs`は手元で測った時間で、ネットワークの往復を含む。`providerMs`は、Gatewayが記録したプロバイダ呼び出しの時間。

### 実行の記録

`JEV_CLI_OUTPUT_DIR`を設定すると、`-o`を付けなくても、評価ごとにファイルを残す。

```sh
export JEV_CLI_OUTPUT_DIR=~/jev-runs
jev -s "I was charged twice" --bool "refund=Is the customer asking for money back?"
# ~/jev-runs/20260925T021530Z-gen_01M39ZKKYNNKFH2RNP93G2YAY0.jsonにも書く
```

各ファイルの中身は`--format json`と同じ (request・answers・meta) で、標準出力の`--format`や`--raw`には影響されない。ファイル名はUTCの開始時刻で始まるので、名前順に並べれば時系列になる。`-o`と併用できる。`--dry-run`のときと、APIの呼び出しが失敗したときは書かない。

## そのほかのオプション

| フラグ | 既定値 |
| --- | --- |
| `--provider <name>` | `vercel` |
| `--timeout <ms>` | `30000` (1〜2147483647) |

## 終了コード

| コード | 意味 |
| --- | --- |
| 0 | 成功 |
| 1 | APIエラー (HTTPエラー・JSONでない応答・タイムアウト・ネットワークの失敗) |
| 2 | 使い方の誤り (フラグ・質問ファイル・state) |
| 3 | 認証 (キーが見つからない・キーファイルが読めない / 空・Keychainの失敗・HTTP 401 / 403) |

## 開発

```sh
pnpm install
pnpm typecheck
pnpm test
pnpm build
```

テストはAPIを呼ばない。

## ライセンス

MIT
