import { execFile, spawn } from 'node:child_process';
/** 外部コマンドを実行する。シェルは介さないので引数のクォートを気にしなくてよい。 */
export function run(cmd, args, timeout = 10_000) {
    return new Promise((resolve) => {
        execFile(cmd, args, { timeout, maxBuffer: 32 * 1024 * 1024, encoding: 'utf8' }, (err, stdout, stderr) => {
            resolve({
                code: err && typeof err.code === 'number' ? err.code : err ? 1 : 0,
                stdout: stdout ?? '',
                stderr: stderr ?? '',
            });
        });
    });
}
export const tmux = (args, timeout) => run('tmux', args, timeout);
/** 標準入力にデータを流し込んで実行する（`tmux load-buffer -` 用）。 */
export function runWithInput(cmd, args, input) {
    return new Promise((resolve) => {
        const child = spawn(cmd, args, { stdio: ['pipe', 'pipe', 'pipe'] });
        let stdout = '';
        let stderr = '';
        child.stdout.on('data', (d) => (stdout += d));
        child.stderr.on('data', (d) => (stderr += d));
        child.on('error', () => resolve({ code: 1, stdout, stderr }));
        child.on('close', (code) => resolve({ code: code ?? 0, stdout, stderr }));
        child.stdin.on('error', () => { });
        child.stdin.end(input);
    });
}
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
