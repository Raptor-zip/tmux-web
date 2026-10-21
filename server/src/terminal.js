import { createAttachment } from './attach.js';

export async function connectTerminal(ws, req, broadcastStateSoon, attach = createAttachment) {
  const url = new URL(req.url, 'http://localhost');
  const sessionId = url.searchParams.get('session');
  const windowId = url.searchParams.get('window');
  const cols = Number(url.searchParams.get('cols') || 80);
  const rows = Number(url.searchParams.get('rows') || 24);
  const mode = url.searchParams.get('mode') === 'direct' ? 'direct' : 'mirror';
  const showStatusBar = url.searchParams.get('status') === '1';

  // attach の準備には tmux を数回叩くぶんの時間がかかる。その間にブラウザが送ってきた
  // 入力やウィンドウ切り替えを取りこぼさないよう、リスナーを先に張ってキューに貯める。
  let attachment = null;
  const pending = [];
  let closed = false;
  const close = async () => {
    if (closed) return;
    closed = true;
    if (attachment) await attachment.dispose();
    broadcastStateSoon();
  };
  ws.on('close', close);
  ws.on('error', close);

  const handleMessage = (msg) => {
    if (closed) return;
    if (!attachment) {
      pending.push(msg);
      return;
    }
    switch (msg.type) {
      case 'input':
        attachment.pty.write(msg.data);
        break;
      case 'resize':
        try {
          attachment.pty.resize(Math.max(2, msg.cols | 0), Math.max(2, msg.rows | 0));
        } catch {
          /* pty がすでに閉じている */
        }
        break;
      case 'selectWindow':
        attachment.selectWindowIndex(msg.index);
        break;
      default:
        break;
    }
  };

  ws.on('message', (raw, isBinary) => {
    if (isBinary) {
      handleMessage({ type: 'input', data: raw.toString('utf8') });
      return;
    }
    try {
      handleMessage(JSON.parse(raw.toString()));
    } catch {
      /* 壊れたフレームは無視 */
    }
  });

  try {
    attachment = await attach({
      sessionId,
      windowId,
      cols,
      rows,
      mode,
      showStatusBar,
    });
  } catch (err) {
    if (ws.readyState === ws.OPEN) {
      ws.send(JSON.stringify({ type: 'error', message: String(err.message || err) }));
      ws.close();
    }
    return;
  }

  if (closed || ws.readyState !== ws.OPEN) {
    await attachment.dispose();
    return;
  }

  ws.send(
    JSON.stringify({
      type: 'ready',
      attachTarget: attachment.attachTarget,
      mirrorName: attachment.mirrorName,
      mode,
    }),
  );

  // 準備中に届いていたぶんを順番に処理する
  while (pending.length) handleMessage(pending.shift());

  attachment.pty.onData((data) => {
    if (ws.readyState === ws.OPEN) ws.send(Buffer.from(data, 'utf8'));
  });

  attachment.pty.onExit(({ exitCode }) => {
    if (ws.readyState === ws.OPEN) {
      ws.send(JSON.stringify({ type: 'exit', exitCode }));
      ws.close();
    }
  });
}
