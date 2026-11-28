import type { Device } from '../devices';
import { RemoteScreen } from './RemoteScreen';

/** リモートデスクトップをダイアログで開く。中身はタブと共通の RemoteScreen */
export function ScreenViewer({ clipboardEnabled, deviceName, deviceId = 'local', devices = [], onClose, onOpenAsTab }: {
  clipboardEnabled: boolean;
  deviceName?: string;
  deviceId?: string;
  devices?: Device[];
  onClose(): void;
  /** 見ている画面をタブとして開く（端末と並べて見る） */
  onOpenAsTab?(deviceId: string): void;
}) {
  return <RemoteScreen variant="modal" clipboardEnabled={clipboardEnabled} deviceId={deviceId} deviceName={deviceName} devices={devices} onClose={onClose} onOpenAsTab={onOpenAsTab} />;
}
