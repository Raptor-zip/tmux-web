declare module '@novnc/novnc' {
  export default class RFB extends EventTarget {
    constructor(target: HTMLElement, url: string);
    scaleViewport: boolean;
    clipViewport: boolean;
    resizeSession: boolean;
    viewOnly: boolean;
    compressionLevel: number;
    qualityLevel: number;
    focusOnClick: boolean;
    /** 画面の外側（縮小したときの余白）の色 */
    background: string;
    protected _sock: unknown;
    protected _fbDepth: number;
    protected _compressionLevel: number;
    /** noVNC 内部のキーボード。押したままのキーを離す API が公開されていないため参照する */
    protected _keyboard?: { _allKeysUp?(): void };
    static messages: { clientEncodings(sock: unknown, encodings: number[]): void };
    disconnect(): void;
    focus(): void;
    sendKey(keysym: number, code?: string, down?: boolean): void;
    sendCtrlAltDel(): void;
    clipboardPasteFrom(text: string): void;
  }
}
