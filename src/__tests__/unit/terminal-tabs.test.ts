/**
 * Unit tests for terminal tab pure helpers.
 * Run: npx tsx --test src/__tests__/unit/terminal-tabs.test.ts
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

describe('terminal tab helpers', () => {
  it('buildNewTab creates tab with unique id and ptyId', async () => {
    const { buildNewTab } = await import('../../hooks/useTerminalTabs');
    const tab = buildNewTab('bash');
    assert.ok(tab.id.startsWith('tab-'), `id should start with tab-, got: ${tab.id}`);
    assert.ok(tab.ptyId.startsWith('pty-'), `ptyId should start with pty-, got: ${tab.ptyId}`);
    assert.equal(tab.title, 'bash');
  });

  it('buildNewTab generates unique ids on each call', async () => {
    const { buildNewTab } = await import('../../hooks/useTerminalTabs');
    const a = buildNewTab('bash');
    const b = buildNewTab('bash');
    assert.notEqual(a.id, b.id);
    assert.notEqual(a.ptyId, b.ptyId);
  });

  it('removeTab removes the specified tab', async () => {
    const { buildNewTab, removeTab } = await import('../../hooks/useTerminalTabs');
    const t1 = buildNewTab('bash');
    const t2 = buildNewTab('bash');
    const result = removeTab([t1, t2], t1.id);
    assert.equal(result.length, 1);
    assert.equal(result[0].id, t2.id);
  });

  it('updateTabTitle updates only the matching tab', async () => {
    const { buildNewTab, updateTabTitle } = await import('../../hooks/useTerminalTabs');
    const t1 = buildNewTab('bash');
    const t2 = buildNewTab('bash');
    const result = updateTabTitle([t1, t2], t1.id, 'vim');
    assert.equal(result.find(t => t.id === t1.id)!.title, 'vim');
    assert.equal(result.find(t => t.id === t2.id)!.title, 'bash');
  });
});
