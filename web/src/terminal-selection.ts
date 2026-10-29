export interface SelectionRequest {
  type: 'selectWindow';
  index: number;
  windowId: string;
  requestId: number;
}

/** A socket being ready does not mean its latest window selection is finished. */
export class TerminalSelection {
  private sequence = 0;
  private pending: SelectionRequest | null = null;
  private confirmed = 0;
  private serverReady = false;
  private acknowledgements = false;
  private initialWindowId: string | null = null;

  request(index: number, windowId: string): SelectionRequest {
    this.pending = { type: 'selectWindow', index, windowId, requestId: ++this.sequence };
    return this.pending;
  }

  receiveReady(acknowledgements: boolean, windowId: string | null) {
    if (this.serverReady) return;
    this.serverReady = true;
    this.acknowledgements = acknowledgements;
    this.initialWindowId = windowId;
  }

  confirm(requestId: unknown, windowId: unknown): boolean {
    if (!this.serverReady || !this.acknowledgements || !this.pending
        || this.pending.requestId !== requestId || this.pending.windowId !== windowId) return false;
    this.confirmed = this.pending.requestId;
    return true;
  }

  get phase(): 'connecting' | 'selecting' | 'ready' {
    if (!this.serverReady) return 'connecting';
    if (this.acknowledgements && this.pending && this.confirmed !== this.pending.requestId) return 'selecting';
    return 'ready';
  }

  canInput(windowId: string | null): boolean {
    return this.phase === 'ready' && (!this.acknowledgements
      || (this.pending?.windowId ?? this.initialWindowId) === windowId);
  }
}
