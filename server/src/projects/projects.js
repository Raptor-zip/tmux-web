import { mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { HOME, HttpError, resolveForCreate } from './safety.js';
import { run } from './sh.js';
import { startSession } from './sessions.js';
/** 制御文字（0x00-0x1f と 0x7f）。ディレクトリ名から取り除く。 */
const CONTROL_CHARS = new RegExp('[\\u0000-\\u001f\\u007f]', 'g');
/**
 * 入力された名前をディレクトリ名に落とす。
 * 日本語はそのまま通す（Linux では問題なく、電車で打つには日本語のほうが速い）。
 * パス区切りと制御文字、先頭・末尾のドットとハイフンだけ落とす。
 */
export function toDirName(input) {
    const cleaned = (input ?? '')
        .replace(CONTROL_CHARS, '')
        .replace(/[/\\]/g, '-')
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^[-.]+/, '')
        .replace(/[-.]+$/, '')
        .trim();
    return cleaned.slice(0, 80);
}
const GITIGNORE_COMMON = `node_modules/
.venv/
__pycache__/
.env
.env.local
out/
dist/
build/
*.log
.DS_Store
`;
async function applyTemplate(dir, template, name) {
    await writeFile(path.join(dir, '.gitignore'), GITIGNORE_COMMON, 'utf8');
    if (template === 'node') {
        const pkg = {
            name: name.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/^-+|-+$/g, '') || 'app',
            version: '0.1.0',
            private: true,
            type: 'module',
            scripts: { start: 'node index.js' },
        };
        await writeFile(path.join(dir, 'package.json'), JSON.stringify(pkg, null, 2) + '\n', 'utf8');
        await writeFile(path.join(dir, 'index.js'), `console.log(${JSON.stringify(name)})\n`, 'utf8');
    }
    if (template === 'python') {
        // uv があれば任せる。無ければ最小の pyproject だけ置く。
        const res = await run('bash', ['-lc', `cd '${dir.replace(/'/g, `'\\''`)}' && uv init --no-workspace`], 30_000);
        if (res.code !== 0) {
            await writeFile(path.join(dir, 'pyproject.toml'), `[project]\nname = "app"\nversion = "0.1.0"\nrequires-python = ">=3.10"\ndependencies = []\n`, 'utf8');
            await writeFile(path.join(dir, 'main.py'), `print(${JSON.stringify(name)})\n`, 'utf8');
        }
    }
}
export async function createProject(opts) {
    const dirName = toDirName(opts.name);
    if (!dirName)
        throw new HttpError(400, 'プロジェクト名を入力してください');
    const dir = await resolveForCreate(path.join(HOME, dirName));
    if (existsSync(dir))
        throw new HttpError(409, `${dirName} はすでにあります`);
    await mkdir(dir, { recursive: false });
    await run('git', ['-C', dir, 'init', '-q', '-b', 'main'], 15_000);
    await applyTemplate(dir, opts.template ?? 'none', opts.name);
    const started = await startSession({
        dir,
        title: opts.name.trim() || dirName,
        initialPrompt: opts.initialPrompt,
    });
    return { ...started, created: dir };
}
