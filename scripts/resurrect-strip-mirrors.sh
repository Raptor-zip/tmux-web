#!/usr/bin/env bash
# tmux-resurrect の保存ファイルから tmux-web のミラーセッション（webmux-*）を取り除く。
#
# tmux-web はブラウザから attach するとき、対象と同じグループにミラーセッションを作る。
# グループを共有するセッションは resurrect には「原本 1 つ + grouped_session 参照」として
# 保存されるが、どちらが原本になるかは決まっていない。ミラーが原本側になった場合、
# 単に webmux- の行を消すと実セッションが参照先を失って復元できなくなる。
#
# そこで、ミラーが原本なら名前を実セッション名に書き換えたうえで grouped_session を落とす。
# ミラーが参照側なら行ごと落とす。
#
#   resurrect-strip-mirrors.sh [保存ファイル]   # 既定は ~/.local/share/tmux/resurrect/last

set -euo pipefail

f="${1:-$HOME/.local/share/tmux/resurrect/last}"
[ -e "$f" ] || exit 0
f="$(readlink -f "$f")"
[ -f "$f" ] || exit 0

awk -F'\t' -v OFS='\t' '
  # 1 周目: ミラーが原本になっている組を控える（ミラー名 -> 実セッション名）
  NR == FNR {
    if ($1 == "grouped_session" && $3 ~ /^webmux-/) real[$3] = $2
    next
  }
  # 2 周目
  {
    if (($1 == "pane" || $1 == "window") && ($2 in real)) $2 = real[$2]
    if ($1 == "grouped_session" && $3 ~ /^webmux-/) next   # 参照は不要になった
    if ($2 ~ /^webmux-/) next                              # 残りのミラーは捨てる
    print
  }
' "$f" "$f" > "$f.tmp" && mv "$f.tmp" "$f"
