import RFB from '@novnc/novnc';
import { losslessEncodings } from './lossless-encodings';

/** noVNC 1.7.0 adapter: the public qualityLevel API always enables JPEG.
 * Explicitly negotiate only lossless encodings. Keep this adapter and its
 * negotiation test in sync when upgrading the pinned noVNC dependency.
 * Encoding IDs are from the RFB protocol / noVNC core/encodings.js.
 */

export class LosslessRFB extends RFB {
  protected _sendEncodings() {
    RFB.messages.clientEncodings(this._sock, losslessEncodings(this._fbDepth, this._compressionLevel));
  }
}
