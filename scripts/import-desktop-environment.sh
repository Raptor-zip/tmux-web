#!/usr/bin/env bash
# X11 ログイン後、起動済みの tmux-web に現在の画面接続情報を渡す。
# linger によりサービスが GUI ログインより先に起動する場合にも対応する。
set -euo pipefail

[[ -n "${DISPLAY:-}" && "${XDG_SESSION_TYPE:-}" != wayland ]] || exit 0

systemctl --user import-environment DISPLAY
if [[ -n "${XAUTHORITY:-}" ]]; then
  systemctl --user import-environment XAUTHORITY
else
  systemctl --user unset-environment XAUTHORITY
fi

# 停止中のサービスは勝手に起動しない。KillMode=process で tmux は維持される。
systemctl --user try-restart tmux-web.service
