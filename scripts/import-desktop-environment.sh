#!/usr/bin/env bash
# X11 ログイン後、起動済みの tmux-web に現在の画面接続情報を渡す。
# linger によりサービスが GUI ログインより先に起動する場合にも対応する。
set -euo pipefail

case "${1:-}" in
  ''|--import-only) ;;
  *) echo "Usage: $0 [--import-only]" >&2; exit 2 ;;
esac

[[ -n "${DISPLAY:-}" ]] || exit 0
# XRDP also reports Type=x11 and Remote=no, but has no physical seat.
# Its autostart must not replace the monitor session's DISPLAY with :10.
seat=$(loginctl show-session "${XDG_SESSION_ID:-auto}" --property=Seat --value 2>/dev/null) || exit 0
type=$(loginctl show-session "${XDG_SESSION_ID:-auto}" --property=Type --value 2>/dev/null) || exit 0
[[ -n "$seat" && "$type" == x11 ]] || exit 0

systemctl --user import-environment DISPLAY
if [[ -n "${XAUTHORITY:-}" ]]; then
  systemctl --user import-environment XAUTHORITY
else
  systemctl --user unset-environment XAUTHORITY
fi

# 停止中のサービスは勝手に起動しない。KillMode=process で tmux は維持される。
if [[ "${1:-}" != --import-only ]]; then
  systemctl --user try-restart tmux-web.service
fi
