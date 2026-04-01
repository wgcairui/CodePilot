// CODEPILOT_AGENT_VERSION=0.1.0
import { WebSocketServer, WebSocket } from 'ws';
import { SessionManager } from './session-manager.js';
import type { ClientMessage } from './types.js';

const portArg = process.argv.find(a => a.startsWith('--port='));
const PORT = portArg ? parseInt(portArg.split('=')[1]) : 39099;

const manager = new SessionManager();
const wss = new WebSocketServer({ host: '127.0.0.1', port: PORT });

console.log(`[codepilot-agent] Listening on 127.0.0.1:${PORT}`);

wss.on('connection', (ws: WebSocket) => {
  ws.on('message', (raw: Buffer) => {
    let msg: ClientMessage;
    try { msg = JSON.parse(raw.toString()); } catch { return; }

    switch (msg.type) {
      case 'ping':
        ws.send(JSON.stringify({ type: 'pong' }));
        break;

      case 'start_session': {
        const existing = manager.get(msg.sessionId);
        if (existing) {
          if (existing.clientWs) {
            ws.send(JSON.stringify({ type: 'session_taken', sessionId: msg.sessionId }));
            return;
          }
          existing.clientWs = ws;
          const buffered = manager.getBufferedSince(msg.sessionId, -1);
          ws.send(JSON.stringify({ type: 'buffered_events', sessionId: msg.sessionId, events: buffered }));
        } else {
          const state = manager.start(msg.sessionId, msg.workDir, msg.prompt);
          state.clientWs = ws;
        }
        break;
      }

      case 'resume_session': {
        const state = manager.get(msg.sessionId);
        if (!state) {
          ws.send(JSON.stringify({ type: 'session_not_found', sessionId: msg.sessionId }));
          return;
        }
        if (state.clientWs && state.clientWs !== ws) {
          ws.send(JSON.stringify({ type: 'session_taken', sessionId: msg.sessionId }));
          return;
        }
        state.clientWs = ws;
        const buffered = manager.getBufferedSince(msg.sessionId, msg.lastEventId);
        ws.send(JSON.stringify({ type: 'buffered_events', sessionId: msg.sessionId, events: buffered }));
        if (state.status !== 'running') {
          const termMsg = state.status === 'completed'
            ? { type: 'session_complete', sessionId: msg.sessionId }
            : { type: 'session_error', sessionId: msg.sessionId, error: 'Process already exited' };
          ws.send(JSON.stringify(termMsg));
        }
        break;
      }

      case 'abort_session':
        manager.abort(msg.sessionId);
        break;
    }
  });

  ws.on('close', () => {
    for (const state of manager.sessions.values()) {
      if (state.clientWs === ws) state.clientWs = null;
    }
  });
});
