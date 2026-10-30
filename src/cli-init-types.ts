export const INIT_CLIENTS = [
  {
    id: 'claude-code',
    name: 'Claude Code',
    executable: 'claude',
    directory: '.claude',
    scope: 'project'
  },
  { id: 'codex', name: 'Codex', executable: 'codex', directory: '.codex', scope: 'project' },
  { id: 'cursor', name: 'Cursor', executable: 'cursor', directory: '.cursor', scope: 'project' },
  {
    id: 'vscode',
    name: 'VS Code (Copilot)',
    executable: 'code',
    directory: '.vscode',
    scope: 'project'
  },
  {
    id: 'opencode',
    name: 'OpenCode',
    executable: 'opencode',
    directory: '.opencode',
    scope: 'project'
  }
] as const;

export type InitClient = (typeof INIT_CLIENTS)[number]['id'];

export const DETECT_CLIENTS = [
  ...INIT_CLIENTS,
  {
    id: 'windsurf',
    name: 'Windsurf',
    executable: 'windsurf',
    directory: '.codeium/windsurf',
    scope: 'user'
  },
  {
    id: 'claude-desktop',
    name: 'Claude Desktop',
    executable: '',
    directory: 'Claude',
    scope: 'user'
  }
] as const;

export type Client = (typeof DETECT_CLIENTS)[number]['id'];

export const CLIENTS = DETECT_CLIENTS;

export const INIT_CLIENT_ID_SET: ReadonlySet<string> = new Set(
  INIT_CLIENTS.map((client) => client.id)
);

export function isInitClient(client: Client): client is InitClient {
  return INIT_CLIENT_ID_SET.has(client);
}
