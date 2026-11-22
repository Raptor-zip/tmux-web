import { Icon } from './Icon';
import { useEffect, useMemo, useRef, useState } from 'react';
import { fetchFiles, openFile, uploadFile, archiveFiles, createTransferFolder, isSameFile, type FileEntry, type FileListing } from '../api';
import { readDrop, readFolderSelection, type TransferEntry } from '../file-transfer';
import { readTextPreview } from '../file-preview';

function TextPreview({ url, onError }: { url: string; onError(error: Error): void }) {
  const [content, setContent] = useState<{ text: string; truncated: boolean } | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    readTextPreview(url, controller.signal)
      .then(value => { if (!controller.signal.aborted) setContent(value); })
      .catch(error => { if (!controller.signal.aborted) onError(error as Error); });
    return () => controller.abort();
  }, [url]);
  if (!content) return <p role="status">テキストを読み込み中…</p>;
  return <>
    {content.text ? <pre className="file-text" tabIndex={0} aria-label="ファイルの内容">{content.text}</pre> : <p>空のファイルです。</p>}
    {content.truncated && <p className="file-text-note">先頭256KBを表示しています。全体はダウンロードして確認してください。</p>}
  </>;
}

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
  const folderInput = useRef<HTMLInputElement>(null);
  const [sync, setSync] = useState(false);
  const uploadController = useRef<AbortController | null>(null);
  const previewController = useRef<AbortController | null>(null);
  const archiveController = useRef<AbortController | null>(null);
  const uploadLock = useRef(false);
  const archiveLock = useRef(false);
  const mounted = useRef(false);
  const [directory, setDirectory] = useState('');
  const [listing, setListing] = useState<FileListing | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState('');
  const [sort, setSort] = useState<'recent' | 'name'>('recent');
  const [revision, setRevision] = useState(0);
  const [selected, setSelected] = useState<FileEntry | null>(null);
  const selection = useRef<FileEntry | null>(null);
  const lastListing = useRef<FileListing | null>(null);
  const reloadSelected = useRef(false);
  const [url, setUrl] = useState('');
  const [previewError, setPreviewError] = useState('');
  const requestId = useRef(0);
  const panel = useRef<HTMLDialogElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const backButton = useRef<HTMLButtonElement>(null);
  const filterInput = useRef<HTMLInputElement>(null);
  const busy = transfer !== null || archiving;
  const clearPreview = () => {
    requestId.current++;
    previewController.current?.abort();
    selection.current = null;
    setSelected(null); setUrl(''); setPreviewError('');
  };

  useEffect(() => {
    mounted.current = true;
    const previous = document.activeElement as HTMLElement | null;
    const node = panel.current;
    node?.showModal();
    closeButton.current?.focus();
    return () => {
      mounted.current = false;
      requestId.current++;
      uploadController.current?.abort(); previewController.current?.abort(); archiveController.current?.abort();
      node?.close(); previous?.focus();
    };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const forcePreview = reloadSelected.current;
    reloadSelected.current = false;
    setLoading(true);
    setError('');
    setListing(null);
    fetchFiles(paneId, directory, controller.signal)
      .then((data) => {
        if (controller.signal.aborted) return;
        const previous = lastListing.current;
        lastListing.current = data;
        setListing(data);
        const current = selection.current;
        if (!current) return;
        const entry = data.items.find(item => item.path === current.path && !item.directory);
        if (previous?.root !== data.root || !entry) {
          clearPreview();
          setNotice(old => [old, previous?.root !== data.root ? '作業フォルダーが変わりました。ファイルを選び直してください。' : '選択したファイルが見つかりません。一覧を更新しました。'].filter(Boolean).join(' '));
        } else if (forcePreview || current.modified !== entry.modified || current.size !== entry.size
          || current.mime !== entry.mime || current.name !== entry.name) void preview(entry, data.root);
      })
      .catch((err) => { if (!controller.signal.aborted) { setError(err.message); clearPreview(); } })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [paneId, directory, revision]);

  useEffect(() => {
    if (selected && window.matchMedia('(max-width: 760px)').matches) backButton.current?.focus();
  }, [selected]);

  const items = useMemo(() => (listing?.items ?? [])
    .filter((entry) => entry.name.toLocaleLowerCase().includes(filter.toLocaleLowerCase()))
    .sort((a, b) => Number(b.directory) - Number(a.directory)
      || (sort === 'recent' ? b.modified - a.modified : 0)
      || a.name.localeCompare(b.name, 'ja')), [listing, filter, sort]);

  const navigate = (path: string) => {
    if (uploadLock.current || archiveLock.current) return;
    clearPreview();
    setDirectory(path);
    setFilter('');
    if (path === directory) setRevision(v => v + 1);
  };
  const preview = async (entry: FileEntry, root = listing?.root) => {
    if (!root) return;
    previewController.current?.abort();
    const controller = new AbortController(); previewController.current = controller;
    const id = ++requestId.current;
    selection.current = entry;
    setSelected(entry);
    setUrl('');
    setPreviewError('');
    try {
      const result = await openFile(paneId, entry.path, root, controller.signal);
      if (!controller.signal.aborted && id === requestId.current) setUrl(result.url);
    } catch (err) {
      if (!controller.signal.aborted && id === requestId.current) setPreviewError((err as Error).message);
    }
  };
  const upload = async (read: (signal: AbortSignal) => TransferEntry[] | Promise<TransferEntry[]>) => {
    if (!listing || loading || uploadLock.current || archiveLock.current) return;
    uploadLock.current = true;
    const controller = new AbortController(); uploadController.current = controller;
    const { signal } = controller;
    setNotice(''); setError('');
    setTransfer({ done: 0, total: 0, name: '送信する項目を読み込み中…' });
    let done = 0, skipped = 0, folders = 0;
    const count = (entries: TransferEntry[]): number => entries.reduce((total, entry) => total + 1 + count(entry.children ?? []), 0);
    try {
      const entries = await read(signal);
      signal.throwIfAborted();
      if (!entries.length) {
        setNotice('送信できる項目がありません。');
        return;
      }
      const total = count(entries);
      const send = async (batch: TransferEntry[], destination: string) => {
        for (const entry of batch) {
          signal.throwIfAborted();
          setTransfer({ done: done + skipped + folders, total, name: entry.name });
          if (entry.children) {
            const { name } = await createTransferFolder(paneId, destination, listing.root, entry.name, sync, signal);
            folders++;
            await send(entry.children, [destination, name].filter(Boolean).join('/'));
          } else if (entry.file) {
            if (entry.file.size > 50 * 1024 * 1024) throw new Error(`${entry.name} は50MBを超えています。`);
            if (sync && await isSameFile(paneId, destination, listing.root, entry.file, signal)) {
              skipped++;
            } else {
              await uploadFile(paneId, destination, listing.root, entry.file, signal, sync);
              done++;
            }
          }
        }
      };
      await send(entries, directory);
      if (mounted.current) {
        const folderNotice = folders ? ` フォルダー${folders}件を処理しました。` : '';
        setNotice(sync
          ? `同期しました。更新・追加 ${done}件、同じ内容 ${skipped}件。${folderNotice}`
          : `${done}件のファイルをアップロードしました。${folderNotice} 同名の項目は連番で保存します。`);
      }
    } catch (error) {
      const saved = folders ? `（フォルダー${folders}件を処理済み）` : '';
      if (mounted.current) setNotice(signal.aborted
        ? `${done}件の保存を確認しました${saved}。送信を中止しました。通信中だった項目は一覧で確認してください。`
        : `${done}件を保存済み${saved}。${(error as Error).message}`);
    } finally {
      uploadLock.current = false;
      if (uploadController.current === controller) uploadController.current = null;
      if (mounted.current) { setTransfer(null); setRevision(v => v + 1); }
      if (input.current) input.current.value = '';
      if (folderInput.current) folderInput.current.value = '';
    }
  };
  const downloadFolder = async () => {
    if (!listing || loading || archiveLock.current || uploadLock.current) return;
    archiveLock.current = true;
    const controller = new AbortController(); archiveController.current = controller;
    setArchiving(true); setNotice('');
    try {
      const { url } = await archiveFiles(paneId, directory, listing.root, controller.signal);
      if (!mounted.current || controller.signal.aborted) return;
      const link = document.createElement('a'); link.href = url; link.download = ''; document.body.append(link); link.click(); link.remove();
      setNotice('フォルダーのダウンロードを開始しました。');
    } catch (error) { if (mounted.current && !controller.signal.aborted) setNotice((error as Error).message); }
    finally { archiveLock.current = false; if (archiveController.current === controller) archiveController.current = null; if (mounted.current) setArchiving(false); }
  };
  const backToList = () => {
    const path = selection.current?.path;
    clearPreview();
    requestAnimationFrame(() => {
      const row = [...(panel.current?.querySelectorAll<HTMLButtonElement>('[data-file-path]') || [])].find(button => button.dataset.filePath === path);
      (row || filterInput.current)?.focus();
    });
  };
  const previewVersion = requestId.current;
  const mediaError = () => { if (previewVersion === requestId.current) setPreviewError('この形式はブラウザで表示できないか、リンクの期限が切れています。プレビューを再読み込みするか、ダウンロードしてください。'); };

  return (
      <dialog ref={panel} className={`file-browser ${selected ? 'has-preview' : ''}`}
        role="dialog" aria-modal="true" aria-label="ファイル一覧とプレビュー"
        onKeyDown={e => e.stopPropagation()}
        onCancel={e => { e.preventDefault(); onClose(); }}
        onClick={e => {
          if (e.target !== e.currentTarget) return;
          const box = e.currentTarget.getBoundingClientRect();
          if (e.clientX < box.left || e.clientX > box.right || e.clientY < box.top || e.clientY > box.bottom) onClose();
        }}>
        <header className="file-header">
          <strong>{deviceName} のファイル</strong>
          <span className="file-root" title={listing?.root}>{listing?.root ?? '作業フォルダー'}</span>
          <button ref={closeButton} className="btn" onClick={onClose}>閉じる</button>
        </header>
        <div className="file-columns">
          <section className={`file-list-pane ${dragOver ? 'file-drop-active' : ''}`} aria-label="ファイル一覧"
            onDragOver={e => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); if (!busy) setDragOver(true); } }}
            onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOver(false); }}
            onDrop={e => { e.preventDefault(); setDragOver(false); if (e.dataTransfer.types.includes('Files')) void upload(signal => readDrop(e.dataTransfer, signal)); }}>
            <nav className="file-breadcrumbs" aria-label="フォルダー">
              <button className="btn" disabled={busy || loading} onClick={() => navigate('')}>作業フォルダー</button>
              {directory.split('/').filter(Boolean).map((part, i, parts) => (
                <button className="btn" key={i} disabled={busy || loading} onClick={() => navigate(parts.slice(0, i + 1).join('/'))}>{part}</button>
              ))}
            </nav>
            <div className="file-transfer-actions">
              <input ref={input} type="file" multiple hidden aria-label="アップロードするファイル" onChange={e => void upload(() => [...(e.target.files || [])].map(file => ({ name: file.name, file })))} />
              <button className="btn" disabled={!listing || loading || busy} onClick={() => input.current?.click()}><Icon name="upload" />アップロード</button>
              <input ref={folderInput} type="file" hidden aria-label="アップロードするフォルダー"
                onChange={e => void upload(() => readFolderSelection([...(e.target.files || [])]))} />
              <button className="btn" disabled={!listing || loading || busy} onClick={() => {
                folderInput.current?.setAttribute('webkitdirectory', '');
                folderInput.current?.click();
              }}>フォルダーを送信</button>
              <select aria-label="送信方法" value={sync ? 'sync' : 'copy'} disabled={busy} onChange={e => setSync(e.target.value === 'sync')}>
                <option value="copy">コピー</option><option value="sync">同期（同名ファイルを更新）</option>
              </select>
              <button className="btn" disabled={!listing || loading || busy} onClick={() => void downloadFolder()}><Icon name="download" />{archiving ? '準備中…' : 'フォルダーを保存'}</button>
            </div>
            {transfer && <div className="file-transfer-status" role="status"><span>{transfer.total > 0 && `${transfer.done + 1} / ${transfer.total}：`}{transfer.name}</span><progress aria-label="アップロードの進み具合" max={transfer.total || 1} value={transfer.total ? transfer.done : undefined} /><button className="btn" onClick={() => uploadController.current?.abort()}>送信を中止</button></div>}
            {notice && <p className="file-transfer-status" role="status">{notice}</p>}
            <div className="file-controls">
              <input ref={filterInput} aria-label="ファイル名で絞り込む" placeholder="ファイル名で絞り込む" value={filter} onChange={(e) => setFilter(e.target.value)} />
              <select aria-label="並び順" value={sort} onChange={(e) => setSort(e.target.value as typeof sort)}>
                <option value="recent">更新順</option><option value="name">名前順</option>
              </select>
              <button className="btn" disabled={loading || busy} onClick={() => { reloadSelected.current = true; setRevision((v) => v + 1); }}>再読み込み</button>
            </div>
            <div className="file-list" aria-busy={loading}>
              {loading && <p role="status">読み込み中…</p>}
              {error && <p role="alert">{error}</p>}
              {!loading && !error && items.length === 0 && <p>{filter ? '条件に一致するファイルがありません。' : 'ファイルがありません。'}</p>}
              {items.map((entry) => (
                <button key={entry.path} data-file-path={entry.path} className={`file-row ${selected?.path === entry.path ? 'selected' : ''}`}
                  disabled={entry.directory && busy} onClick={() => entry.directory ? navigate(entry.path) : preview(entry)}>
                  <span className="file-kind" aria-hidden="true">{entry.directory ? <Icon name="folder" /> : entry.mime.startsWith('image/') ? <Icon name="image" /> : entry.mime.startsWith('video/') ? <Icon name="video" /> : entry.mime.startsWith('audio/') ? <Icon name="audio" /> : <Icon name="file" />}</span>
                  <span className="file-details"><span className="file-name">{entry.name}</span>
                    <span className="file-meta">{entry.directory ? 'フォルダー' : formatSize(entry.size)} · {new Date(entry.modified).toLocaleString('ja-JP')}</span>
                  </span>
                  {entry.directory && <span aria-hidden="true">›</span>}
                </button>
              ))}
            </div>
            <p className="file-note">{deviceName} のこのフォルダーに、ファイルやフォルダーをドロップして送信できます（1ファイル50MBまで）。同期は送信元からの一方向で、送信先の項目は削除しません。</p>
          </section>
          <section className="file-preview" aria-label="プレビュー">
            {selected ? <>
              <div className="file-preview-header">
                <button ref={backButton} className="btn file-back" onClick={backToList}>← 一覧</button>
                <strong>{selected.name}</strong>
                <div className="file-preview-actions">
                  <button className="btn" aria-label="プレビューを再読み込み" disabled={!listing || (!url && !previewError)} onClick={() => void preview(selected)}>再読み込み</button>
                  {url && <a className="btn" href={`${url}&download=1`} download={selected.name}>ダウンロード</a>}
                </div>
              </div>
              {previewError && <p role="alert">{previewError}</p>}
              {!url && !previewError && <p role="status">プレビューを準備中…</p>}
              {url && !previewError && <div className="file-preview-content">
                {selected.mime.startsWith('image/') ? <img key={url} src={url} alt={selected.name} onError={mediaError} />
                  : selected.mime.startsWith('video/') ? <video key={url} src={url} controls playsInline preload="metadata" onError={mediaError} />
                  : selected.mime.startsWith('audio/') ? <audio key={url} src={url} controls preload="metadata" onError={mediaError} />
                  : selected.mime === 'application/pdf' ? <>
                    <a className="btn" href={url} target="_blank" rel="noopener noreferrer">PDF を別タブで開く</a>
                    <iframe key={url} src={url} title={selected.name} />
                  </> : selected.mime === 'text/plain' ? <TextPreview key={url} url={url} onError={error => { if (previewVersion === requestId.current) setPreviewError(error.message); }} />
                  : <p>この形式はダウンロードして開いてください。</p>}
              </div>}
            </> : <p className="file-empty">ファイルを選ぶとここに表示します。</p>}
          </section>
        </div>
      </dialog>
  );
}
