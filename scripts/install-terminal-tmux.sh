#!/usr/bin/env bash
# ターミナルの種類を問わず、対話シェルを tmux に入れる。
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONF_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/tmux-web"
command -v tmux >/dev/null || { echo 'tmux が必要です' >&2; exit 1; }
mkdir -p "$CONF_DIR"
cp "$REPO_DIR/tmux/auto-start.sh" "$CONF_DIR/auto-start.sh"
cp "$REPO_DIR/tmux/terminal.conf" "$CONF_DIR/terminal.conf"

# 個人設定は残し、スクロール設定だけを末尾から取り込む。
TMUX_CONF="$HOME/.tmux.conf"
[ -f "${XDG_CONFIG_HOME:-$HOME/.config}/tmux/tmux.conf" ] && TMUX_CONF="${XDG_CONFIG_HOME:-$HOME/.config}/tmux/tmux.conf"
CONF_PATH="$CONF_DIR/terminal.conf"
# tmux の二重引用符内でも安全なパスにする（空白・$ などを含む HOME に対応）。
QUOTED_PATH="${CONF_PATH//\\/\\\\}"
QUOTED_PATH="${QUOTED_PATH//\"/\\\"}"
QUOTED_PATH="${QUOTED_PATH//\$/\\\$}"
SOURCE_LINE="source-file \"$QUOTED_PATH\""
if ! [ -f "$TMUX_CONF" ] || ! grep -Fxq "$SOURCE_LINE" "$TMUX_CONF"; then
  if [ -f "$TMUX_CONF" ]; then
    cp -p "$TMUX_CONF" "$TMUX_CONF.tmux-web-backup-$(date +%Y%m%d%H%M%S)"
  fi
  printf '\n# tmux-web: terminal scrolling\n%s\n' "$SOURCE_LINE" >> "$TMUX_CONF"
fi

# 全設定の再読込は復元プラグインまで再実行するので、この設定だけ反映する。
tmux_args=()
[ -z "${TMUX_WEB_SOCKET_NAME:-}" ] || tmux_args+=(-L "$TMUX_WEB_SOCKET_NAME")
[ -z "${TMUX_WEB_SOCKET_PATH:-}" ] || tmux_args+=(-S "$TMUX_WEB_SOCKET_PATH")
if tmux "${tmux_args[@]}" list-sessions >/dev/null 2>&1; then
  tmux "${tmux_args[@]}" source-file "$CONF_PATH"
  printf '動作中の tmux にスクロール設定を反映しました。\n'
fi
printf 'tmux スクロール設定を導入しました: %s\n' "$TMUX_CONF"

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
printf '自動起動は次に開くターミナル・タブ・分割から有効です。\n'
