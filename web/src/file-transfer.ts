export interface TransferEntry {
  name: string;
  file?: File;
  children?: TransferEntry[];
}

type DroppedFile = FileSystemEntry & { file(resolve: (file: File) => void, reject: (error: DOMException) => void): void };
type DroppedDirectory = FileSystemEntry & { createReader(): FileSystemDirectoryReader };

const visible = (name: string) => !name.startsWith('.') && name !== 'node_modules' && name !== '__pycache__';
const asFile = (file: File) => ({ name: file.name, file });

async function readEntry(entry: FileSystemEntry, signal: AbortSignal): Promise<TransferEntry> {
  signal.throwIfAborted();
  if (entry.isFile) {
    const file = await new Promise<File>((resolve, reject) => (entry as DroppedFile).file(resolve, reject));
    return asFile(file);
  }
  const reader = (entry as DroppedDirectory).createReader();
  const children: TransferEntry[] = [];
  while (true) {
    signal.throwIfAborted();
    const batch = await new Promise<FileSystemEntry[]>((resolve, reject) => reader.readEntries(resolve, reject));
    if (!batch.length) return { name: entry.name, children };
    for (const child of batch) {
      if (visible(child.name)) children.push(await readEntry(child, signal));
    }
  }
}

export function readDrop(data: DataTransfer, signal: AbortSignal): Promise<TransferEntry[]> {
  // Capture entries while the drop event still grants access to the data store.
  const items = [...data.items].filter(item => item.kind === 'file');
  if (!items.length) return Promise.resolve([...data.files].map(asFile));
  return Promise.all(items.map(item => {
    const entry = item.webkitGetAsEntry?.();
    if (entry) return readEntry(entry, signal);
    const file = item.getAsFile();
    if (!file) throw new Error('ドロップした項目を読み込めませんでした。');
    return asFile(file);
  }));
}

export function readFolderSelection(files: File[]): TransferEntry[] {
  const root: TransferEntry[] = [];
  const directories = new Map<string, TransferEntry[]>();
  for (const file of files) {
    const parts = file.webkitRelativePath.split('/').filter(Boolean);
    const parents = parts.slice(0, -1);
    if (!parents.length || ![...parents, file.name].every(visible)) continue;
    let children = root;
    let relative = '';
    for (const name of parents) {
      relative += '/' + name;
      let folder = directories.get(relative);
      if (!folder) {
        folder = [];
        directories.set(relative, folder);
        children.push({ name, children: folder });
      }
      children = folder;
    }
    children.push(asFile(file));
  }
  return root;
}
