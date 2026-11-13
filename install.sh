#!/usr/bin/env bash
# 新規導入と更新の対話式エントリーポイント。
set -Eeuo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
UNIT_PATH="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user/tmux-web.service"
STEP='準備'
MODE=''
UPDATE_CODE=1
RESUME=''

say() { printf '\n%s\n' "$*"; }
die() { printf '\n%s\n' "$*" >&2; exit 1; }
trap 'code=$?; printf "\n「%s」で停止しました。上のエラーを確認し、修正後に ./install.sh を再実行してください。\n" "$STEP" >&2; exit "$code"' ERR
trap 'printf "\n中止しました。\n" >&2; exit 130' INT

answer() {
  if ! IFS= read -r REPLY; then
    die '入力が終了したため中止しました。ターミナルで ./install.sh を実行してください。'
  fi
}

confirm() {
  local prompt="$1" default="$2"
  while true; do
    printf '%s [%s] ' "$prompt" "$default"
    answer
    case "${REPLY:-${default:0:1}}" in
      y|Y|yes|YES) return 0 ;;
      n|N|no|NO) return 1 ;;
      *) printf 'y（はい）か n（いいえ）を入力してください。\n' ;;
    esac
  done
}

main() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --help|-h)
        printf '使い方: ./install.sh [--no-update]\n\n新規導入・更新を案内します。Enterで推奨の選択肢を選べます。\n--no-update: Gitから取得せず、現在のコードを適用します。\n'
        return ;;
      --no-update) UPDATE_CODE=0; shift ;;
      --mode)
        [[ $# -ge 2 ]] || die '--mode の値がありません。'
        MODE="$2"; shift 2 ;;
      --resume)
        [[ $# -ge 2 && "$2" =~ ^[01],[01],[01],[01]$ ]] || die '継続する設定の形式が不正です。'
        RESUME="$2"; shift 2 ;;
      *) die "不明なオプション: $1（./install.sh --help を参照）" ;;
    esac
  done
  [[ "$MODE" == '' || "$MODE" == update || "$MODE" == setup ]] || die '不明な処理です。'
  [[ "$EUID" -ne 0 ]] || die 'sudoを付けず、利用するユーザーで ./install.sh を実行してください。'
  cd "$REPO_DIR"
  say 'tmux-web セットアップウィザード'
  printf 'Enterで推奨の選択肢を選べます。Ctrl+Cで中止できます。\n'
  if [[ -z "$MODE" ]]; then
    if [[ -f "$UNIT_PATH" ]]; then
      printf '\n導入済みの環境が見つかりました。\n  1) 最新版に更新する（推奨）\n  2) 機能の追加・セットアップを行う\n'
      while true; do
        printf '選択 [1]: '; answer
        case "${REPLY:-1}" in
          1) MODE=update; break ;;
          2) MODE=setup; break ;;
          *) printf '1か2を入力してください。\n' ;;
        esac
      done
    else
      MODE=setup
      say '新規インストールを案内します。'
    fi
  fi

  local desktop=0 terminal=0 persistence=0 serve=0
  if [[ -n "$RESUME" ]]; then
    IFS=, read -r desktop terminal persistence serve <<< "$RESUME"
  elif [[ "$MODE" == setup ]]; then
    confirm 'リモートデスクトップを使いますか？' Y/n && desktop=1
    confirm '新しく開くターミナルを自動でtmuxに入れますか？' y/N && terminal=1
    confirm 'PC再起動時にtmuxの構成を保存・復元しますか？' Y/n && persistence=1
    confirm 'Tailscale経由でPC・スマホから接続できるようにしますか？' Y/n && serve=1
  fi
  say '実行する内容'
  if [[ "$UPDATE_CODE" == 1 ]]; then printf '  ・Gitの設定済み追跡先から最新版を取得\n'; fi
  printf '  ・依存関係の同期・画面のビルド・サービスの起動確認\n'
  if [[ "$MODE" == update ]]; then
    [[ -f "$UNIT_PATH" ]] || die '更新対象がありません。オプションなしで実行してください。'
    printf '  ・既存のサービス設定を維持して再起動\n'
  else
    printf '  ・Webアプリの自動起動を設定\n'
    [[ "$desktop" == 0 ]] || printf '  ・リモートデスクトップの必要パッケージを確認・導入\n'
    [[ "$terminal" == 0 ]] || printf '  ・シェルのtmux自動起動を設定（既存設定はバックアップ）\n'
    [[ "$persistence" == 0 ]] || printf '  ・tmuxの構成の保存・復元を設定\n'
    [[ "$serve" == 0 ]] || printf '  ・Tailscale ServeでHTTPS接続を設定\n'
  fi
  if [[ -z "$RESUME" ]]; then
    confirm 'この内容で進めますか？' Y/n || { say '中止しました。'; return; }
  fi

  STEP='動作環境の確認'
  local cmd
  for cmd in git node npm systemctl loginctl; do
    command -v "$cmd" >/dev/null || die "$cmd がありません。導入後に再実行してください（Node.jsは20以上が必要です）。"
  done
  node -e 'if (Number(process.versions.node.split(".")[0]) < 20) process.exit(1)' || die 'Node.js 20以上に更新してから再実行してください。'
  systemctl --user show-environment >/dev/null 2>&1 || die 'systemdのユーザーセッションが利用できません。通常のログインユーザーのターミナルで実行してください。'
  if [[ "$serve" == 1 ]]; then
    command -v tailscale >/dev/null || die 'Tailscaleが未導入です。README.md の「Tailscale 経由でスマホから使う」を確認して導入し、再実行してください。'
  fi

  if [[ "$UPDATE_CODE" == 1 ]]; then
    STEP='最新版の取得'
    # ローカルの変更・独自コミットを自動でstash/reset/mergeしない。
    [[ -z "$(git status --porcelain)" ]] || die 'このフォルダーに未コミットの変更があります。変更を保存してから再実行するか、./install.sh --no-update で現在のコードを適用してください。'
    git rev-parse --abbrev-ref --symbolic-full-name '@{upstream}' >/dev/null 2>&1 || die 'Gitの追跡先が未設定です。./install.sh --no-update なら現在のコードを適用できます。'
    local previous
    previous="$(git rev-parse HEAD)"
    git pull --ff-only
    if [[ "$previous" != "$(git rev-parse HEAD)" ]]; then
      # Bashが実行途中のファイル差し替えを読み込まないよう、更新後を起動。
      say '最新版のウィザードに切り替えます。'
      exec bash "$REPO_DIR/install.sh" --no-update --mode "$MODE" --resume "$desktop,$terminal,$persistence,$serve"
    fi
  fi

  STEP='必要パッケージの確認'
  local packages=()
  command -v tmux >/dev/null || packages+=(tmux)
  if [[ "$desktop" == 1 ]]; then
    command -v x11vnc >/dev/null || packages+=(x11vnc)
    command -v xrandr >/dev/null || packages+=(x11-xserver-utils)
    command -v xclip >/dev/null || packages+=(xclip)
  fi
  if [[ ${#packages[@]} -gt 0 ]]; then
    command -v apt-get >/dev/null || die "不足パッケージ: ${packages[*]}。このOSのパッケージ管理で導入して再実行してください。"
    say "必要なパッケージを導入します: ${packages[*]}"
    confirm '管理者権限で導入しますか？' Y/n || die 'パッケージの導入を中止しました。'
    sudo apt-get update
    sudo apt-get install -y "${packages[@]}"
  fi

  if [[ "$MODE" == update ]]; then
    STEP='依存関係の同期'; say '依存関係を準備しています…'; npm ci
    STEP='画面のビルド'; say '画面をビルドしています…'; npm run build
    STEP='サービスの更新'
    bash "$REPO_DIR/scripts/import-desktop-environment.sh" --import-only
    systemctl --user restart tmux-web.service
  else
    STEP='自動起動の設定'; bash "$REPO_DIR/scripts/install-service.sh"
    if [[ "$terminal" == 1 ]]; then
      STEP='ターミナルの設定'; bash "$REPO_DIR/scripts/install-terminal-tmux.sh"
    fi
    if [[ "$persistence" == 1 ]]; then
      STEP='tmuxの保存・復元の設定'; bash "$REPO_DIR/scripts/install-persistence.sh"
      bash "$REPO_DIR/scripts/resurrect-autosave.sh"
    fi
    if [[ "$serve" == 1 ]]; then
      STEP='Tailscaleの接続設定'
      if ! tailscale status --json | node -e 'let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>{try{process.exit(JSON.parse(s).BackendState === "Running" ? 0 : 1)}catch{process.exit(1)}})'; then
        say 'Tailscaleにログインします。表示されるURLの案内に従ってください。'
        sudo tailscale up
      fi
      bash "$REPO_DIR/scripts/tailscale-serve.sh"
    fi
  fi

  STEP='起動確認'
  local ready=0 i
  for i in {1..10}; do
    if systemctl --user is-active --quiet tmux-web.service; then ready=1; break; fi
    sleep 1
  done
  [[ "$ready" == 1 ]] || { systemctl --user status tmux-web.service --no-pager -l || true; die '起動を確認できませんでした。journalctl --user -u tmux-web -n 40 でログを確認してください。'; }
  say '完了しました。ブラウザを再読み込みしてください。'
  if command -v tailscale >/dev/null; then
    local url
    url="$(bash "$REPO_DIR/scripts/tailscale-serve.sh" url 2>/dev/null)" || url=''
    [[ -z "$url" ]] || printf '\n接続先（Tailscale Serve設定済みの場合）: %s\n' "$url"
  fi
  printf '\n次回の更新も、このフォルダーで ./install.sh を実行するだけです。\n'
}

main "$@"
