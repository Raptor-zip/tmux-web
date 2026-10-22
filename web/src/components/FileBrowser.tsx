import { Icon } from './Icon';
import { useEffect, useMemo, useRef, useState } from 'react';
import { fetchFiles, openFile, uploadFile, archiveFiles, type FileEntry, type FileListing } from '../api';

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
}

export function FileBrowser({ paneId, deviceName, onClose }: { paneId: string; deviceName: string; onClose(): void }) {
  const [transfer, setTransfer] = useState<{ done: number; total: number; name: string } | null>(null);
  const [notice, setNotice] = useState('');
  const [archiving, setArchiving] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const uploadController = useRef<AbortController | null>(null);
  const uploadLock = useRef(false);
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
    return () => { previous?.focus(); requestId.current++; uploadController.current?.abort(); };
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
  const upload = async (files: File[]) => {
    if (!listing || uploadLock.current || !files.length) return;
    uploadLock.current = true;
    const controller = new AbortController(); uploadController.current = controller;
    setNotice(''); setError('');
    let done = 0;
    try {
      for (const file of files) {
        setTransfer({ done, total: files.length, name: file.name });
        if (file.size > 50 * 1024 * 1024) throw new Error(`${file.name} は50MBを超えています。`);
        await uploadFile(paneId, directory, listing.root, file, controller.signal);
        done++;
      }
      setNotice(`${done}件のファイルをアップロードしました。同名のファイルは連番で保存します。`);
    } catch (error) { if (!controller.signal.aborted) setNotice(`${done}件を保存済み。${(error as Error).message}`); }
    finally {
      uploadLock.current = false;
      if (!controller.signal.aborted) { setTransfer(null); setRevision(v => v + 1); }
      if (input.current) input.current.value = '';
    }
  };
  const downloadFolder = async () => {
    if (!listing || archiving) return;
    setArchiving(true); setNotice('');
    try {
      const { url } = await archiveFiles(paneId, directory, listing.root);
      const link = document.createElement('a'); link.href = url; link.download = ''; document.body.append(link); link.click(); link.remove();
      setNotice('フォルダーのダウンロードを開始しました。');
    } catch (error) { setNotice((error as Error).message); }
    finally { setArchiving(false); }
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
          <strong>{deviceName} のファイル</strong>
          <span className="file-root" title={listing?.root}>{listing?.root ?? '作業フォルダ'}</span>
          <button ref={closeButton} className="btn" onClick={onClose}>閉じる</button>
        </header>
        <div className="file-columns">
          <section className={`file-list-pane ${dragOver ? 'file-drop-active' : ''}`} aria-label="ファイル一覧"
            onDragOver={e => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); if (!transfer) setDragOver(true); } }}
            onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOver(false); }}
            onDrop={e => { e.preventDefault(); setDragOver(false); if ([...e.dataTransfer.items].some(item => item.webkitGetAsEntry?.()?.isDirectory)) setNotice('フォルダーの中のファイルを選んでアップロードしてください。'); else void upload([...e.dataTransfer.files]); }}>
            <nav className="file-breadcrumbs" aria-label="フォルダ">
              <button className="btn" disabled={transfer !== null} onClick={() => navigate('')}>ルート</button>
              {directory.split('/').filter(Boolean).map((part, i, parts) => (
                <button className="btn" key={i} onClick={() => navigate(parts.slice(0, i + 1).join('/'))}>{part}</button>
              ))}
            </nav>
            <div className="file-transfer-actions">
              <input ref={input} type="file" multiple hidden aria-label="アップロードするファイル" onChange={e => void upload([...(e.target.files || [])])} />
              <button className="btn" disabled={!listing || loading || transfer !== null} onClick={() => input.current?.click()}><Icon name="upload" />アップロード</button>
              <button className="btn" disabled={!listing || loading || transfer !== null || archiving} onClick={() => void downloadFolder()}><Icon name="download" />{archiving ? '準備中…' : 'フォルダーを保存'}</button>
            </div>
            {transfer && <div className="file-transfer-status" role="status"><span>{transfer.done + 1} / {transfer.total}：{transfer.name}</span><progress max={transfer.total} value={transfer.done} /></div>}
            {notice && <p className="file-transfer-status" role="status">{notice}</p>}
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
                  disabled={entry.directory && transfer !== null} onClick={() => entry.directory ? navigate(entry.path) : preview(entry)}>
                  <span className="file-kind" aria-hidden="true">{entry.directory ? <Icon name="folder" /> : entry.mime.startsWith('image/') ? <Icon name="image" /> : entry.mime.startsWith('video/') ? <Icon name="video" /> : entry.mime.startsWith('audio/') ? <Icon name="audio" /> : <Icon name="file" />}</span>
                  <span className="file-details"><span className="file-name">{entry.name}</span>
                    <span className="file-meta">{entry.directory ? 'フォルダ' : formatSize(entry.size)} · {new Date(entry.modified).toLocaleString('ja-JP')}</span>
                  </span>
                  {entry.directory && <span aria-hidden="true">›</span>}
                </button>
              ))}
            </div>
            <p className="file-note">ファイルをドロップして追加できます（1件50MBまで）。隠しファイル・node_modules は表示と一括保存の対象外です。</p>
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
