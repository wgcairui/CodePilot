export interface CheckResult {
  os: 'Darwin' | 'Linux' | 'unknown';
  nodeVersion: string | null;
  claudeVersion: string | null;
  agentVersion: string | null;
}

export interface InstallPlan {
  needsNode: boolean;
  needsClaude: boolean;
  needsAgentDeploy: boolean;
  nodeCommands: string[];
  claudeCommands: string[];
}

export interface RemoteHostConfig {
  id: string;
  host: string;
  port: number;
  username: string;
  authType: 'key' | 'password';
  keyPath?: string;
  encryptedPassword?: string; // base64 of electron.safeStorage encrypted buffer
  agentPort: number;
}

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'reconnecting' | 'failed';

export interface ConnectionState {
  hostId: string;
  status: ConnectionStatus;
  localPort: number | null;
  error?: string;
}
