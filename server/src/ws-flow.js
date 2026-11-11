import { WebSocket } from 'ws';

// Pause the producer until all writes complete. A websocket receiver may emit
// several messages from an already-read chunk after pause(), so count callbacks
// rather than resuming on the first one. Never drop bytes from an RFB stream.
export function createWebSocketForwarder(from, to, onError, maxBuffer = 8 * 1024 * 1024) {
  let pending = 0;
  return (data, binary) => {
    if (to.readyState !== WebSocket.OPEN) return;
    if (to.bufferedAmount + data.length > maxBuffer) { onError(); return; }
    pending++;
    from.pause();
    to.send(data, { binary }, err => {
      pending--;
      if (err) { onError(); return; }
      if (pending === 0 && from.readyState === WebSocket.OPEN) from.resume();
    });
  };
}
