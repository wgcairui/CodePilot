import { spawn } from 'node:child_process';
import type { SessionState } from './types.js';

const BUFFER_MAX_BYTES = 50 * 1024 * 1024; // 50MB
const BUFFER_TTL_MS = 5 * 60 * 1000;       // 5min

export class SessionManager {
  readonly sessions = new Map<string, SessionState>();

  start(sessionId: string, workDir: string, prompt: string, claudePath = 'claude'): SessionState {
    const proc = spawn(claudePath, ['--output-format', 'stream-json', '--print', prompt], {
      cwd: workDir,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const state: SessionState = {
      sessionId,
      process: proc,
      buffer: [],
      nextEventId: 0,
      clientWs: null,
      status: 'running',
      startedAt: Date.now(),
    };
    this.sessions.set(sessionId, state);

    proc.stdout?.on('data', (chunk: Buffer) => {
      for (const line of chunk.toString().split('\n').filter(Boolean)) {
        try {
          const event = JSON.parse(line);
          const eventId = state.nextEventId++;
          state.buffer.push({ eventId, event, timestamp: Date.now() });
          this.trimBuffer(state);
          if (state.clientWs) {
            state.clientWs.send(JSON.stringify({ type: 'event', sessionId, eventId, event }));
          }
        } catch { /* 非 JSON 行忽略 */ }
      }
    });

    proc.on('close', (code) => {
      state.status = code === 0 ? 'completed' : 'error';
      if (state.clientWs) {
        const msg = state.status === 'completed'
          ? { type: 'session_complete', sessionId }
          : { type: 'session_error', sessionId, error: `Exit code ${code}` };
        state.clientWs.send(JSON.stringify(msg));
      }
    });

    return state;
  }

  get(sessionId: string): SessionState | undefined {
    return this.sessions.get(sessionId);
  }

  abort(sessionId: string): void {
    this.sessions.get(sessionId)?.process.kill('SIGTERM');
  }

  getBufferedSince(sessionId: string, lastEventId: number): Array<{ eventId: number; event: unknown }> {
    const state = this.sessions.get(sessionId);
    if (!state) return [];
    return state.buffer
      .filter(e => e.eventId > lastEventId)
      .map(({ eventId, event }) => ({ eventId, event }));
  }

  private trimBuffer(state: SessionState): void {
    const now = Date.now();
    state.buffer = state.buffer.filter(e => now - e.timestamp < BUFFER_TTL_MS);
    let totalBytes = 0;
    for (let i = state.buffer.length - 1; i >= 0; i--) {
      totalBytes += JSON.stringify(state.buffer[i]).length;
      if (totalBytes > BUFFER_MAX_BYTES) {
        state.buffer = state.buffer.slice(i + 1);
        break;
      }
    }
  }
}
