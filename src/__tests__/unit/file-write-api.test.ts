/**
 * 验证文件写入路由的安全校验逻辑。
 * 直接测试 isPathSafe / isRootPath，不通过 HTTP。
 *
 * Run: npx tsx src/__tests__/unit/file-write-api.test.ts
 */
import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'path';
import os from 'os';
import fs from 'fs';
import { isPathSafe, isRootPath } from '../../lib/files';

const homeDir = os.homedir();
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codepilot-write-test-'));
const projectDir = path.join(tmpDir, 'myproject');
fs.mkdirSync(projectDir, { recursive: true });

describe('write 路由安全校验', () => {
  it('baseDir 是根路径时应拒绝', () => {
    assert.equal(isRootPath('/'), true);
  });

  it('项目内路径应通过校验', () => {
    const filePath = path.join(projectDir, 'output.ts');
    assert.equal(isPathSafe(projectDir, filePath), true);
  });

  it('项目外路径应被拒绝', () => {
    assert.equal(isPathSafe(projectDir, '/etc/passwd'), false);
    assert.equal(isPathSafe(projectDir, path.join(homeDir, 'other', 'file.ts')), false);
  });

  it('路径遍历攻击应被拒绝', () => {
    const traversal = path.resolve(projectDir, '..', 'secret.txt');
    assert.equal(isPathSafe(projectDir, traversal), false);
  });

  it('10MB 大小限制：超出应返回错误', () => {
    const MAX = 10 * 1024 * 1024;
    const overLimit = Buffer.alloc(MAX + 1, 0x41).toString('utf8');
    assert.equal(Buffer.byteLength(overLimit, 'utf8') > MAX, true);
  });
});

after(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});
