import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codepilot-test-'));
process.env.CLAUDE_GUI_DATA_DIR = tmpDir;

/* eslint-disable @typescript-eslint/no-require-imports */
const { getDb, createRemoteHost, listRemoteHosts } = require('../../lib/db');

describe('remote_hosts DB', () => {
  it('remote_hosts table exists', () => {
    const db = getDb();
    const table = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='remote_hosts'"
    ).get();
    assert.ok(table, 'remote_hosts table should exist');
  });

  it('can create and list remote hosts', () => {
    createRemoteHost({
      name: 'Test Host', host: '192.168.1.100', port: 22,
      username: 'user', authType: 'key', keyPath: '~/.ssh/id_rsa',
      workDir: '/home/user/projects',
    });
    const hosts = listRemoteHosts();
    assert.equal(hosts.length, 1);
    assert.equal(hosts[0].name, 'Test Host');
    assert.equal(hosts[0].status, 'disconnected');
  });

  it('chat_sessions has remote_host_id column', () => {
    const db = getDb();
    const cols = db.prepare('PRAGMA table_info(chat_sessions)').all() as { name: string }[];
    assert.ok(cols.some(c => c.name === 'remote_host_id'), 'remote_host_id column missing');
  });

  after(() => { fs.rmSync(tmpDir, { recursive: true }); });
});
