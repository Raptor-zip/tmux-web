#!/bin/sh
# スマホから承認して sudo を実行する。
#
#   sudo-web.sh apt-get install -y foo
#   sudo-web.sh bash /tmp/root-work.sh      # 引数がファイルなら本文もプレビュー表示する
#
# 実行されるコマンドはスマホ側の画面にそのまま出るので、
# 何を許可するのかを見てから承認・拒否できる。
# パスワードは askpass ヘルパーの標準出力を sudo が直接読む。
# このスクリプトも Claude もパスワードを受け取らない。
#
# 机の前にいるときは、同じ内容を PC 側のダイアログで承認する
# gui-sudo-askpass スキルの sudo-gui.sh を使う。
set -eu

if [ $# -lt 1 ]; then
	echo "usage: $(basename "$0") <command> [args...]" >&2
	exit 2
fi

DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
ASKPASS="$DIR/askpass-web.py"

if [ ! -x "$ASKPASS" ]; then
	echo "askpass ヘルパーが実行可能ではありません: $ASKPASS" >&2
	echo "  chmod +x '$ASKPASS' を実行してください" >&2
	exit 1
fi

# 表示用にコマンドを組み立てる。空白や記号を含む引数は引用して、
# 実際に走るものとスマホ側の表示が食い違わないようにする。
cmd=""
for a in "$@"; do
	case "$a" in
	*[!A-Za-z0-9._/=:@,+-]* | "")
		quoted="'$(printf '%s' "$a" | sed "s/'/'\\\\''/g")'"
		;;
	*)
		quoted="$a"
		;;
	esac
	cmd="${cmd:+$cmd }$quoted"
done

# `bash script.sh` のようにスクリプトを渡す使い方だと、コマンド行だけでは
# 何が実行されるか分からない。引数が実在するファイルならその中身を見せる。
PREVIEW_LINES=40
detail=""
for a in "$@"; do
	[ -f "$a" ] || continue
	body=$(sed -n "1,${PREVIEW_LINES}p" -- "$a" 2>/dev/null) || continue
	total=$(wc -l <"$a" 2>/dev/null || echo 0)
	detail="$detail

── $a ──
$body"
	if [ "$total" -gt "$PREVIEW_LINES" ]; then
		detail="$detail
… (残り $((total - PREVIEW_LINES)) 行)"
	fi
done

# パスワードを間違えても 1 回で諦めない。
# sudo -A は sudoers の passwd_tries（既定 3）まで askpass を呼び直すので、
# ここは 1 回叩くだけでよい。認証と実行を別呼び出しに分けると
# timestamp キャッシュを共有できずに失敗する環境がある。
# ATTEMPT_FILE は askpass 側が呼ばれるたびに数えるカウンタで、
# 2 回目以降は「前回は間違っていた」とスマホ側に表示される。
ATTEMPT_FILE=$(mktemp)
trap 'rm -f "$ATTEMPT_FILE"' EXIT

SUDO_ASKPASS="$ASKPASS" \
	SUDO_GUI_CMD="$cmd" \
	SUDO_GUI_CWD="$PWD" \
	SUDO_GUI_DETAIL="$detail" \
	SUDO_GUI_ATTEMPT_FILE="$ATTEMPT_FILE" \
	sudo -A -- "$@"
