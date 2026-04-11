import type { Client } from 'ssh2';
import fs from 'node:fs';
import type { CheckResult, InstallPlan } from './types';
export type { CheckResult, InstallPlan } from './types';
import { createLogger } from '../logger.js';

const logger = createLogger('setup');

async function sshExec(client: Client, cmd: string): Promise<string | null> {
  return new Promise(resolve => {
    const timer = setTimeout(() => resolve(null), 10_000);
    client.exec(cmd, (err, stream) => {
      if (err) { clearTimeout(timer); resolve(null); return; }
      let out = '';
      stream.on('data', (d: Buffer) => { out += d.toString(); });
      stream.stderr.on('data', () => {});
      stream.on('close', () => { clearTimeout(timer); resolve(out.trim()); });
    });
  });
}

export async function checkRemoteEnv(client: Client): Promise<CheckResult> {
  logger.info('Checking remote environment');
  const [osRaw, nodeRaw, claudeRaw, agentHead] = await Promise.all([
    sshExec(client, 'uname -s'),
    sshExec(client, 'node --version 2>/dev/null'),
    sshExec(client, 'claude --version 2>/dev/null'),
    sshExec(client, 'head -1 ~/.codepilot/agent.js 2>/dev/null || echo ""'),
  ]);
  const result: CheckResult = {
    os: osRaw === 'Darwin' ? 'Darwin' : osRaw === 'Linux' ? 'Linux' : 'unknown',
    nodeVersion: nodeRaw?.startsWith('v') ? nodeRaw : null,
    claudeVersion: claudeRaw?.includes('claude') ? claudeRaw : null,
    agentVersion: agentHead?.match(/CODEPILOT_AGENT_VERSION=(\S+)/)?.[1] ?? null,
  };
  logger.info('Environment check result', { result });
  return result;
}

export function buildInstallPlan(result: CheckResult, localAgentVersion: string): InstallPlan {
  const nodeCommands: Record<string, string[]> = {
    Darwin: ['brew install node'],
    Linux: [
      '# Debian/Ubuntu:', 'sudo apt-get update && sudo apt-get install -y nodejs npm',
      '# RHEL/Fedora:', 'sudo dnf install -y nodejs npm',
    ],
    unknown: ['curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash && nvm install --lts'],
  };
  return {
    needsNode: !result.nodeVersion,
    needsClaude: !result.claudeVersion,
    needsAgentDeploy: !result.agentVersion || result.agentVersion !== localAgentVersion,
    nodeCommands: nodeCommands[result.os] ?? nodeCommands.unknown,
    claudeCommands: ['npm install -g @anthropic-ai/claude-code'],
  };
}

export async function deployAgent(client: Client, localAgentPath: string): Promise<void> {
  logger.info('Deploying agent', { localAgentPath });
  let content: Buffer;
  let remoteHome: string;
  try {
    [content, remoteHome] = await Promise.all([
      fs.promises.readFile(localAgentPath),
      sshExec(client, 'echo $HOME').then(h => h ?? '/root'),
    ]);
    logger.info('Agent file and remote home resolved', { size: content.length, remoteHome });
  } catch (err) {
    logger.error('Failed to prepare deployment', { error: String(err) });
    throw err;
  }
  return new Promise((resolve, reject) => {
    client.sftp((err, sftp) => {
      if (err) {
        logger.error('SFTP open failed', { error: String(err) });
        reject(err);
        return;
      }
      client.exec('mkdir -p ~/.codepilot', (e2) => {
        if (e2) {
          logger.error('mkdir failed', { error: String(e2) });
          reject(e2);
          return;
        }
        const remote = `${remoteHome}/.codepilot/agent.js`;
        logger.info('Deploying to remote', { remote });
        const ws = sftp.createWriteStream(remote);
        ws.on('close', () => {
          logger.info('Agent deployed successfully');
          resolve();
        });
        ws.on('error', (e) => {
          logger.error('SFTP write error', { error: String(e) });
          reject(e);
        });
        ws.end(content);
      });
    });
  });
}

export async function startRemoteAgent(client: Client, port: number): Promise<void> {
  logger.info('Starting remote agent', { port });
  return new Promise((resolve, reject) => {
    client.exec(
      `nohup node ~/.codepilot/agent.js --port=${port} >> ~/.codepilot/agent.log 2>&1 &`,
      (err, stream) => {
        if (err) {
          logger.error('Start agent exec failed', { error: String(err) });
          reject(err);
          return;
        }
        logger.info('Start agent command executed');
        stream.on('close', () => {
          logger.info('Remote agent started', { port });
          resolve();
        });
      }
    );
  });
}

export async function isAgentRunning(client: Client, port: number): Promise<boolean> {
  const result = await sshExec(client, `nc -z 127.0.0.1 ${port} 2>/dev/null && echo ok || echo no`);
  return result?.trim() === 'ok';
}
