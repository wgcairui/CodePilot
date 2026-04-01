import WebSocket from 'ws';
import type { AgentMessage, ClientMessage } from '../../../remote-agent/src/types.js';

type MessageListener = (hostId: string, msg: AgentMessage) => void;

interface WsEntry {
  ws: WebSocket;
  localPort: number;
  pingTimer: ReturnType<typeof setInterval> | null;
  pongPending: boolean;
}

export class RemoteAgentClient {
  private connections = new Map<string, WsEntry>();
  private messageListeners: MessageListener[] = [];
  private needReconnectCb: ((hostId: string) => void) | null = null;

  onMessage(l: MessageListener): () => void {
    this.messageListeners.push(l);
    return () => { this.messageListeners = this.messageListeners.filter(x => x !== l); };
  }

  onNeedReconnect(cb: (hostId: string) => void): void {
    this.needReconnectCb = cb;
  }

  async connect(hostId: string, localPort: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${localPort}`);
      const timer = setTimeout(() => reject(new Error('WS connect timeout')), 10_000);

      ws.on('open', () => {
        clearTimeout(timer);
        const entry: WsEntry = { ws, localPort, pingTimer: null, pongPending: false };
        this.connections.set(hostId, entry);
        this.startHeartbeat(hostId);
        resolve();
      });

      ws.on('message', (raw: Buffer) => {
        try {
          const msg = JSON.parse(raw.toString()) as AgentMessage;
          if (msg.type === 'pong') {
            const e = this.connections.get(hostId);
            if (e) e.pongPending = false;
            return;
          }
          for (const l of this.messageListeners) l(hostId, msg);
        } catch { /* ignore */ }
      });

      ws.on('close', () => {
        const e = this.connections.get(hostId);
        if (e?.pingTimer) clearInterval(e.pingTimer);
        this.connections.delete(hostId);
        this.needReconnectCb?.(hostId);
      });

      ws.on('error', (err) => { clearTimeout(timer); reject(err); });
    });
  }

  send(hostId: string, msg: ClientMessage): void {
    const e = this.connections.get(hostId);
    if (e?.ws.readyState === WebSocket.OPEN) e.ws.send(JSON.stringify(msg));
  }

  disconnect(hostId: string): void {
    const e = this.connections.get(hostId);
    if (!e) return;
    if (e.pingTimer) clearInterval(e.pingTimer);
    e.ws.close();
    this.connections.delete(hostId);
  }

  isConnected(hostId: string): boolean {
    return this.connections.get(hostId)?.ws.readyState === WebSocket.OPEN;
  }

  private startHeartbeat(hostId: string): void {
    const e = this.connections.get(hostId);
    if (!e) return;
    e.pingTimer = setInterval(() => {
      if (e.pongPending) { e.ws.terminate(); return; }
      e.pongPending = true;
      this.send(hostId, { type: 'ping' });
    }, 30_000);
  }
}

export const remoteAgentClient = new RemoteAgentClient();
