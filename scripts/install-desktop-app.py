#!/usr/bin/env python3
"""Install tmux web as a user-level Ubuntu app and optionally pin it to GNOME Dock."""
import argparse
import ast
import json
import os
from pathlib import Path
import shlex
import shutil
import subprocess
import urllib.parse
import urllib.request


def desktop_quote(value):
    # Exec is parsed by the desktop-entry launcher, not a shell.
    value = value.replace('%', '%%').replace('\\', '\\\\\\\\').replace('"', '\\\\\\"').replace('`', '\\\\`').replace('$', '\\\\$')
    return '"' + value + '"'


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--url', help='Tailscale Serve HTTPS URL (default: this PC, port 8443)')
    parser.add_argument('--browser', help='Chromium browser executable')
    parser.add_argument('--no-pin', action='store_true', help='Do not add to GNOME favourites')
    parser.add_argument('--launch', action='store_true', help='Open the new app after installation')
    args = parser.parse_args()
    repo = Path(__file__).resolve().parent.parent
    if args.url:
        url = args.url
    else:
        status = json.loads(subprocess.check_output(['tailscale', 'status', '--json'], text=True))
        host = status['Self']['DNSName'].rstrip('.')
        url = f'https://{host}:8443/'
    parsed = urllib.parse.urlsplit(url)
    if parsed.scheme != 'https' or not parsed.hostname or not parsed.hostname.endswith('.ts.net') or parsed.username or parsed.password or parsed.query or parsed.fragment or parsed.path not in ('', '/'):
        parser.error('--url must be a Tailscale HTTPS URL without a path, query or credentials')
    url = urllib.parse.urlunsplit((parsed.scheme, parsed.netloc, '/', '', ''))
    browsers = [args.browser] if args.browser else ['google-chrome', 'google-chrome-stable', 'brave-browser', 'brave-browser-beta', 'chromium', 'chromium-browser', 'microsoft-edge']
    browser = next((shutil.which(name) for name in browsers if name and shutil.which(name)), None)
    if not browser:
        parser.error('Chrome, Brave or another Chromium browser is required')
    data = Path(os.environ.get('XDG_DATA_HOME', Path.home() / '.local/share'))
    config = data / 'tmux-web'
    applications = data / 'applications'
    config.mkdir(parents=True, exist_ok=True)
    applications.mkdir(parents=True, exist_ok=True)
    icon = config / 'icon-512.png'
    try:
        with urllib.request.urlopen(url + 'icon-512.png', timeout=5) as response:
            image = response.read(2 * 1024 * 1024)
        if not image.startswith(b'\x89PNG\r\n\x1a\n'):
            raise ValueError('invalid app icon')
        icon.write_bytes(image)
    except Exception:
        shutil.copyfile(repo / 'web/public/icon-512.png', icon)
    launcher = config / 'launch.sh'
    launcher.write_text('#!/bin/sh\nexec ' + shlex.join([browser, '--app=' + url, '--class=tmux-web']) + ' "$@"\n')
    launcher.chmod(0o755)
    entry = applications / 'tmux-web.desktop'
    entry.write_text('\n'.join([
        '[Desktop Entry]', 'Version=1.0', 'Type=Application', 'Name=tmux web',
        'Comment=PC・DGX Sparkの端末と仮想デスクトップ',
        'Exec=' + desktop_quote(str(launcher)), 'TryExec=' + browser, 'Icon=' + str(icon),
        'Terminal=false', 'StartupNotify=true', 'StartupWMClass=' + parsed.hostname,
        'Categories=Development;', 'Keywords=tmux;terminal;Spark;', '',
    ]))
    entry.chmod(0o755)
    if shutil.which('desktop-file-validate'):
        subprocess.run(['desktop-file-validate', str(entry)], check=True)
    if shutil.which('update-desktop-database'):
        subprocess.run(['update-desktop-database', str(applications)], check=False, capture_output=True)
    print(f'アプリ一覧に登録しました: {entry}')
    print(f'接続先: {url}')
    if not args.no_pin and shutil.which('gsettings'):
        try:
            result = subprocess.check_output(['gsettings', 'get', 'org.gnome.shell', 'favorite-apps'], text=True).strip()
            favourites = ast.literal_eval(result.removeprefix('@as '))
            if not isinstance(favourites, list) or not all(isinstance(item, str) for item in favourites):
                raise ValueError('Invalid favourites')
            if 'tmux-web.desktop' not in favourites:
                subprocess.run(['gsettings', 'set', 'org.gnome.shell', 'favorite-apps', repr(favourites + ['tmux-web.desktop'])], check=True)
            print('Dockのお気に入りに追加しました')
        except (subprocess.SubprocessError, ValueError, SyntaxError):
            print('Dockへの固定は、起動後のアイコンを右クリックして「お気に入りに追加」で行えます')
    if args.launch:
        subprocess.Popen([str(launcher)], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True)


if __name__ == '__main__':
    main()
