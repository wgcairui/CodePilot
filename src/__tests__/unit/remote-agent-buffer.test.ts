import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { SessionManager } from '../../../remote-agent/src/session-manager.js';

describe('SessionManager', () => {
  it('getBufferedSince returns events after lastEventId', () => {
    const sm = new SessionManager();
    const fakeState = {
      sessionId: 'test',
      process: { kill: () => {} } as unknown as import('node:child_process').ChildProcess,
      buffer: [
        { eventId: 0, event: { t: 'a' }, timestamp: Date.now() },
        { eventId: 1, event: { t: 'b' }, timestamp: Date.now() },
        { eventId: 2, event: { t: 'c' }, timestamp: Date.now() },
      ],
      nextEventId: 3,
      clientWs: null,
      status: 'running' as const,
      startedAt: Date.now(),
    };
    sm.sessions.set('test', fakeState);

    const result = sm.getBufferedSince('test', 0);
    assert.equal(result.length, 2);
    assert.equal(result[0].eventId, 1);
  });

  it('getBufferedSince returns empty for unknown session', () => {
    const sm = new SessionManager();
    assert.deepEqual(sm.getBufferedSince('unknown', 0), []);
  });

  it('abort does not throw for unknown session', () => {
    const sm = new SessionManager();
    assert.doesNotThrow(() => sm.abort('unknown'));
  });
});
