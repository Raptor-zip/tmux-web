import { useEffect, useRef, useState } from 'react';
import { recentProjects, startProject, type RecentProject, type StartedProject } from '../api';
import { Modal } from './Modal';
import { Icon } from './Icon';
import { tildePath } from '../paths';

export function ProjectStart({ home, deviceId = 'local', deviceName, initialMode, onClose, onStarted }: {
  home: string; deviceId?: string; deviceName?: string; initialMode: 'new' | 'existing'; onClose(): void; onStarted(project: StartedProject): void;
}) {
  const [mode, setMode] = useState(initialMode);
  const [name, setName] = useState('');
  const [showLocation, setShowLocation] = useState(false);
  const [parent, setParent] = useState(home);
  const [dir, setDir] = useState(home);
  const [agent, setAgent] = useState<'claude' | 'codex' | 'shell'>('claude');
  const [template, setTemplate] = useState<'none' | 'node' | 'python'>('none');
  const [prompt, setPrompt] = useState('');
  const [rc, setRc] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const inFlight = useRef(false);
  const initialInput = useRef<HTMLInputElement>(null);
  useEffect(() => { initialInput.current?.focus(); }, [mode]);
  return <Modal title={`${deviceName || 'このPC'} · プロジェクトを開く`} onClose={onClose} busy={busy}>
    <form className="project-form" onSubmit={async e => {
      e.preventDefault(); if (inFlight.current) return;
      inFlight.current = true; setBusy(true); setError('');
      try { const project = await startProject({ mode, name, parent, dir, agent, template, prompt, remoteControl: agent === 'claude' && rc }, deviceId); onStarted(project); }
      catch (error) { setError((error as Error).message); }
      finally { inFlight.current = false; setBusy(false); }
    }}>
      <div className="project-modes" role="group" aria-label="プロジェクトの開き方">
        <button type="button" className={mode === 'new' ? 'on' : ''} aria-pressed={mode === 'new'} onClick={() => { setMode('new'); setError(''); }}>新しく作る</button>
        <button type="button" className={mode === 'existing' ? 'on' : ''} aria-pressed={mode === 'existing'} onClick={() => { setMode('existing'); setError(''); }}>既存のフォルダー</button>
      </div>
      <fieldset disabled={busy}>
        {mode === 'new' ? <>
          <label className="project-field">プロジェクト名<input ref={initialInput} required maxLength={80} value={name} onChange={e => setName(e.target.value)} placeholder="my-project" autoComplete="off" spellCheck={false} /></label>
          <div className="project-location"><p className="field-hint project-destination" title={parent.replace(/\/$/, '') + '/' + name.trim()}>{tildePath(parent.replace(/\/$/, '') + '/' + (name.trim() || 'my-project'), home)}</p><button type="button" aria-expanded={showLocation} onClick={() => setShowLocation(v => !v)}>保存先を変更</button></div>
          {showLocation && <label className="project-field">保存先<input required value={parent} onChange={e => setParent(e.target.value)} spellCheck={false} /></label>}
        </> : <label className="project-field">フォルダーのパス<input ref={initialInput} required value={dir} onChange={e => setDir(e.target.value)} placeholder="~/my-project" autoComplete="off" spellCheck={false} /></label>}
        <div className="project-field-row">
          {mode === 'new' && <label className="project-field">テンプレート<select aria-label="テンプレート" value={template} onChange={e => setTemplate(e.target.value as typeof template)}><option value="none">なし</option><option value="node">Node.js</option><option value="python">Python</option></select></label>}
          <label className="project-field">起動するツール<select aria-label="起動するツール" value={agent} onChange={e => setAgent(e.target.value as typeof agent)}><option value="claude">Claude</option><option value="codex">Codex</option><option value="shell">ターミナル</option></select></label>
        </div>
        {agent !== 'shell' && <label className="project-field"><span>最初の指示 <span className="field-optional">（任意）</span></span><textarea rows={3} maxLength={32000} value={prompt} onChange={e => setPrompt(e.target.value)} placeholder="このプロジェクトで取り組むこと" /></label>}
        {agent === 'claude' && <label className="project-check"><input type="checkbox" checked={rc} onChange={e => setRc(e.target.checked)} />Claude アプリからも操作する</label>}
      </fieldset>
      {error && <p className="inline-error" role="alert">{error}</p>}
      <footer className="app-modal-actions"><span className="field-hint">新しい端末タブで続けられます</span><button className="btn" type="button" disabled={busy} onClick={onClose}>キャンセル</button><button className="btn primary" disabled={busy || (mode === 'new' ? !name.trim() : !dir.trim())} type="submit">{busy ? '開いています…' : mode === 'new' ? '作成して開く' : '開く'}</button></footer>
    </form>
  </Modal>;
}

export function RecentWork({ home, deviceId = 'local', onStarted }: { home: string; deviceId?: string; onStarted(project: StartedProject): void }) {
  const [open, setOpen] = useState(false);
  const [projects, setProjects] = useState<RecentProject[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const lock = useRef(false);
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    setLoading(true); setError('');
    recentProjects(controller.signal, deviceId).then(data => setProjects(data.projects)).catch(e => { if (!controller.signal.aborted) setError(e.message); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [open, revision, deviceId]);
  return <section className="recent-work" aria-label="最近のClaude履歴">
    <button className="recent-heading" aria-expanded={open} onClick={() => setOpen(v => !v)}><span aria-hidden="true">{open ? '▾' : '▸'}</span> 最近のClaude履歴 <Icon name="history" /></button>
    {open && <div className="recent-body">
      <div className="recent-filter"><input aria-label="履歴を検索" placeholder="プロジェクトを検索" value={query} onChange={e => setQuery(e.target.value)} /><button className="icon-btn" title="履歴を更新" aria-label="履歴を更新" disabled={loading || busy !== null} onClick={() => setRevision(v => v + 1)}><Icon name="refresh" /></button></div>
      {loading && <p className="field-hint" role="status">履歴を読み込んでいます…</p>}
      {error && <p className="inline-error" role="alert">{error}</p>}
      {!loading && !error && projects.filter(p => `${p.name} ${p.cwd} ${p.summary}`.toLowerCase().includes(query.toLowerCase())).length === 0 && <p className="field-hint">{query ? '一致する履歴がありません' : '再開できる履歴がありません'}</p>}
      {projects.filter(p => `${p.name} ${p.cwd} ${p.summary}`.toLowerCase().includes(query.toLowerCase())).map(project => <button key={project.cwd} className="recent-row" disabled={busy !== null} onClick={async () => {
        if (lock.current) return; lock.current = true; setBusy(project.cwd); setError('');
        try { onStarted(await startProject({ mode: 'existing', dir: project.cwd, agent: 'claude', resumeId: project.sessionId }, deviceId)); }
        catch (e) { setError((e as Error).message); }
        finally { setBusy(null); lock.current = false; }
      }} title={`${project.summary || project.name}\n${project.cwd}\nクリックして会話を再開`}>
        <span><strong>{project.name}</strong><small>{tildePath(project.cwd, home)}</small>{project.summary && <small>{project.summary}</small>}</span><span className="recent-resume">{busy === project.cwd ? '起動中…' : '再開'}</span>
      </button>)}
    </div>}
  </section>;
}
