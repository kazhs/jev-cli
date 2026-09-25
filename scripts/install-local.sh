#!/bin/sh
# jev を <PREFIX>/bin に入れる (既定の PREFIX は ~/.local)。
# repo をビルドして tarball に固め、npm の --prefix で入れるので、入れたあとは repo の場所や node_modules に依存しない。
#
# usage:
#   sh scripts/install-local.sh              ビルドして入れる (入れ直しも同じ)
#   sh scripts/install-local.sh uninstall    外す
#   PREFIX=/opt/jev sh scripts/install-local.sh
set -eu

PREFIX="${PREFIX:-$HOME/.local}"
REPO="$(cd "$(dirname "$0")/.." && pwd -P)"
BIN="$PREFIX/bin/jev"

# 開発中に張った repo の dist/cli.js への symlink が残っていると、npm が同じ場所にリンクを作れない。
# repo を指すものだけを消し、それ以外のファイルがあるときは上書きせず止める
remove_dev_symlink() {
  [ -e "$BIN" ] || [ -L "$BIN" ] || return 0
  if [ -L "$BIN" ]; then
    target="$(readlink "$BIN")"
    case "$target" in
      "$REPO"/*)
        rm "$BIN"
        echo "removed the development symlink $BIN -> $target"
        return 0
        ;;
      ../lib/node_modules/jev-cli/*)
        return 0 # 前回このスクリプトで入れたもの。npm が入れ直す
        ;;
    esac
  fi
  echo "error: $BIN already exists and was not installed by this script; remove it first" >&2
  exit 1
}

if [ "${1:-}" = "uninstall" ]; then
  npm uninstall -g --prefix "$PREFIX" jev-cli
  echo "uninstalled jev from $PREFIX"
  exit 0
fi
if [ $# -gt 0 ]; then
  echo "usage: sh scripts/install-local.sh [uninstall]" >&2
  exit 2
fi

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

remove_dev_symlink
pnpm -C "$REPO" build
pnpm -C "$REPO" pack --pack-destination "$WORK" >/dev/null
npm install -g --prefix "$PREFIX" "$WORK"/jev-cli-*.tgz

echo "installed $("$BIN" --version) to $BIN"
case ":$PATH:" in
  *":$PREFIX/bin:"*) ;;
  *) echo "note: $PREFIX/bin is not in PATH" ;;
esac
