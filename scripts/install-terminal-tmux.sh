#!/usr/bin/env bash
# ターミナルの種類を問わず、対話シェルを tmux に入れる。
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONF_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/tmux-web"
command -v tmux >/dev/null || { echo 'tmux が必要です' >&2; exit 1; }
mkdir -p "$CONF_DIR"
cp "$REPO_DIR/tmux/auto-start.sh" "$CONF_DIR/auto-start.sh"

add_hook() {
  local rc="$1"
  local marker='# tmux-web: terminal auto-start'
  if [ -f "$rc" ] && grep -Fxq "$marker" "$rc"; then
    return
  fi
  if [ -f "$rc" ]; then
    cp -p "$rc" "$rc.tmux-web-backup-$(date +%Y%m%d%H%M%S)"
  fi
  cat >> "$rc" <<'HOOK'

# tmux-web: terminal auto-start
if [ -r "${XDG_CONFIG_HOME:-$HOME/.config}/tmux-web/auto-start.sh" ]; then
    . "${XDG_CONFIG_HOME:-$HOME/.config}/tmux-web/auto-start.sh"
fi
HOOK
  printf 'tmux 自動起動を設定しました: %s\n' "$rc"
}

add_hook "$HOME/.bashrc"
add_hook "${ZDOTDIR:-$HOME}/.zshrc"
# 独自のログイン設定が .bashrc を読まない場合にも対応する。
for rc in "$HOME/.bash_profile" "$HOME/.bash_login"; do
  if [ -f "$rc" ]; then
    add_hook "$rc"
    break
  fi
done
printf '次に開くターミナル・タブ・分割から有効です。\n'
