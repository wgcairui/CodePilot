import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { consumeSSEStream, type SSECallbacks } from '../../hooks/useSSEStream';

/**
 * Helper: create a mock ReadableStreamDefaultReader from SSE lines.
 * Each line is a complete "data: {json}\n" entry.
 */
function mockReader(lines: string[]): ReadableStreamDefaultReader<Uint8Array> {
  const encoder = new TextEncoder();
  const chunks = lines.map(l => encoder.encode(l + '\n'));
  let idx = 0;
  return {
    read: async () => {
      if (idx >= chunks.length) return { done: true, value: undefined } as { done: true; value: undefined };
      return { done: false, value: chunks[idx++] } as { done: false; value: Uint8Array };
    },
    cancel: async () => {},
    releaseLock: () => {},
    closed: Promise.resolve(undefined),
  } as unknown as ReadableStreamDefaultReader<Uint8Array>;
}

function sseData(obj: Record<string, unknown>): string {
  return `data: ${JSON.stringify(obj)}`;
}

function noopCallbacks(overrides: Partial<SSECallbacks> = {}): SSECallbacks {
  return {
    onText: () => {},
    onToolUse: () => {},
    onToolResult: () => {},
    onToolOutput: () => {},
    onToolProgress: () => {},
    onStatus: () => {},
    onResult: () => {},
    onPermissionRequest: () => {},
    onToolTimeout: () => {},
    onModeChanged: () => {},
    onTaskUpdate: () => {},
    onRewindPoint: () => {},
    onKeepAlive: () => {},
    onError: () => {},
    ...overrides,
  };
}

describe('SSE Stream — thinking events', () => {
  it('dispatches onThinking for thinking-type events', async () => {
    const deltas: string[] = [];
    const reader = mockReader([
      sseData({ type: 'thinking', data: 'Analyzing ' }),
      sseData({ type: 'thinking', data: 'the code' }),
      sseData({ type: 'done', data: '' }),
    ]);

    await consumeSSEStream(reader, noopCallbacks({
      onThinking: (d) => deltas.push(d),
    }));

    assert.equal(deltas.length, 2);
    assert.equal(deltas[0], 'Analyzing ');
    assert.equal(deltas[1], 'the code');
  });

  it('does not mix thinking into accumulated text', async () => {
    let lastText = '';
    const reader = mockReader([
      sseData({ type: 'thinking', data: 'secret reasoning' }),
      sseData({ type: 'text', data: 'Hello!' }),
      sseData({ type: 'done', data: '' }),
    ]);

    const result = await consumeSSEStream(reader, noopCallbacks({
      onText: (t) => { lastText = t; },
    }));

    assert.equal(lastText, 'Hello!');
    assert.equal(result.accumulated, 'Hello!');
    assert.ok(!result.accumulated.includes('secret reasoning'));
  });
});

describe('SSE Stream — is_error propagation', () => {
  it('extracts is_error from tool_result events', async () => {
    const results: Array<{ tool_use_id: string; content: string; is_error?: boolean }> = [];
    const reader = mockReader([
      sseData({ type: 'tool_result', data: JSON.stringify({
        tool_use_id: 'tu_1',
        content: 'success output',
      }) }),
      sseData({ type: 'tool_result', data: JSON.stringify({
        tool_use_id: 'tu_2',
        content: 'Error: command failed',
        is_error: true,
      }) }),
      sseData({ type: 'done', data: '' }),
    ]);

    await consumeSSEStream(reader, noopCallbacks({
      onToolResult: (r) => results.push(r),
    }));

    assert.equal(results.length, 2);
    assert.equal(results[0].is_error, undefined);
    assert.equal(results[1].is_error, true);
    assert.equal(results[1].content, 'Error: command failed');
  });
});

describe('SSE Stream — media in tool_result', () => {
  it('passes through media array from tool_result', async () => {
    const results: Array<{ tool_use_id: string; media?: Array<{ type: string }> }> = [];
    const reader = mockReader([
      sseData({ type: 'tool_result', data: JSON.stringify({
        tool_use_id: 'tu_media',
        content: 'Image generated',
        media: [
          { type: 'image', mimeType: 'image/png', localPath: '/tmp/img.png' },
        ],
      }) }),
      sseData({ type: 'done', data: '' }),
    ]);

    await consumeSSEStream(reader, noopCallbacks({
      onToolResult: (r) => results.push(r),
    }));

    assert.equal(results.length, 1);
    assert.ok(results[0].media);
    assert.equal(results[0].media!.length, 1);
    assert.equal(results[0].media![0].type, 'image');
  });

  it('omits media field when no media blocks', async () => {
    const results: Array<{ tool_use_id: string; media?: unknown }> = [];
    const reader = mockReader([
      sseData({ type: 'tool_result', data: JSON.stringify({
        tool_use_id: 'tu_nomedia',
        content: 'plain result',
      }) }),
      sseData({ type: 'done', data: '' }),
    ]);

    await consumeSSEStream(reader, noopCallbacks({
      onToolResult: (r) => results.push(r),
    }));

    assert.equal(results[0].media, undefined);
  });
});
