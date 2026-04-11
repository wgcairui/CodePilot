import { Client, type ConnectConfig } from 'ssh2';
import net from 'node:net';
import fs from 'node:fs';
import type { RemoteHostConfig, ConnectionState, ConnectionStatus } from './types.js';
import { createLogger } from '../logger.js';

const logger = createLogger('remote');

const MAX_RETRY_DELAY_MS = 30_000;
const RECONNECT_TIMEOUT_MS = 5 * 60 * 1000;

async function findFreePort(start = 39100): Promise<number> {
  for (let port = start; port < start + 100; port++) {
    const free = await new Promise<boolean>(resolve => {
      const srv = net.createServer();
      srv.listen(port, '127.0.0.1', () => srv.close(() => resolve(true)));
      srv.on('error', () => resolve(false));
    });
    if (free) return port;
  }
  throw new Error('No free port found in range 39100-39199');
}

interface ConnEntry {
  client: Client;
  localPort: number;
  status: ConnectionStatus;
  retryCount: number;
  retryTimer: ReturnType<typeof setTimeout> | null;
  reconnectStart: number | null;
  server: net.Server | null; // local TCP server for port forwarding
  decryptFn?: (encryptedBase64: string) => string;
}

export class SSHManager {
  private connections = new Map<string, ConnEntry>();
  private statusListeners: Array<(state: ConnectionState) => void> = [];

  onStatusChange(listener: (state: ConnectionState) => void): () => void {
    this.statusListeners.push(listener);
    return () => { this.statusListeners = this.statusListeners.filter(l => l !== listener); };
  }

  private emit(hostId: string, status: ConnectionStatus, localPort: number | null, error?: string) {
    for (const l of this.statusListeners) l({ hostId, status, localPort, error });
  }

  async connect(config: RemoteHostConfig, decryptFn?: (encryptedBase64: string) => string): Promise<{ localPort: number }> {
    logger.info('SSH connect', { hostId: config.id, username: config.username, host: config.host, port: config.port });
    const existing = this.connections.get(config.id);
    if (existing?.status === 'connected') {
      logger.info('SSH already connected', { hostId: config.id, localPort: existing.localPort });
      return { localPort: existing.localPort };
    }
    const localPort = await findFreePort();
    logger.info('SSH starting connection', { hostId: config.id, localPort });
    this.emit(config.id, 'connecting', null);
    try {
      await this.doConnect(config, localPort, decryptFn);
      logger.info('SSH connected', { hostId: config.id });
      return { localPort };
    } catch (err) {
      logger.error('SSH connect failed', { hostId: config.id, error: String(err) });
      throw err;
    }
  }

  private async doConnect(config: RemoteHostConfig, localPort: number, decryptFn?: (encryptedBase64: string) => string): Promise<void> {
    const client = new Client();
    const connectCfg: ConnectConfig = {
      host: config.host,
      port: config.port,
      username: config.username,
      keepaliveInterval: 10_000,
      keepaliveCountMax: 3,
      readyTimeout: 20_000,
    };

    if (config.authType === 'key') {
      const keyPath = config.keyPath || `${process.env.HOME ?? '/root'}/.ssh/id_rsa`;
      connectCfg.privateKey = fs.readFileSync(
        keyPath.startsWith('~') ? keyPath.replace('~', process.env.HOME ?? '') : keyPath
      );
    } else if (config.authType === 'password') {
      if (config.encryptedPassword && decryptFn) {
        connectCfg.password = decryptFn(config.encryptedPassword);
      } else if (config.password) {
        connectCfg.password = config.password;
      }
    }

    return new Promise((resolve, reject) => {
      client.on('ready', () => {
        // 创建本地 TCP 服务器转发到远程 agentPort
        const server = net.createServer((localSocket) => {
          client.forwardOut('127.0.0.1', localPort, '127.0.0.1', config.agentPort, (err, channel) => {
            if (err) { localSocket.destroy(); return; }
            localSocket.pipe(channel).pipe(localSocket);
            localSocket.on('error', () => channel.close());
            channel.on('close', () => localSocket.destroy());
          });
        });

        server.listen(localPort, '127.0.0.1', () => {
          const entry: ConnEntry = {
            client, localPort, status: 'connected', server,
            retryCount: 0, retryTimer: null, reconnectStart: null, decryptFn,
          };
          this.connections.set(config.id, entry);
          this.emit(config.id, 'connected', localPort);
          resolve();
        });

        server.on('error', (err) => { client.end(); reject(err); });
      });

      client.on('error', (err) => {
        const entry = this.connections.get(config.id);
        if (!entry || entry.status !== 'connected') { reject(err); return; }
        entry.server?.close();
        this.scheduleReconnect(config, localPort);
      });

      client.on('end', () => {
        const entry = this.connections.get(config.id);
        if (entry?.status === 'connected') {
          entry.server?.close();
          this.scheduleReconnect(config, localPort);
        }
      });

      client.connect(connectCfg);
    });
  }

  private scheduleReconnect(config: RemoteHostConfig, localPort: number): void {
    const entry = this.connections.get(config.id);
    if (!entry) return;
    if (!entry.reconnectStart) entry.reconnectStart = Date.now();
    const elapsed = Date.now() - entry.reconnectStart;
    if (elapsed > RECONNECT_TIMEOUT_MS) {
      logger.error('SSH reconnect timeout', { hostId: config.id, elapsed });
      entry.status = 'failed';
      this.emit(config.id, 'failed', null, 'Reconnect timeout (5min)');
      return;
    }
    logger.info('SSH scheduling reconnect', { hostId: config.id, attempt: entry.retryCount + 1, elapsed });
    entry.status = 'reconnecting';
    this.emit(config.id, 'reconnecting', localPort);
    // 退避序列：1→2→4→8→30s（第 4 次起固定 30s）
    const delay = entry.retryCount >= 4 ? MAX_RETRY_DELAY_MS : 1000 * 2 ** entry.retryCount;
    entry.retryCount++;
    entry.retryTimer = setTimeout(async () => {
      try {
        await this.doConnect(config, localPort, entry.decryptFn);
        const e = this.connections.get(config.id);
        if (e) { e.retryCount = 0; e.reconnectStart = null; }
      } catch {
        this.scheduleReconnect(config, localPort);
      }
    }, delay);
  }

  disconnect(hostId: string): void {
    const entry = this.connections.get(hostId);
    if (!entry) {
      logger.warn('SSH disconnect - no connection found', { hostId });
      return;
    }
    logger.info('SSH disconnecting', { hostId });
    if (entry.retryTimer) clearTimeout(entry.retryTimer);
    entry.server?.close();
    entry.client.end();
    this.connections.delete(hostId);
    this.emit(hostId, 'disconnected', null);
    logger.info('SSH disconnected', { hostId });
  }

  getRawClient(hostId: string): Client | null {
    return this.connections.get(hostId)?.client ?? null;
  }

  getLocalPort(hostId: string): number | null {
    return this.connections.get(hostId)?.localPort ?? null;
  }

  getStatus(hostId: string): ConnectionStatus {
    return this.connections.get(hostId)?.status ?? 'disconnected';
  }
}

export const sshManager = new SSHManager();
