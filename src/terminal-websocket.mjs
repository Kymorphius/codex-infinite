import { WebSocketServer } from 'ws';
import { TERMINAL_LIMITS, terminalError } from './terminal-contract.mjs';
import { assertTerminalOrigin } from './terminal-http.mjs';

function rejectUpgrade(socket, statusCode) {
  const status = { 400: 'Bad Request', 403: 'Forbidden', 404: 'Not Found', 405: 'Method Not Allowed', 503: 'Service Unavailable' }[statusCode] || 'Bad Request';
  socket.end(`HTTP/1.1 ${statusCode || 400} ${status}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
}

export function attachTerminalWebSocket({ server, service, dashboardOrigin }) {
  const sockets = new WebSocketServer({ noServer: true, maxPayload: TERMINAL_LIMITS.frameBytes, perMessageDeflate: false });
  const onUpgrade = (request, socket, head) => {
    let url;
    try { url = new URL(request.url, dashboardOrigin); } catch { rejectUpgrade(socket, 400); return; }
    if (url.pathname !== '/api/terminal/socket') { rejectUpgrade(socket, 404); return; }
    try {
      if (request.method !== 'GET') throw terminalError(405, 'Method not allowed');
      assertTerminalOrigin(request, dashboardOrigin);
      if (!service) throw terminalError(503, '终端服务不可用');
      const id = url.searchParams.get('id'); service.get(id);
      sockets.handleUpgrade(request, socket, head, ws => {
        let connection;
        const send = frame => {
          if (ws.readyState !== 1) throw Error('closed');
          const payload = JSON.stringify(frame);
          if (ws.bufferedAmount + Buffer.byteLength(payload) > TERMINAL_LIMITS.bufferedBytes) throw Error('slow');
          ws.send(payload);
        };
        ws.on('error', () => connection?.detach());
        ws.on('close', () => connection?.detach());
        ws.on('message', (data, binary) => {
          try {
            if (binary) throw terminalError(400, '终端只接受 JSON 文本消息');
            connection.receive(JSON.parse(data.toString('utf8')));
          } catch (error) {
            try { send({ type: 'error', message: error.statusCode ? error.message : '终端消息无效' }); } catch {}
            connection?.detach(); ws.close(1008, '终端消息无效');
          }
        });
        try { connection = service.connect(id, { send, close: (code, reason) => ws.close(code, reason) }); }
        catch { ws.close(1008, '终端已关闭'); }
      });
    } catch (error) { rejectUpgrade(socket, error.statusCode || 400); }
  };
  server.on('upgrade', onUpgrade);
  return () => {
    server.off('upgrade', onUpgrade);
    for (const ws of sockets.clients) ws.terminate();
    sockets.close();
  };
}
