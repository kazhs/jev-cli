# AGENTS.md

PJ固有のAI向け指示。各種AIツール (Claude Code / Codex / Copilot / Cursor / Aider / Jules等) はこのファイルを参照する。Claude Codeは`CLAUDE.md`経由でインポート。

## 概要

TypeSafe AIの評価モデルJev (`typesafe-ai/jev`) を呼ぶCLI。stateと型付きの質問 (boolean / choice / score) からリクエストを組み立ててJevに投げ、応答を整形して標準出力とファイルに出す。要件は`docs/specs/requirements.md`をSoTにする。

## 技術スタック

- TypeScript (`strict: true`)、Node 22以降、ESM
- パッケージ管理: pnpm
- テスト: vitest
- ビルド: tsup
- npm公開を前提にする。パッケージ名`jev-cli`、コマンド名`jev`

## ディレクトリ構成

- `src/cli/` — 引数の解釈とコマンドの入口。I/O (stdin・ファイル・環境変数) はここと`src/io/`に閉じる
- `src/request/` — stateの合成と質問の組み立て (inlineフラグ・YAML)。純粋関数で書く
- `src/providers/` — プロバイダの実装。プロバイダ共通のinterfaceを1つ持ち、プロバイダごとの差 (エンドポイント・型名・キーの環境変数) はこの中に閉じる
- `src/output/` — 応答の整形 (text / json / md)。純粋関数で書く
- `src/credentials/` — APIキーの探索 (環境変数・キーファイル・Keychain)。キーの値を出力しない
- `src/io/` — ファイル・stdin・Keychain (macOSの`security`コマンド) の読み書き
- `src/shared.ts` — 層をまたいで使う小さな関数 (型ガード・エラー文の取り出し)。同じ関数を各ファイルに書き写さず、ここに置く
- テストは対象と同じ階層に`*.test.ts`で置く
- `docs/` — 要件・設計。構成は`docs/README.md`に従う

## コーディング規約

- 外部仕様 (APIのエンドポイント・リクエストや応答の形・環境変数名) をコードに書くときは、1次ソース (公式docs、または実際の応答) で確かめてから書き、出典のURLをコメントに残す
- ユーザーが名前を決めるキー (質問名・選択肢名・stateのキー) は`constructor`や`__proto__`でも壊れないように扱う。`in`やオブジェクトへの代入ではなく、`Object.hasOwn`・`Map`・`Object.fromEntries`を使う
- APIの応答は`unknown`として受け、型ガードで絞ってから使う。応答に無いフィールドは取得できなかったものとして扱い (text / mdでは`n/a`、jsonでは`null`)、推測で埋めない
- ユーザーに見せる文字列 (help・エラー・出力のラベル) は英語で書く。コードコメントは日本語でよい
- APIキーはフラグでもコマンドの引数でも受け付けない (プロセス一覧から見えるため)。読む先は`src/credentials/`の優先順位に従う。キーの値をログ・エラーメッセージ・`--dry-run`・`jev auth status`の出力に含めない
- 終了コードの意味は`docs/specs/requirements.md`の表に従う。増やすときは表を先に更新する
- テストはAPIを実際に呼ばない。`fetch`を差し替えてプロバイダの応答を固定する

## 開発フロー

- 依存の追加: `pnpm add <pkg>` (開発用は`-D`)
- テスト: `pnpm test`
- 型チェック: `pnpm typecheck`
- ビルド: `pnpm build`
- 作業を終える前に`pnpm typecheck && pnpm test`を通す
- これからやること (チケット) はGitHub Issuesで管理する。`docs/`にtodoやチケットのファイルを置かない
- ブランチは`feature/` / `fix/`で切り、mainへはPRで入れる
- コミットメッセージはConventional Commits形式、本文は日本語
