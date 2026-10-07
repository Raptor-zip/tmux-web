#!/usr/bin/env bash
# 既存の tmux を触らず、未起動のときだけ起動する。
# 設定から continuum が読み込まれ、保存済みの構成が自動復元される。
set -euo pipefail

if tmux list-sessions >/dev/null 2>&1; then
  exit 0
fi

# resurrect は復元時に、起動用のセッション 0 を片付ける。
tmux new-session -d -s 0 -c "$HOME"
