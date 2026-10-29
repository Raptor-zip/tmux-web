export const TEXT_PREVIEW_BYTES = 256 * 1024;

/** Read a bounded UTF-8 preview, even if an older peer ignores the Range header. */
export async function readTextPreview(url: string, signal?: AbortSignal): Promise<{ text: string; truncated: boolean }> {
  const response = await fetch(url, { signal, cache: 'no-store', headers: { Range: `bytes=0-${TEXT_PREVIEW_BYTES - 1}` } });
  if (response.status === 416 && response.headers.get('Content-Range') === 'bytes */0') {
    await response.body?.cancel().catch(() => {});
    return { text: '', truncated: false };
  }
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || 'プレビューを読み込めませんでした。再読み込みしてください。');
  }
  const range = /\/(\d+)$/.exec(response.headers.get('Content-Range') || '');
  const length = response.headers.get('Content-Length');
  const declared = range ? Number(range[1]) : response.status === 200 && length !== null ? Number(length) : NaN;
  const total = Number.isSafeInteger(declared) && declared >= 0 ? declared : undefined;
  const reader = response.body?.getReader();
  if (!reader) return { text: '', truncated: false };
  const chunks: Uint8Array[] = [];
  let size = 0, truncated = false;
  try {
    while (size < TEXT_PREVIEW_BYTES) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = value.subarray(0, TEXT_PREVIEW_BYTES - size);
      chunks.push(chunk); size += chunk.length;
      if (chunk.length < value.length) truncated = true;
    }
    if (size === TEXT_PREVIEW_BYTES) {
      truncated ||= total === undefined || total > size;
      await reader.cancel().catch(() => {});
    }
    truncated ||= total !== undefined && total > size;
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  // A truncated multibyte character is not part of the preview.
  return { text: new TextDecoder().decode(bytes, { stream: truncated }), truncated };
}
