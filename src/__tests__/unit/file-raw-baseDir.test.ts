/**
 * 验证 /api/files/raw 的 baseDir 安全模型与 /api/files/preview 一致。
 * 这些测试直接测 isPathSafe / isRootPath 逻辑，而非通过 HTTP。
 *
 * Run: npx tsx src/__tests__/unit/file-raw-baseDir.test.ts
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import path from 'path';
import os from 'os';
import { isPathSafe, isRootPath } from '../../lib/files';

describe('raw 路由 baseDir 安全校验逻辑', () => {
  const homeDir = os.homedir();

  it('baseDir 是根路径时 isRootPath 应返回 true', () => {
    assert.equal(isRootPath('/'), true);
    if (process.platform === 'win32') {
      assert.equal(isRootPath('C:\\'), true);
    }
  });

  it('正常项目目录不是根路径', () => {
    assert.equal(isRootPath(path.join(homeDir, 'projects', 'myapp')), false);
  });

  it('baseDir 提供时：项目内文件应通过校验', () => {
    const baseDir = path.join(homeDir, 'projects', 'myapp');
    const filePath = path.join(baseDir, 'src', 'index.ts');
    assert.equal(isPathSafe(baseDir, filePath), true);
  });

  it('baseDir 提供时：项目外文件应被拒绝', () => {
    const baseDir = path.join(homeDir, 'projects', 'myapp');
    assert.equal(isPathSafe(baseDir, '/etc/passwd'), false);
    assert.equal(isPathSafe(baseDir, path.join(homeDir, 'other-project', 'secret.ts')), false);
  });

  it('未提供 baseDir 时：homeDir 回退——home 内文件应通过', () => {
    const filePath = path.join(homeDir, 'projects', 'myapp', 'index.ts');
    assert.equal(isPathSafe(homeDir, filePath), true);
  });

  it('未提供 baseDir 时：homeDir 回退——home 外文件应被拒绝', () => {
    assert.equal(isPathSafe(homeDir, '/etc/passwd'), false);
  });
});
