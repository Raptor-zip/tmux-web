#!/usr/bin/env bash
# tmux-resurrect の保存を、status バーに依存せず外から叩く。
#
#   ./scripts/resurrect-autosave.sh
#
# なぜ必要か:
#   tmux-continuum の自動保存は status-right の #() 展開で駆動する。ところが tmux-web は
#   ブラウザ用のミラーセッションを `status off` で作る（ブラウザ側が独自のツールバーを
#   描くため）。端末から status 付きで attach していない＝ブラウザだけで使っている間は
#   status-right が一度も評価されず、自動保存が丸ごと止まる。
#   そこで systemd --user のタイマーからこのスクリプトを定期実行する。
#
# tmux サーバが動いていなければ何もしない（保存すべき構成が無い）。

set -euo pipefail

tmux info >/dev/null 2>&1 || exit 0

SAVE="$HOME/.tmux/plugins/tmux-resurrect/scripts/save.sh"
[ -x "$SAVE" ] || { echo "tmux-resurrect が見つかりません: $SAVE" >&2; exit 1; }

exec "$SAVE" quiet
