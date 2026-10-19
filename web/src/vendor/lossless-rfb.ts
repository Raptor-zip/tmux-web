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
}
