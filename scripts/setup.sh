#!/usr/bin/env bash
# Web アプリと tmux の自動起動・保存・復元をまとめて導入する。
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
for cmd in node npm tmux git systemctl loginctl; do
  command -v "$cmd" >/dev/null || { echo "$cmd が必要です。README.md の導入手順を確認してください" >&2; exit 1; }
done

"$REPO_DIR/scripts/install-service.sh"
"$REPO_DIR/scripts/install-persistence.sh"
"$REPO_DIR/scripts/resurrect-autosave.sh"
