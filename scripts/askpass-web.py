#!/usr/bin/env python3
"""SUDO_ASKPASS ヘルパー。パスワードを、この PC の画面ではなくスマホから受け取る。

sudo が呼ぶ  →  tmux-webに「いま何に sudo が要るか」を登録  →  スマホに出る
           →  入力されたものを標準出力へ  →  sudo が直接読む

取り扱いの原則（変更するときは必ず守ること）:
  - 受け取ったパスワードは bytes のまま標準出力へ流すだけ。
    ファイルにも環境変数にもログにも書かない。
  - 標準出力は sudo が自分の子プロセスとして直接読む。
    人が見る案内はすべて標準エラーへ出す（そちらは sudo に渡らない）。
  - 失敗・取り消しのときは標準出力に一切書かずに終了する
    （空文字を出すと「間違ったパスワード」として扱われてしまうため）。

呼び出し元（sudo-web.sh または sudo-gui.sh --web）が渡す環境変数:
  SUDO_GUI_CMD / SUDO_GUI_CWD / SUDO_GUI_DETAIL / SUDO_GUI_ATTEMPT_FILE
"""

import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request

BASE = os.environ.get("TMUX_WEB_URL", "http://127.0.0.1:7654").rstrip("/")
TIMEOUT = 180  # tmux-web側の期限(150秒)より少しだけ長く待つ


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


# sudo のパスワードはこの PC の tmux-web からだけ受け取る。
OPENER = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())


def valid_base() -> bool:
    try:
        url = urllib.parse.urlsplit(BASE)
        return (url.scheme == "http" and url.hostname in {"127.0.0.1", "::1", "localhost"}
                and url.username is None and url.port != 0
                and not (url.path or url.query or url.fragment))
    except ValueError:
        return False


def note(msg: str) -> None:
    """人向けの案内。sudo が読む標準出力を汚さないよう標準エラーへ。"""
    print(msg, file=sys.stderr, flush=True)


def bump_attempt() -> int:
    """sudo はパスワードを間違えるたびに askpass を呼び直す。その回数を数える。"""
    path = os.environ.get("SUDO_GUI_ATTEMPT_FILE")
    if not path:
        return 1
    try:
        with open(path, "r+") as f:
            n = int((f.read() or "0").strip() or "0") + 1
            f.seek(0)
            f.truncate()
            f.write(str(n))
        return n
    except FileNotFoundError:
        try:
            with open(path, "w") as f:
                f.write("1")
        except OSError:
            pass
        return 1
    except (OSError, ValueError):
        return 1


def post_json(path: str, payload: dict) -> dict:
    req = urllib.request.Request(
        BASE + path,
        data=json.dumps(payload).encode("utf-8"),
        headers={"content-type": "application/json"},
        method="POST",
    )
    with OPENER.open(req, timeout=15) as res:
        return json.loads(res.read().decode("utf-8"))


def main() -> int:
    if not valid_base():
        note("TMUX_WEB_URL にこのPCのループバックURLとポートを指定してください（例: http://127.0.0.1:7654）。")
        return 1
    attempt = bump_attempt()

    try:
        created = post_json(
            "/api/approvals/request",
            {
                "cmd": os.environ.get("SUDO_GUI_CMD", "(不明)"),
                "cwd": os.environ.get("SUDO_GUI_CWD", os.getcwd()),
                "detail": os.environ.get("SUDO_GUI_DETAIL", ""),
                "attempt": attempt,
            },
        )
        query = urllib.parse.urlencode({"id": created["id"], "claim": created["claim"]})
    except urllib.error.HTTPError as e:
        messages = {
            400: "コマンドまたは作業フォルダーを承認画面に表示できません。",
            409: "別の sudo 要求が承認待ちです。処理が終わってから再実行してください。",
        }
        note(messages.get(e.code, f"tmux-web が sudo 要求を受け付けませんでした（HTTP {e.code}）。"))
        return 1
    except (OSError, ValueError, KeyError, TypeError):
        note(f"tmux-webに接続できません（{BASE}）。systemctl --user status tmux-web を確認してください。")
        return 1

    note("")
    note("  tmux-webに sudo のパスワード要求を出しました。")
    note("  スマホでtmux-webを開き、「sudo 承認待ち」の通知から承認してください。")
    if attempt > 1:
        note(f"  （{attempt} 回目。前回のパスワードは違っていました）")
    note("")

    try:
        with OPENER.open(f"{BASE}/api/approvals/wait?{query}", timeout=TIMEOUT) as res:
            if res.status != 200:
                note("入力されませんでした。")
                return 1
            secret = res.read(12289)
    except urllib.error.HTTPError:
        note("取り消されたか、期限切れです。")
        return 1
    except OSError:
        note("待っている間にtmux-webとの通信が切れました。")
        return 1

    if not secret or len(secret) > 12288 or any(ch in secret for ch in (b"\x00", b"\r", b"\n")):
        note("パスワードを受け取れませんでした。")
        return 1

    # ここだけが標準出力への書き込み。sudo がこのパイプを直接読む。
    sys.stdout.buffer.write(secret)
    sys.stdout.buffer.write(b"\n")
    sys.stdout.buffer.flush()
    del secret
    return 0


if __name__ == "__main__":
    sys.exit(main())
