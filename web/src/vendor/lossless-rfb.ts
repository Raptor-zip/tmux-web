import RFB from '@novnc/novnc';
import { desktopEncodings } from './lossless-encodings';

// noVNC 1.7.0 の core/input/gesturehandler.js にある GH_DRAG。
const GH_DRAG = 8;
const TOUCH_DRAG_THRESHOLD = 8; // CSS px

/** noVNC 1.7.0 adapter for encoding negotiation and single-finger dragging.
 * Check the adapter and its browser tests when upgrading the pinned noVNC dependency.
 * Encoding IDs are from the RFB protocol / noVNC core/encodings.js.
 */

export class LosslessRFB extends RFB {
  constructor(target: HTMLElement, url: string) {
    super(target, url);
    const gestures = this._gestures;
    const move = gestures._touchMove.bind(gestures);
    gestures._touchMove = (id, x, y) => {
      const touch = gestures._tracked[0];
      // noVNC は 50px 未満の移動をタップとみなす。1 本指だけ早めにドラッグを始め、
      // 開始位置から左ボタンを押した状態で、以降の移動と解放は noVNC に任せる。
      if (gestures._tracked.length === 1 && touch.id === id &&
          gestures._state !== GH_DRAG && (gestures._state & GH_DRAG) &&
          Math.hypot(x - touch.firstX, y - touch.firstY) >= TOUCH_DRAG_THRESHOLD) {
        gestures._stopLongpressTimeout();
        gestures._state = GH_DRAG;
        gestures._pushEvent('gesturestart');
      }
      move(id, x, y);
    };
  }

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
