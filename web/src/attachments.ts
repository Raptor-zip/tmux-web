/** Quote a file path as one literal argument for POSIX shells. */
export function quotePath(path: string): string {
  return /^[a-zA-Z0-9_./-]+$/.test(path) ? path : `'${path.replace(/'/g, `'"'"'`)}'`;
}

export interface AttachmentResult {
  text: string;
  inserted: boolean;
  error?: string;
}
