#!/usr/bin/env bash
# tmux-resurrect の保存ファイルから、シェルしか動いていないウィンドウを取り除く。
#
# resurrect はウィンドウを全部保存して全部戻す。一方で claude などのエージェントは
# 復元の対象外（勝手に起こさない）なので、再起動するたびに昔のウィンドウが素の bash で
# 戻ってきて、使われないまま何十枚も溜まっていく。
#
# そこで保存の時点で、全ペインがシェルだけ（子プロセスなし）のウィンドウを落とす。
# 次の再起動で戻ってくるのは、保存したときに何かが動いていたウィンドウだけになる。
# エージェントの会話そのものは claude-sessions の復元リストで追える。
#
# セッションのウィンドウが全部未使用のときは、アクティブな 1 枚だけ残す。
# セッションごと消すと、それを原本にしているグループのセッションが復元できなくなるため。
#
#   resurrect-strip-idle.sh [保存ファイル]   # 既定は ~/.local/share/tmux/resurrect/last

set -euo pipefail

f="${1:-$HOME/.local/share/tmux/resurrect/last}"
[ -e "$f" ] || exit 0
f="$(readlink -f "$f")"
[ -f "$f" ] || exit 0

awk -F'\t' -v OFS='\t' '
  BEGIN {
    split("bash zsh fish sh dash ksh tcsh csh ash nu xonsh elvish", s, " ")
    for (i in s) shell[s[i]] = 1
  }
  # 1 周目: ウィンドウごとに「全ペインがシェルだけか」を決める
  NR == FNR {
    if ($1 == "pane") {
      key = $2 SUBSEP $3
      if (!(key in idle)) idle[key] = 1
      # $10 = pane_current_command, $11 = ":" + 子プロセスのコマンド行（無ければ ":" だけ）
      cmd = $10; sub(/^-/, "", cmd)
      if (!(cmd in shell) || $11 != ":") idle[key] = 0
    } else if ($1 == "window") {
      key = $2 SUBSEP $3
      if (!($2 in first) || $3 + 0 < first[$2] + 0) first[$2] = $3
      if ($5 == "1") active[$2] = $3
    }
    next
  }
  # 2 周目の頭で、全部未使用になるセッションに残す 1 枚を決める
  FNR == 1 {
    for (key in idle) {
      split(key, k, SUBSEP)
      if (!idle[key]) alive[k[1]] = 1
    }
    for (sess in first) {
      if (sess in alive) continue
      keep[sess SUBSEP ((sess in active) ? active[sess] : first[sess])] = 1
    }
  }
  {
    if ($1 == "pane" || $1 == "window") {
      key = $2 SUBSEP $3
      if ((key in idle) && idle[key] && !(key in keep)) { dropped[key] = 1; next }
    }
    print
  }
  END {
    n = 0
    for (key in dropped) n++
    if (n) printf "resurrect-strip-idle: %d 枚の未使用ウィンドウを保存から外しました\n", n > "/dev/stderr"
  }
' "$f" "$f" > "$f.tmp" && mv "$f.tmp" "$f"
