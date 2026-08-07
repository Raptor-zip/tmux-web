#!/usr/bin/env node
// 再起動前に開いていた作業を tmux セッションとして開き直す。
//
// tmux のセッションそのものは再起動で消えていて復元できない。ここでやるのは
// 「どのディレクトリで作業していたか」を ~/.claude/projects の記録から割り出し、
// 同じ構成のセッションを作り直すこと。会話は claude --resume で続きから再開できる。
//
//   node scripts/restore-sessions.mjs                # 候補を一覧するだけ（既定）
//   node scripts/restore-sessions.mjs --restore      # tmux セッションを作る（cd のみ）
//   node scripts/restore-sessions.mjs --restore --resume  # claude --resume も起動する
//   node scripts/restore-sessions.mjs --hours=72     # 対象の時間範囲を広げる

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';

const PROJECTS_DIR = path.join(os.homedir(), '.claude', 'projects');

const argv = process.argv.slice(2);
const has = (name) => argv.includes(name);
const num = (name) => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? Number(hit.split('=')[1]) : null;
};

const DO_RESTORE = has('--restore');
const DO_RESUME = has('--resume');

// --- 対象の時間範囲 ---------------------------------------------------------
// 既定は「前回の起動から今回の起動まで」。つまり再起動で失われた分だけを拾う。
function currentBootEpoch() {
  const stat = fs.readFileSync('/proc/stat', 'utf8');
  const m = stat.match(/^btime (\d+)$/m);
  return m ? Number(m[1]) * 1000 : Date.now() - 86400_000;
}

function previousBootRange() {
  try {
    const out = execFileSync('journalctl', ['--list-boots', '--no-pager'], {
      encoding: 'utf8',
    });
    const line = out.split('\n').find((l) => /^\s*-1\s/.test(l));
    // " -1 <id> Wed 2026-08-05 10:17:32 JST—Fri 2026-08-07 15:05:08 JST"
    const m = line && line.match(/(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}).*?(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})/);
    if (m) return { from: new Date(m[1]).getTime(), to: new Date(m[2]).getTime() };
  } catch {
    /* journalctl が無い環境ではフォールバックする */
  }
  return null;
}

const boot = currentBootEpoch();
const hours = num('hours');
let range;
if (hours) {
  range = { from: boot - hours * 3600_000, to: boot };
} else {
  range = previousBootRange() ?? { from: boot - 24 * 3600_000, to: boot };
}

// --- 記録から作業ディレクトリを割り出す --------------------------------------
// ディレクトリ名（-home-somak-a-b）はパス区切りと名前中のハイフンを区別できないので、
// 記録の中の cwd を正とする。
function readCwd(file) {
  const fd = fs.openSync(file, 'r');
  try {
    const buf = Buffer.alloc(256 * 1024);
    const n = fs.readSync(fd, buf, 0, buf.length, 0);
    for (const line of buf.subarray(0, n).toString('utf8').split('\n')) {
      if (!line.includes('"cwd"')) continue;
      try {
        const cwd = JSON.parse(line).cwd;
        if (cwd) return cwd;
      } catch {
        /* 途中で切れた行は捨てる */
      }
    }
  } finally {
    fs.closeSync(fd);
  }
  return null;
}

function collect() {
  if (!fs.existsSync(PROJECTS_DIR)) return [];
  const found = [];
  for (const dir of fs.readdirSync(PROJECTS_DIR)) {
    const full = path.join(PROJECTS_DIR, dir);
    if (!fs.statSync(full).isDirectory()) continue;

    let latest = null;
    for (const f of fs.readdirSync(full)) {
      if (!f.endsWith('.jsonl')) continue;
      const p = path.join(full, f);
      const mtime = fs.statSync(p).mtimeMs;
      if (!latest || mtime > latest.mtime) {
        latest = { mtime, file: p, sessionId: path.basename(f, '.jsonl') };
      }
    }
    if (!latest) continue;
    if (latest.mtime < range.from || latest.mtime > range.to) continue;

    const cwd = readCwd(latest.file);
    if (!cwd) continue;
    found.push({ ...latest, cwd, exists: fs.existsSync(cwd) });
  }
  return found.sort((a, b) => b.mtime - a.mtime);
}

// --- tmux ---------------------------------------------------------------------
const tmux = (args) => execFileSync('tmux', args, { encoding: 'utf8' });

function existingSessions() {
  try {
    return new Set(tmux(['list-sessions', '-F', '#{session_name}']).trim().split('\n').filter(Boolean));
  } catch {
    return new Set(); // tmux サーバがまだ無い
  }
}

// tmux のセッション名は . と : を使えない
const sessionName = (cwd) => path.basename(cwd).replace(/[.:]/g, '-');

// --- 実行 ---------------------------------------------------------------------
const items = collect();
const fmt = (ms) => new Date(ms).toLocaleString('ja-JP', { hour12: false });

console.log(`対象期間 : ${fmt(range.from)} 〜 ${fmt(range.to)}`);
console.log(`該当     : ${items.length} 件\n`);

if (items.length === 0) {
  console.log('この期間に作業していた記録が見つかりませんでした。--hours=N で範囲を広げてください。');
  process.exit(0);
}

const taken = existingSessions();
for (const it of items) {
  const name = sessionName(it.cwd);
  const mark = !it.exists ? '× ディレクトリ無し' : taken.has(name) ? '- 既に開いている' : '○';
  console.log(`${mark}  ${fmt(it.mtime)}  ${name}`);
  console.log(`      ${it.cwd}`);
}

if (!DO_RESTORE) {
  console.log('\n開き直すには --restore を付けて実行してください。');
  console.log('claude の会話も続きから開くなら --restore --resume。');
  process.exit(0);
}

console.log('');
let made = 0;
for (const it of items) {
  const name = sessionName(it.cwd);
  if (!it.exists || taken.has(name)) continue;

  tmux(['new-session', '-d', '-s', name, '-c', it.cwd]);
  taken.add(name);
  made++;

  if (DO_RESUME) {
    // 送るだけで、実行するかはユーザーが Enter を押して決める、ではなく
    // ここは意図的に実行まで行う（--resume を明示した場合のみ）
    tmux(['send-keys', '-t', name, `claude --resume ${it.sessionId}`, 'Enter']);
    console.log(`作成 ${name}  (claude --resume ${it.sessionId})`);
  } else {
    console.log(`作成 ${name}  (${it.cwd})`);
  }
}

console.log(`\n${made} 件のセッションを作りました。tmux-web を再読み込みすれば出てきます。`);
if (!DO_RESUME) {
  console.log('会話を続きから開くには、各セッションで claude --resume を実行してください。');
}
