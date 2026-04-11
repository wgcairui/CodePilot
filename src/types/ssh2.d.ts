// Local type declarations for ssh2 (package lacks bundled types and @types/ssh2 install is unavailable)
declare module 'ssh2' {
  import { EventEmitter } from 'node:events';
  import { Writable, Readable, Duplex } from 'node:stream';

  export interface ConnectConfig {
    host?: string;
    port?: number;
    username?: string;
    password?: string;
    privateKey?: string | Buffer;
    keepaliveInterval?: number;
    keepaliveCountMax?: number;
    readyTimeout?: number;
  }

  export interface ClientChannel extends Duplex {
    stderr: Readable;
    close(): void;
  }

  export interface SFTPWrapper {
    createWriteStream(path: string): Writable;
  }

  export class Client extends EventEmitter {
    connect(config: ConnectConfig): void;
    exec(command: string, callback: (err: Error | null, stream: ClientChannel) => void): void;
    sftp(callback: (err: Error | null, sftp: SFTPWrapper) => void): void;
    forwardOut(
      srcHost: string, srcPort: number,
      dstHost: string, dstPort: number,
      callback: (err: Error | null, stream: ClientChannel) => void
    ): void;
    end(): void;
    on(event: 'ready', listener: () => void): this;
    on(event: 'error', listener: (err: Error) => void): this;
    on(event: 'end', listener: () => void): this;
    on(event: string, listener: (...args: unknown[]) => void): this;
  }
}
