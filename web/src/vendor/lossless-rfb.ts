import RFB from '@novnc/novnc';
import { desktopEncodings } from './lossless-encodings';

/** noVNC 1.7.0 adapter: optionally enable Tight/JPEG with the selected quality.
 * Explicitly negotiate only supported encodings. Keep this adapter and its
 * negotiation test in sync when upgrading the pinned noVNC dependency.
 * Encoding IDs are from the RFB protocol / noVNC core/encodings.js.
 */

export class LosslessRFB extends RFB {
  // Set before the asynchronous handshake; changing a profile reconnects.
  lossless = true;
  protected _sendEncodings() {
    RFB.messages.clientEncodings(this._sock, desktopEncodings(this._fbDepth, this._compressionLevel, this.lossless ? null : this.qualityLevel));
  }

  /**
   * 押したままのキーをリモート側で離す。noVNC が離すのはブラウザのウィンドウが
   * フォーカスを失ったときだけなので、アプリのショートカット（Alt+数字など）で
   * タブを移ると、リモートでは Alt が押されたままになる。フォーカスが画面から外れたとき、
   * 隠したとき、切断する前にこれを呼ぶ。
   */
  releaseAllKeys() {
    try { this._keyboard?._allKeysUp?.(); } catch { /* 切断済み */ }
  }
}
