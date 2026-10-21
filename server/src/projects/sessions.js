import path from 'node:path';
import { run, runWithInput, sleep, tmux } from './sh.js';
import { HttpError } from './safety.js';
import { requireControllable } from './discover.js';
import { note, rcUrls } from './state.js';
// 実機の文言: 「Quick safety check: Is this a project you created or one you trust?」
//              「❯ 1. Yes, I trust this folder」
const RE_TRUST = /Quick safety check|Yes, I trust this folder|Accessing workspace:/i;
const RE_READY = /(auto mode on|accept edits on|plan mode on|bypass permissions|manual mode|dontAsk mode|\? for shortcuts|shift\+tab to cycle)/;
const RE_RC_URL = /https:\/\/claude\.ai\/code\/[A-Za-z0-9_\-./?=&%]+/;
/** シングルクォート内に安全に埋め込む。 */
function shq(s) {
    return `'${s.replace(/'/g, `'\\''`)}'`;
}
/** tmux セッション名に使える文字だけにする（`.` と `:` は tmux のターゲット構文と衝突する）。 */
function tmuxSafe(s) {
    return s.replace(/[.:\s]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') || 'proj';
}
async function uniqueSessionName(base) {
    const { stdout } = await tmux(['list-sessions', '-F', '#{session_name}']);
    const taken = new Set(stdout.split('\n').map((s) => s.trim()).filter(Boolean));
    let name = `cc-${base}`;
    let i = 2;
    while (taken.has(name))
        name = `cc-${base}-${i++}`;
    return name;
}
async function capture(paneId) {
    const { stdout, code } = await tmux(['capture-pane', '-p', '-t', paneId, '-S', '-80']);
    return { text: stdout, alive: code === 0 };
}
/** 任意のテキストを安全にペインへ流し込む（`-` で始まる文字列も壊れない）。 */
async function typeText(paneId, text) {
    const buf = `tmux-web-${paneId}-${Date.now()}`;
    await runWithInput('tmux', ['load-buffer', '-b', buf, '-'], text);
    await tmux(['paste-buffer', '-b', buf, '-t', paneId, '-d']);
}
async function pressEnter(paneId) {
    await tmux(['send-keys', '-t', paneId, 'Enter']);
}
/**
 * tmux の中で Remote Control 付きの claude を起動する。
 * ターミナルを閉じても生き続けるので、スマホからそのまま操作できる。
 */
export async function startSession(opts) {
    const sessionName = await uniqueSessionName(tmuxSafe(path.basename(opts.dir)));
    // 表示名は --name で明示する。`--remote-control <名前>` だけだと値として拾われず、
    // cwd から派生した名前（train-test-c3 のような形）になってしまう。
    const argv = ['claude'];
    if (opts.resumeId)
        argv.push('--resume', shq(opts.resumeId));
    argv.push('--name', shq(opts.title), '--remote-control');
    const command = `exec ${argv.join(' ')}`;
    // -x/-y を明示しないとデタッチ起動のペインが 80x24 になり、フッタが折り返して読めなくなる
    const res = await tmux([
        'new-session', '-d',
        '-s', sessionName,
        '-c', opts.dir,
        '-x', '220', '-y', '50',
        'bash', '-lc', command,
    ]);
    if (res.code !== 0)
        throw new HttpError(500, `tmux の起動に失敗しました: ${res.stderr.trim()}`);
    // new-session の -x/-y は環境によって効かない。手動サイズに固定してから広げる。
    // 狭いままだとフッタが折り返して状態判定ができず、Claude 側の表示も読みにくくなる。
    await tmux(['set-option', '-t', sessionName, 'window-size', 'manual']);
    await tmux(['resize-window', '-t', `${sessionName}:0`, '-x', '220', '-y', '50']);
    const panes = await tmux(['list-panes', '-t', sessionName, '-F', '#{pane_id}']);
    const paneId = panes.stdout.split('\n')[0]?.trim();
    if (!paneId)
        throw new HttpError(500, 'ペインを特定できませんでした');
    note(paneId, '起動中…');
    void watchStartup(paneId, opts.initialPrompt).catch(() => note(paneId, '起動状態を取得できませんでした。端末を確認してください'));
    return { tmuxSession: sessionName, paneId, title: opts.title, dir: opts.dir };
}
/**
 * 起動直後のペインを見張って、
 *   1. ワークスペース信頼ダイアログを承認する
 *   2. Remote Control の URL を拾う
 *   3. 初期プロンプトを投入する
 * の 3 つを片付ける。
 */
async function watchStartup(paneId, initialPrompt) {
    const prompt = initialPrompt?.replace(/\s+/g, ' ').trim();
    let trusted = false;
    let promptSent = !prompt;
    const deadline = Date.now() + 120_000;
    while (Date.now() < deadline) {
        await sleep(900);
        const { text, alive } = await capture(paneId);
        if (!alive)
            break; // ペインが消えた = claude が落ちた
        if (!text)
            continue;
        if (!trusted && RE_TRUST.test(text)) {
            await pressEnter(paneId);
            trusted = true;
            note(paneId, 'ワークスペースの信頼を承認しました');
            continue;
        }
        const url = RE_RC_URL.exec(text);
        if (url && !rcUrls.has(paneId)) {
            rcUrls.set(paneId, url[0]);
            note(paneId, 'Remote Control が有効になりました');
        }
        if (!promptSent && RE_READY.test(text) && !RE_TRUST.test(text)) {
            await typeText(paneId, prompt);
            await sleep(400);
            await pressEnter(paneId);
            promptSent = true;
            note(paneId, '最初の指示を送りました');
        }
        if (promptSent && rcUrls.has(paneId))
            break;
    }
}
/** 稼働中のセッションに `/remote-control` を打ち込んで、後から RC を有効にする。 */
export async function enableRemoteControl(id) {
    const row = await requireControllable(id);
    const paneId = row.paneId;
    if (row.rc)
        return;
    await typeText(paneId, '/remote-control');
    await sleep(500);
    await pressEnter(paneId);
    note(paneId, '/remote-control を送りました');
    // URL が出るまで少しだけ見張る
    void (async () => {
        for (let i = 0; i < 20; i++) {
            await sleep(1000);
            const { text, alive } = await capture(paneId);
            if (!alive)
                return;
            const url = RE_RC_URL.exec(text);
            if (url) {
                rcUrls.set(paneId, url[0]);
                return;
            }
        }
    })();
}
/** `/exit` を送って行儀よく終わらせる。 */
export async function exitSession(id) {
    const { paneId } = await requireControllable(id);
    await typeText(paneId, '/exit');
    await sleep(300);
    await pressEnter(paneId);
}
/** ペインごと落とす。tmux セッションではなくペインを消すので、他のウィンドウは巻き添えにしない。 */
export async function killSession(id) {
    const { paneId } = await requireControllable(id);
    await tmux(['kill-pane', '-t', paneId]);
    rcUrls.delete(paneId);
}
/** ペイン末尾を返す（詰まっているときの確認用）。 */
export async function paneTail(id, lines = 60) {
    const { paneId } = await requireControllable(id);
    const { stdout } = await tmux(['capture-pane', '-p', '-t', paneId, '-S', `-${lines}`]);
    return stdout
        .split('\n')
        .filter((l) => !/^[─━]{10,}/.test(l.trim()))
        .join('\n')
        .replace(/\n{3,}/g, '\n\n')
        .trimEnd();
}
/** claude 本体があるか（起動前の健全性チェック用）。 */
export async function claudeAvailable() {
    const { code } = await run('bash', ['-lc', 'command -v claude']);
    return code === 0;
}
