import { useEffect, useMemo, useRef, useState } from 'react';
import { fetchFiles, openFile, type FileEntry, type FileListing } from '../api';

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
}

export function FileBrowser({ paneId, onClose }: { paneId: string; onClose(): void }) {
  const [directory, setDirectory] = useState('');
  const [listing, setListing] = useState<FileListing | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState('');
  const [sort, setSort] = useState<'recent' | 'name'>('recent');
  const [revision, setRevision] = useState(0);
  const [selected, setSelected] = useState<FileEntry | null>(null);
  const [url, setUrl] = useState('');
  const [previewError, setPreviewError] = useState('');
  const requestId = useRef(0);
  const panel = useRef<HTMLDivElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    closeButton.current?.focus();
    return () => { previous?.focus(); requestId.current++; };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError('');
    setListing(null);
    fetchFiles(paneId, directory, controller.signal)
      .then((data) => { if (!controller.signal.aborted) setListing(data); })
      .catch((err) => { if (!controller.signal.aborted) setError(err.message); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [paneId, directory, revision]);

  const items = useMemo(() => (listing?.items ?? [])
    .filter((entry) => entry.name.toLocaleLowerCase().includes(filter.toLocaleLowerCase()))
    .sort((a, b) => Number(b.directory) - Number(a.directory)
      || (sort === 'recent' ? b.modified - a.modified : 0)
      || a.name.localeCompare(b.name, 'ja')), [listing, filter, sort]);

  const navigate = (path: string) => {
    requestId.current++;
    setDirectory(path);
    setFilter('');
    setSelected(null);
    setUrl('');
    setPreviewError('');
  };
  const preview = async (entry: FileEntry) => {
    const id = ++requestId.current;
    setSelected(entry);
    setUrl('');
    setPreviewError('');
    try {
      const result = await openFile(paneId, entry.path, listing!.root);
      if (id === requestId.current) setUrl(result.url);
    } catch (err) {
      if (id === requestId.current) setPreviewError((err as Error).message);
    }
  };
  const mediaError = () => setPreviewError('この形式はブラウザで表示できないか、リンクの期限が切れています。ダウンロードするか、一覧から開き直してください。');

  return (
    <div className="modal-backdrop file-backdrop" onMouseDown={(e) => {
      if (e.target === e.currentTarget) onClose();
    }}>
      <div ref={panel} className={`file-browser ${selected ? 'has-preview' : ''}`}
        role="dialog" aria-modal="true" aria-label="ファイル一覧とプレビュー"
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Escape') { e.preventDefault(); onClose(); }
          if (e.key === 'Tab') {
            const controls = [...(panel.current?.querySelectorAll<HTMLElement>(
              'button:not(:disabled), a[href], input, select, iframe, video[controls], audio[controls]',
            ) ?? [])].filter((element) => element.getClientRects().length);
            const first = controls[0];
            const last = controls[controls.length - 1];
            if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
            else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
          }
        }}>
        <header className="file-header">
          <strong>ファイル</strong>
          <span className="file-root" title={listing?.root}>{listing?.root ?? '作業フォルダ'}</span>
          <button ref={closeButton} className="btn" onClick={onClose}>閉じる</button>
        </header>
        <div className="file-columns">
          <section className="file-list-pane" aria-label="ファイル一覧">
            <nav className="file-breadcrumbs" aria-label="フォルダ">
              <button className="btn" onClick={() => navigate('')}>ルート</button>
              {directory.split('/').filter(Boolean).map((part, i, parts) => (
                <button className="btn" key={i} onClick={() => navigate(parts.slice(0, i + 1).join('/'))}>{part}</button>
              ))}
            </nav>
            <div className="file-controls">
              <input aria-label="ファイル名で絞り込む" placeholder="ファイル名で絞り込む" value={filter} onChange={(e) => setFilter(e.target.value)} />
              <select aria-label="並び順" value={sort} onChange={(e) => setSort(e.target.value as typeof sort)}>
                <option value="recent">更新順</option><option value="name">名前順</option>
              </select>
              <button className="btn" disabled={loading} onClick={() => setRevision((v) => v + 1)}>更新</button>
            </div>
            <div className="file-list" aria-busy={loading}>
              {loading && <p role="status">読み込み中…</p>}
              {error && <p role="alert">{error}</p>}
              {!loading && !error && items.length === 0 && <p>ファイルがありません。</p>}
              {items.map((entry) => (
                <button key={entry.path} className={`file-row ${selected?.path === entry.path ? 'selected' : ''}`}
                  onClick={() => entry.directory ? navigate(entry.path) : preview(entry)}>
                  <span className="file-kind" aria-hidden="true">{entry.directory ? '📁' : entry.mime.startsWith('image/') ? '▧' : entry.mime.startsWith('video/') ? '▶' : entry.mime.startsWith('audio/') ? '♪' : '▤'}</span>
                  <span className="file-details"><span className="file-name">{entry.name}</span>
                    <span className="file-meta">{entry.directory ? 'フォルダ' : formatSize(entry.size)} · {new Date(entry.modified).toLocaleString('ja-JP')}</span>
                  </span>
                  {entry.directory && <span aria-hidden="true">›</span>}
                </button>
              ))}
            </div>
            <p className="file-note">隠しファイル・node_modules は省略しています。更新順はこのフォルダ内の並び順です。</p>
          </section>
          <section className="file-preview" aria-label="プレビュー">
            {selected ? <>
              <div className="file-preview-header">
                <button className="btn file-back" onClick={() => { requestId.current++; setSelected(null); setUrl(''); }}>← 一覧</button>
                <strong>{selected.name}</strong>
                {url && <a className="btn" href={`${url}&download=1`} download={selected.name}>ダウンロード</a>}
              </div>
              {previewError && <p role="alert">{previewError}</p>}
              {!url && !previewError && <p role="status">プレビューを準備中…</p>}
              {url && <div className="file-preview-content">
                {selected.mime.startsWith('image/') ? <img src={url} alt={selected.name} onError={mediaError} />
                  : selected.mime.startsWith('video/') ? <video key={url} src={url} controls playsInline preload="metadata" onError={mediaError} />
                  : selected.mime.startsWith('audio/') ? <audio key={url} src={url} controls preload="metadata" onError={mediaError} />
                  : selected.mime === 'application/pdf' ? <>
                    <a className="btn" href={url} target="_blank" rel="noopener noreferrer">PDF を別タブで開く</a>
                    <iframe key={url} src={url} title={selected.name} />
                  </> : selected.mime === 'text/plain' ? <iframe key={url} src={url} title={selected.name} sandbox="" />
                  : <p>この形式はダウンロードして開いてください。</p>}
              </div>}
            </> : <p className="file-empty">ファイルを選ぶとここに表示します。</p>}
          </section>
        </div>
      </div>
    </div>
  );
}
