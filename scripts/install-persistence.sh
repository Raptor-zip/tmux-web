#!/usr/bin/env bash
# tmux のセッションを再起動をまたいで残す仕組みを入れる。
#
#   ./scripts/install-persistence.sh
#
# やること:
#   1. tmux-resurrect / tmux-continuum を ~/.tmux/plugins/ に clone（TPM は使わない）
#   2. tmux/persistence.conf を ~/.config/tmux-web/persistence.conf に展開
#   3. ~/.tmux.conf にその 1 行を source-file として追記（既にあれば何もしない）
#
# 何度実行しても同じ結果になる。

set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PLUGIN_DIR="$HOME/.tmux/plugins"
CONF_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/tmux-web"
CONF_PATH="$CONF_DIR/persistence.conf"
MARKER="source-file $CONF_PATH"

say() { printf '\033[36m[persistence]\033[0m %s\n' "$*"; }
die() { printf '\033[31m[persistence] %s\033[0m\n' "$*" >&2; exit 1; }

command -v tmux >/dev/null || die "tmux が見つかりません"
command -v git  >/dev/null || die "git が見つかりません"

# --- 1. プラグイン ----------------------------------------------------------
mkdir -p "$PLUGIN_DIR"
clone_or_pull() {
  local name="$1" url="$2" dir="$PLUGIN_DIR/$1"
  if [ -d "$dir/.git" ]; then
    say "$name を更新します"
    git -C "$dir" pull --quiet --ff-only || say "$name の更新に失敗（既存のまま使います）"
  else
    say "$name を clone します"
    git clone --quiet --depth 1 "$url" "$dir"
  fi
}
clone_or_pull tmux-resurrect https://github.com/tmux-plugins/tmux-resurrect
clone_or_pull tmux-continuum https://github.com/tmux-plugins/tmux-continuum

# --- 2. 設定の展開 ----------------------------------------------------------
mkdir -p "$CONF_DIR" "$HOME/.local/share/tmux/resurrect"
sed "s|@@REPO_DIR@@|$REPO_DIR|g" "$REPO_DIR/tmux/persistence.conf" > "$CONF_PATH"
say "設定を書き出しました : $CONF_PATH"

# --- 3. ~/.tmux.conf への取り込み -------------------------------------------
TMUX_CONF="$HOME/.tmux.conf"
[ -f "${XDG_CONFIG_HOME:-$HOME/.config}/tmux/tmux.conf" ] && TMUX_CONF="${XDG_CONFIG_HOME:-$HOME/.config}/tmux/tmux.conf"

if [ -f "$TMUX_CONF" ] && grep -qF "$MARKER" "$TMUX_CONF"; then
  say "$TMUX_CONF には既に取り込み済みです"
elif [ -f "$TMUX_CONF" ] && grep -qE '^[^#]*(tmux-resurrect|tmux-continuum)' "$TMUX_CONF"; then
  # 手書きで同じ設定が入っている環境（このリポジトリの開発機など）。
  # 二重に run-shell すると保存フックが競合するので、追記しない。
  say "$TMUX_CONF に resurrect/continuum の設定が既にあります。追記しません"
  say "  リポジトリ側に寄せるなら、その行を消して次を足してください: $MARKER"
else
  say "$TMUX_CONF に source-file を追記します"
  {
    echo ""
    echo "# ---- tmux-web: セッションの保存と復元（scripts/install-persistence.sh が追記） ----"
    echo "$MARKER"
  } >> "$TMUX_CONF"
fi

# --- 反映 -------------------------------------------------------------------
if tmux info >/dev/null 2>&1; then
  tmux source-file "$TMUX_CONF" >/dev/null 2>&1 && say "動作中の tmux に反映しました" \
    || say "tmux への反映に失敗しました。手動で tmux source-file $TMUX_CONF を実行してください"
fi

cat <<EOS

  これで:
    ・15 分ごとに構成が自動保存されます（$HOME/.local/share/tmux/resurrect/）
    ・tmux サーバが次に起動したとき、自動で復元されます

  今すぐ保存    : ~/.tmux/plugins/tmux-resurrect/scripts/save.sh quiet
  手動で復元    : ~/.tmux/plugins/tmux-resurrect/scripts/restore.sh

EOS

# claude-sessions は agent-config 側のコマンド。無くてもフックは黙って先へ進む。
if command -v claude-sessions >/dev/null; then
  echo "  claude の会話 : claude-sessions --last --tmux"
else
  echo "  claude の会話を復元したいなら agent-config の bin/claude-sessions を PATH に置いてください"
  echo "  https://github.com/Raptor-zip/agent-config （無くても保存・復元は動きます）"
fi
echo
