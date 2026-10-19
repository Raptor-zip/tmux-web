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
    protected _sock: unknown;
    protected _fbDepth: number;
    protected _compressionLevel: number;
    static messages: { clientEncodings(sock: unknown, encodings: number[]): void };
    disconnect(): void;
    focus(): void;
    sendKey(keysym: number, code?: string, down?: boolean): void;
    sendCtrlAltDel(): void;
    clipboardPasteFrom(text: string): void;
  }
}
