---
name: jev-dev-install
description: jev-cliのrepoをビルドし、PATHの通ったディレクトリに`jev`コマンドとしてインストールする。APIキーが未設定なら、その場で設定まで案内する。コードを変えたあとにローカルの`jev`へ反映したいとき、`jev`がcommand not foundになるとき、新しいマシンでjevを使えるようにしたいときにも使う。発火語 - jev-dev-install / jevをインストール / jevを入れ直す / jevを更新して入れて / jevをPATHに入れる / ローカルのjevを最新にする / jevが見つからない。非発火 - npmに公開する作業、`jev`コマンドで評価を実行する依頼、APIキーの値そのものを扱う依頼。
---

# jev-dev-install

jev-cliのrepoから`jev`をビルドし、PATHの通ったディレクトリへ入れる。入れたあと、APIキーが見つかる状態かを確かめ、見つからなければ設定を案内する。

インストールの実体はrepoの`scripts/install-local.sh` (`pnpm run install-local`) で、`$PREFIX/bin/jev`に入れる。このskillが受け持つのは、`PREFIX`を決めることと、その前後の確認。スクリプトはビルド→pack→`npm install -g --prefix`を行うので、入れたものはrepoの場所や`node_modules`に依存しない。そのかわり、コードを変えたら入れ直すまで反映されない。

## やらないこと

- **shellの設定ファイル (`~/.zshrc`等) を編集しない**。PATHの追加もキーのexportも、必要ならcallerに案内するだけにする。設定ファイルはdotfilesとして共有されていることがあり、キーを平文で書くと漏れる
- **キーの値を読まない・入力しない・表示しない**。キーファイルや`.env`の中身もコンテキストに載せない
- **`jev auth set`をBashで実行しない**。`security`コマンドが端末でキーを聞く作りで、端末の無いBashからは入力できない (`jev`もexit 2で止める)
- git書き込み (commit・push等) をしない

`jev auth status`は承認なしで実行してよい。Keychainやキーファイルを読むが、出力するのはキーの読み先だけで値は出さず、外部へのアクセスもしない。

## 手順

### 1. 前提を確かめる

- repoのルートに`scripts/install-local.sh`があり、`package.json`の`scripts`に`install-local`があることを確かめる。どちらかが無ければ、ここで止めて「インストールスクリプトが無い」と報告する
- repoの`node_modules`が無ければ、`pnpm install`を実行する

### 2. 入れ先を決める

スクリプトは`$PREFIX/bin`に入れるので、入れ先は`bin`で終わるディレクトリにする (`PREFIX`はその親)。次の順で決め、決まった時点で止める。

1. callerが入れ先を指定していれば、それを使う。`bin`で終わらないディレクトリを指定されたら、入れられない旨を伝えて指定し直してもらう
2. `~/.local/bin`がPATHに入っていれば、`PREFIX=~/.local`にする。PATH上の位置は問わない (手前に別の`jev`があれば、手順4で見つかる)
3. PATHの中から、次の3つを満たすディレクトリを候補として集める。候補があれば`AskUserQuestion`でcallerに選んでもらい、自分では選ばない。各選択肢の説明には、選んだ場合の`PREFIX`を書く
   - `$HOME`の配下にあり、`bin`で終わる
   - 書き込める (`[ -w <dir> ]`が真)
   - バージョンを切り替えたときに消えたり見えなくなったりしない。外すのは、バージョン管理ツール (mise・asdf・nvm・pyenv・rbenv等) のshimのディレクトリと、`installs`や`versions`の下のバージョン別ディレクトリ。言語のツールチェーンが共有で使うbin (`~/go/bin`・`~/.cargo/bin`等) は、ツールが書き足すだけで中身を消さないので残す。判断がつかないディレクトリは外さず、候補に残して、その旨を選択肢の説明に書く
4. 候補が無ければ`PREFIX=~/.local`にする。報告で、`~/.local/bin`がPATHに無いことと、PATHへの追加はcaller自身で行う必要があることを伝える

決めた入れ先と、どの段で決まったかを報告に書く。

### 3. インストールする

```sh
PREFIX=<決めたPREFIX> pnpm -C <repoのルート> run install-local
```

パイプを挟まずに実行し、終了コードを見る。成功は、終了コードが0で、出力に`installed <version> to <PREFIX>/bin/jev`の行があること。

成功の行以外に出る行は、次のように扱う。

- `note: <PREFIX>/bin is not in PATH` — 入れ先がPATHに無い。報告にそのまま書き写す (手順2の4段目で決めたときは想定内)
- `Reshimming mise …` — npmをmise経由で呼んだときに、miseが自分のshimを作り直している。想定内なので、報告には書かない
- `warning` / `error`を含む行 — 成功していても、報告に書き写す
- それ以外の行 (ビルドやnpmの進捗表示、`npm fund`の案内等) — 報告には書かない

入れ先に開発用のsymlink (repoの`dist/cli.js`を指すもの) があれば、スクリプトが消してから入れる。

スクリプトが次のどれかで止まったら、エラーの全文を報告して止める。回避策を自分で試さない (特に、既存の`jev`を消して入れ直すのは、callerが決めること)。

- 入れ先に、このスクリプトで入れたものではない`jev`が既にある
- ビルドに失敗した
- npmのインストールに失敗した

### 4. 入ったことを確かめる

- `<PREFIX>/bin/jev --version`が実行でき、repoの`package.json`の`version`と一致すること
- 入ったものが今のコードからビルドしたものであること。versionはコードを変えても変わらないので、repoの`dist/cli.js`と`<PREFIX>/lib/node_modules/jev-cli/dist/cli.js`を`cmp`で比べ、同じであることを確かめる
- `command -v jev`の出力を、文字列として`<PREFIX>/bin/jev`と比べる (`~`は展開して比べる。symlinkは解決しない)。結果は次の3通りで、どれだったかを報告に書く
  - 一致した → 入った`jev`がそのまま使える。`ls -l`での実体の確認はしない
  - 別の場所を指した → PATH上でそちらが先に来ている。その場所と、`ls -l`で見た実体 (ファイルかsymlinkか、symlinkならリンク先) を報告に書く。消すかどうかはcallerが決める
  - 何も返らない → 入れ先がPATHに無いか、shellがまだ反映していない。手順2の4段目で決めたならPATHへの追加が必要な旨、そうでなければ新しいshellを開くか`hash -r`を打てば見えるはずである旨を報告に書く

### 5. APIキーを確かめる

`<PREFIX>/bin/jev auth status`を実行し、終了コードで分ける。手順4の結果によってはPATHから`jev`が見えないので、入れた`jev`を絶対パスで呼ぶ。

- **0**: 出力 (キーをどこから読むか) をそのまま報告に書く。キーの値は出力に含まれない
- **3** (キーが見つからない): stderrは報告に写さず、「キーが見つからない」と要約する (stderrにはKeychainの方法も含まれるので、選ばなかった方法まで見せてしまう)。案内する方法を、次の条件で1つ選ぶ
  - macOSで、callerがKeychainを使わないと言っていない → **Keychain**。callerに自分の端末で`jev auth set`を打ってもらう。キーはプロンプトで入力され、Keychainに保存される
  - それ以外 (macOS以外、またはcallerがKeychainを断った) → **キーファイル**。repoのREADMEの「Key file」の節を名前で挙げ、その節のコマンド列だけを書き写して示す (節の前置きは写さない)。ファイルを作ってキーを貼るのはcaller自身に行ってもらう。`AI_GATEWAY_API_KEY_FILE`をどこでexportするかもcallerが決める

  どちらの場合も、案内したらcallerの返事を待つ。設定できたと返事が来たら、もう一度`jev auth status`を実行して0になることを確かめる
- **それ以外**: 出力の全文を報告して止める

## 報告

次を書く。

- 入れた場所 (`<PREFIX>/bin/jev`) と、手順2のどの段で決まったか
- `jev --version`の出力と、`cmp`で今のビルドと同じだったか
- `command -v jev`の結果。入れた場所と違えば、その旨
- `jev auth status`の結果 (キーの読み先)。キーを案内した場合は、案内した方法と、設定後に`status`が0になったか。callerの返事を待っているなら「未確認 (callerの設定待ち)」と書く
- 途中で止まった場合は、止まった手順とエラーの全文
