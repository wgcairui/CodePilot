import type { Client } from 'ssh2';
import fs from 'node:fs';
import type { CheckResult, InstallPlan } from './types';
export type { CheckResult, InstallPlan } from './types';
import { createLogger } from '../logger.js';

const logger = createLogger('setup');

/** Execute a command with a custom timeout (ms). Resolves to null on timeout or error. */
function sshExecWithTimeout(client: Client, cmd: string, timeoutMs = 30_000): Promise<string | null> {
  return new Promise(resolve => {
    const timer = setTimeout(() => resolve(null), timeoutMs);
    client.exec(cmd, (err, stream) => {
      if (err) { clearTimeout(timer); resolve(null); return; }
      let out = '';
      stream.on('data', (d: Buffer) => { out += d.toString(); });
      stream.stderr.on('data', () => {});
      stream.on('close', () => { clearTimeout(timer); resolve(out.trim()); });
    });
  });
}

async function sshExec(client: Client, cmd: string): Promise<string | null> {
  return sshExecWithTimeout(client, cmd, 30_000);
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

export interface AutoInstallResult {
  success: boolean;
  error?: string;
  nodeInstalled?: boolean;
  claudeInstalled?: boolean;
}

/**
 * Installs Node.js and Claude CLI on the remote host as needed.
 * Installs Node.js via the OS package manager, then Claude CLI via npm.
 */
export async function autoInstallDeps(
  client: Client,
  installPlan: InstallPlan,
  os: 'Darwin' | 'Linux' | 'unknown'
): Promise<AutoInstallResult> {
  logger.info('Starting auto-install', { installPlan });

  if (!installPlan.needsNode && !installPlan.needsClaude) {
    return { success: true };
  }

  // Build the Node.js install command based on OS
  let nodeInstallCmd: string;
  if (os === 'Darwin') {
    nodeInstallCmd = 'brew install node';
  } else if (os === 'Linux') {
    // Try to detect the package manager
    nodeInstallCmd = 'command -v apt-get > /dev/null 2>&1 && sudo apt-get update && sudo apt-get install -y nodejs npm || (command -v dnf > /dev/null 2>&1 && sudo dnf install -y nodejs npm || (command -v yum > /dev/null 2>&1 && sudo yum install -y nodejs npm || echo "ERROR:NoPackageManager"))';
  } else {
    nodeInstallCmd = 'curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash && export NVM_DIR="$HOME/.nvm" && [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh" && nvm install --lts';
  }

  const errors: string[] = [];

  if (installPlan.needsNode) {
    logger.info('Installing Node.js', { os, cmd: nodeInstallCmd });
    // Use a longer timeout for package manager operations
    const result = await sshExecWithTimeout(client, nodeInstallCmd, 300_000);
    if (!result) {
      errors.push('Node.js installation timed out or failed (no output)');
    } else if (result.includes('ERROR:NoPackageManager')) {
      errors.push('Could not find a supported package manager (apt/dnf/yum) to install Node.js');
    } else {
      // Verify node is now available
      const nodeVersion = await sshExec(client, 'node --version 2>/dev/null');
      if (!nodeVersion?.startsWith('v')) {
        errors.push(`Node.js installation may have failed: ${nodeVersion ?? 'node not found'}`);
      } else {
        logger.info('Node.js installed successfully', { version: nodeVersion });
      }
    }
  }

  if (installPlan.needsClaude) {
    logger.info('Installing Claude CLI');
    const npmResult = await sshExecWithTimeout(client, 'npm install -g @anthropic-ai/claude-code', 300_000);
    if (!npmResult) {
      errors.push('Claude CLI installation timed out or failed (no output)');
    } else {
      const claudeVersion = await sshExec(client, 'claude --version 2>/dev/null');
      if (!claudeVersion?.includes('claude')) {
        errors.push(`Claude CLI installation may have failed: ${claudeVersion ?? 'claude not found'}`);
      } else {
        logger.info('Claude CLI installed successfully', { version: claudeVersion });
      }
    }
  }

  if (errors.length > 0) {
    const errorMsg = errors.join('; ');
    logger.error('Auto-install failed', { errors });
    return { success: false, error: errorMsg };
  }

  return { success: true };
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
