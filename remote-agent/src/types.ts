// Wire Protocol（client → agent）
export type ClientMessage =
  | { type: 'start_session'; sessionId: string; workDir: string; prompt: string }
  | { type: 'resume_session'; sessionId: string; lastEventId: number }
  | { type: 'abort_session'; sessionId: string }
  | { type: 'ping' };

// Wire Protocol（agent → client）
export type AgentMessage =
  | { type: 'event'; sessionId: string; eventId: number; event: unknown }
  | { type: 'buffered_events'; sessionId: string; events: Array<{ eventId: number; event: unknown }> }
  | { type: 'session_complete'; sessionId: string }
  | { type: 'session_error'; sessionId: string; error: string }
  | { type: 'session_not_found'; sessionId: string }
  | { type: 'session_taken'; sessionId: string }
  | { type: 'pong' };

export interface SessionState {
  sessionId: string;
  process: import('node:child_process').ChildProcess;
  buffer: Array<{ eventId: number; event: unknown; timestamp: number }>;
  nextEventId: number;
  clientWs: import('ws').WebSocket | null;
  status: 'running' | 'completed' | 'error';
  startedAt: number;
}
