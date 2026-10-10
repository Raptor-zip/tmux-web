# bash / zsh の起動ファイルから source する。端末ごとに独立したセッションを作る。
case $- in
  *i*) ;;
  *) return ;;
esac

# スクリプト、tmux 内のシェル、明示的な -c コマンドでは起動しない。
if [ "${TMUX_WEB_AUTO_START:-1}" = 0 ] ||
   [ -n "${BASH_EXECUTION_STRING:-}${ZSH_EXECUTION_STRING:-}" ] ||
   [ ! -t 0 ] || [ ! -t 1 ] || [ "${TERM:-dumb}" = dumb ]; then
  return
fi
command -v "${TMUX_WEB_TMUX_BIN:-tmux}" >/dev/null 2>&1 || return

_tmux_web_auto_start() {
  # tmux から GUI 端末を起動すると TMUX / TMUX_PANE だけが引き継がれる。
  # 同じ tty のシェルだけを「tmux 内」と判断し、新しい GUI 端末は自動起動する。
  if [ -n "${TMUX:-}" ] && [ -n "${TMUX_PANE:-}" ] &&
     [ "$("${TMUX_WEB_TMUX_BIN:-tmux}" display-message -p -t "$TMUX_PANE" '#{pane_tty}' 2>/dev/null)" = "$(tty)" ]; then
    return
  fi
  set --
  if [ -n "${TMUX_WEB_SOCKET_NAME:-}" ]; then
    set -- "$@" -L "$TMUX_WEB_SOCKET_NAME"
  fi
  if [ -n "${TMUX_WEB_SOCKET_PATH:-}" ]; then
    set -- "$@" -S "$TMUX_WEB_SOCKET_PATH"
  fi
  # 既存セッションへの attach は別のタブと表示を共有してしまうため使わない。
  # 接続失敗時は元のシェルを残し、正常に detach / exit したときだけ端末を閉じる。
  if TMUX= TMUX_PANE= "${TMUX_WEB_TMUX_BIN:-tmux}" "$@" new-session -c "$PWD"; then
    exit
  fi
}
_tmux_web_auto_start
unset -f _tmux_web_auto_start
