/**
 * Interactive setup wizard for codebase-context.
 * Handles `codebase-context init` — generates MCP config and instruction block
 * for the four first-wave AI clients: Claude Code, Cursor, Codex, OpenCode.
 *
 * Depends only on Node built-ins and @inquirer/prompts.
 * No imports from the rest of the codebase — keeps this module side-effect-free
 * outside the wizard call and easy to unit test.
 */

import path from 'path';
import { fileURLToPath } from 'node:url';
import * as fs from 'node:fs/promises';
import { execFileSync } from 'child_process';
import { select, confirm } from '@inquirer/prompts';

export type Client = 'claude-code' | 'cursor' | 'codex' | 'opencode';
export type ConnectionMode = 'stdio' | 'http';
export type ServerLaunch = { command: string; args: string[] };

/** Bind wizard registrations to this installation, including source candidates. */
export function _currentServerLaunch(): ServerLaunch {
  return {
    command: process.execPath,
    args: [path.join(path.dirname(fileURLToPath(import.meta.url)), 'index.js')]
  };
}

/** Display a pasteable command for POSIX shells or PowerShell (not cmd.exe). */
export function _formatCommand(
  command: string,
  args: string[],
  powershell = process.platform === 'win32'
): string {
  const quote = (value: string): string =>
    powershell ? "'" + value.replace(/'/g, "''") + "'" : "'" + value.replace(/'/g, "'\"'\"'") + "'";
  return (powershell ? '& ' : '') + [command, ...args].map(quote).join(' ');
}

export type McpConfigResult =
  | { kind: 'file'; path: string; content: string }
  | { kind: 'command'; command: 'claude' | 'codex'; args: string[] };

type CommandMcpConfig = Extract<McpConfigResult, { kind: 'command' }>;

type JsonObject = Record<string, unknown>;

/** Execute a confirmed CLI registration using the client executable. */
export function _runMcpRegistration(result: CommandMcpConfig): boolean {
  try {
    if (result.command === 'codex') {
      // The CLI writes one user-level entry. Never silently repoint another repo.
      const entries: unknown = JSON.parse(
        execFileSync('codex', ['mcp', 'list', '--json'], { encoding: 'utf8' })
      );
      if (!Array.isArray(entries)) throw new Error('Cannot inspect existing Codex registrations.');
      const current: unknown = entries.find(
        (entry: unknown) => isJsonObject(entry) && entry.name === 'codebase-context'
      );
      if (current !== undefined) {
        if (!isJsonObject(current) || !isJsonObject(current.transport)) {
          throw new Error('Cannot inspect the existing Codex transport.');
        }
        const urlIndex = result.args.indexOf('--url');
        const commandIndex = result.args.indexOf('--') + 1;
        const identical =
          urlIndex !== -1
            ? current.transport.type === 'streamable_http' &&
              current.transport.url === result.args[urlIndex + 1]
            : current.transport.type === 'stdio' &&
              current.transport.command === result.args[commandIndex] &&
              JSON.stringify(current.transport.args) ===
                JSON.stringify(result.args.slice(commandIndex + 1));
        if (identical) return true;
        console.error(
          'Existing Codex codebase-context entry differs; preserved it. Use an isolated CODEX_HOME or review trusted project configuration before configuring another repository.'
        );
        return false;
      }
    }
    execFileSync(result.command, result.args, { stdio: 'inherit' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Generate a client registration for one repository.
 *
 * Stdio is the recommended first-use path. The absolute repository argument
 * makes the server's project attribution deterministic even when the client
 * does not advertise workspace roots. HTTP is deliberately explicit because
 * it requires a separately owned long-lived server process.
 */
export function generateMcpConfig(
  client: Client,
  cwd = process.cwd(),
  mode: ConnectionMode = 'stdio',
  launch: ServerLaunch = { command: 'npx', args: ['-y', 'codebase-context'] }
): McpConfigResult {
  const rootPath = path.resolve(cwd);

  if (mode === 'stdio') {
    switch (client) {
      case 'claude-code':
        return {
          kind: 'command',
          command: 'claude',
          args: [
            'mcp',
            'add',
            '--transport',
            'stdio',
            'codebase-context',
            '--',
            launch.command,
            ...launch.args,
            rootPath
          ]
        };
      case 'cursor':
        return {
          kind: 'file',
          path: '.cursor/mcp.json',
          content: JSON.stringify(
            {
              mcpServers: {
                'codebase-context': {
                  command: launch.command,
                  args: [...launch.args, rootPath]
                }
              }
            },
            null,
            2
          )
        };
      case 'codex':
        return {
          kind: 'command',
          command: 'codex',
          args: ['mcp', 'add', 'codebase-context', '--', launch.command, ...launch.args, rootPath]
        };
      case 'opencode':
        return {
          kind: 'file',
          path: 'opencode.json',
          content: JSON.stringify(
            {
              $schema: 'https://opencode.ai/config.json',
              mcp: {
                'codebase-context': {
                  type: 'local',
                  command: [launch.command, ...launch.args, rootPath],
                  enabled: true
                }
              }
            },
            null,
            2
          )
        };
    }
  }

  switch (client) {
    case 'claude-code':
      return {
        kind: 'command',
        command: 'claude',
        args: ['mcp', 'add', '--transport', 'http', 'codebase-context', 'http://127.0.0.1:3100/mcp']
      };
    case 'cursor':
      return {
        kind: 'file',
        path: '.cursor/mcp.json',
        content: JSON.stringify(
          {
            mcpServers: {
              'codebase-context': {
                type: 'http',
                url: 'http://127.0.0.1:3100/mcp'
              }
            }
          },
          null,
          2
        )
      };
    case 'codex':
      return {
        kind: 'command',
        command: 'codex',
        args: ['mcp', 'add', 'codebase-context', '--url', 'http://127.0.0.1:3100/mcp']
      };
    case 'opencode':
      return {
        kind: 'file',
        path: 'opencode.json',
        content: JSON.stringify(
          {
            $schema: 'https://opencode.ai/config.json',
            mcp: {
              'codebase-context': {
                type: 'remote',
                url: 'http://127.0.0.1:3100/mcp'
              }
            }
          },
          null,
          2
        )
      };
  }
}

export function generateInstructionBlock(): string {
  return `<!-- codebase-context:start -->
## Codebase Context (MCP)

**Start of every task:** Read \`codebase://context\` (or run \`map\`) to load the bounded conventions map before searching or editing.

**Then, when prior decisions or team history matter:** Call \`get_memory\` before writing code.

**Before editing existing code:** Call \`search_codebase\` with \`intent: "edit"\`. If the preflight card says \`ready: false\`, read the listed files before touching anything.

**Before writing new code:** Call \`get_team_patterns\` to check how the team handles DI, state, testing, and library wrappers — don't introduce a new pattern if one already exists.

**When asked to "remember" or "record" something:** Call \`remember\` immediately, before doing anything else.

**When adding imports that cross module boundaries:** Call \`detect_circular_dependencies\` with the relevant scope after adding the import.
<!-- codebase-context:end -->
`;
}

/** The block generated before the context-map-first setup was introduced. */
function generateLegacyInstructionBlock(): string {
  return `<!-- codebase-context:start -->
## Codebase Context (MCP)

**Start of every task:** Call \`get_memory\` to load team conventions before writing any code.

**Before editing existing code:** Call \`search_codebase\` with \`intent: "edit"\`. If the preflight card says \`ready: false\`, read the listed files before touching anything.

**Before writing new code:** Call \`get_team_patterns\` to check how the team handles DI, state, testing, and library wrappers — don't introduce a new pattern if one already exists.

**When asked to "remember" or "record" something:** Call \`remember\` immediately, before doing anything else.

**When adding imports that cross module boundaries:** Call \`detect_circular_dependencies\` with the relevant scope after adding the import.
<!-- codebase-context:end -->
`;
}

export function resolveInstructionFilePath(client: Client, cwd: string): string | null {
  switch (client) {
    case 'claude-code':
      return path.join(cwd, 'CLAUDE.md');
    case 'cursor':
      return path.join(cwd, '.cursorrules');
    case 'codex':
      return path.join(cwd, 'AGENTS.md');
    case 'opencode':
      return null;
  }
}

/**
 * Appends the instruction block to an existing file, or skips if already present.
 * Exported with leading underscore to signal internal/test-only use.
 */
export type InstructionBlockWriteResult = 'written' | 'skipped' | 'upgraded' | 'preserved';

export async function _appendInstructionBlock(
  filePath: string,
  options: { confirmUpgrade?: () => Promise<boolean> } = {}
): Promise<InstructionBlockWriteResult> {
  let existing = '';
  try {
    existing = await fs.readFile(filePath, 'utf8');
  } catch (error: unknown) {
    if (isNodeError(error) && error.code === 'ENOENT') {
      await fs.writeFile(filePath, generateInstructionBlock(), 'utf8');
      return 'written';
    }
    throw error;
  }

  const startMarker = '<!-- codebase-context:start -->';
  const endMarker = '<!-- codebase-context:end -->';
  const startCount = existing.split(startMarker).length - 1;
  const endCount = existing.split(endMarker).length - 1;
  if (startCount !== 0 || endCount !== 0) {
    if (startCount !== 1 || endCount !== 1) return 'preserved';
    const start = existing.indexOf(startMarker);
    const end = existing.indexOf(endMarker, start);
    if (end === -1) return 'preserved';
    const endExclusive = end + endMarker.length;
    const currentBlock = existing.slice(start, endExclusive);
    const normalizedBlock = currentBlock.replace(/\r\n/g, '\n');
    const currentGenerated = generateInstructionBlock().trimEnd();
    if (normalizedBlock === currentGenerated) return 'skipped';
    if (normalizedBlock !== generateLegacyInstructionBlock().trimEnd()) return 'preserved';

    const approved = options.confirmUpgrade ? await options.confirmUpgrade() : false;
    if (!approved) return 'preserved';

    const replacement = currentBlock.includes('\r\n')
      ? generateInstructionBlock().trimEnd().replace(/\n/g, '\r\n')
      : currentGenerated;
    await fs.writeFile(
      filePath,
      existing.slice(0, start) + replacement + existing.slice(endExclusive),
      'utf8'
    );
    return 'upgraded';
  }

  await fs.writeFile(filePath, existing + '\n' + generateInstructionBlock(), 'utf8');
  return 'written';
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Merge generated MCP config into an existing JSON config file when possible.
 * Preserves unrelated keys and only updates the codebase-context server entry.
 */
export async function _buildMergedMcpContent(
  filePath: string,
  generatedContent: string,
  client: Extract<Client, 'cursor' | 'opencode'>
): Promise<{ content: string; mergedFromExisting: boolean }> {
  let existing: unknown;
  try {
    existing = JSON.parse(await fs.readFile(filePath, 'utf8'));
  } catch (error: unknown) {
    if (isNodeError(error) && error.code === 'ENOENT') {
      return { content: generatedContent, mergedFromExisting: false };
    }
    throw new Error(`Cannot safely read/parse ${filePath}; existing config was not replaced.`, {
      cause: error
    });
  }

  const generated = JSON.parse(generatedContent) as unknown;
  if (!isJsonObject(existing) || !isJsonObject(generated)) {
    throw new Error(`Expected a JSON object in ${filePath}; existing config was not replaced.`);
  }
  const key = client === 'cursor' ? 'mcpServers' : 'mcp';
  if (key in existing && !isJsonObject(existing[key])) {
    throw new Error(
      `Expected an object at ${key} in ${filePath}; existing config was not replaced.`
    );
  }

  if (client === 'cursor') {
    const existingServers = isJsonObject(existing.mcpServers) ? existing.mcpServers : {};
    const generatedServers = isJsonObject(generated.mcpServers) ? generated.mcpServers : {};
    return {
      content: JSON.stringify(
        {
          ...existing,
          ...generated,
          mcpServers: {
            ...existingServers,
            ...generatedServers
          }
        },
        null,
        2
      ),
      mergedFromExisting: true
    };
  }

  const existingMcp = isJsonObject(existing.mcp) ? existing.mcp : {};
  const generatedMcp = isJsonObject(generated.mcp) ? generated.mcp : {};
  return {
    content: JSON.stringify(
      {
        ...existing,
        ...generated,
        mcp: {
          ...existingMcp,
          ...generatedMcp
        }
      },
      null,
      2
    ),
    mergedFromExisting: true
  };
}

export async function handleInitCli(_argv: string[]): Promise<void> {
  console.log('\nSet up codebase-context for your AI client\n');

  const client = await select<Client>({
    message: 'Which client?',
    choices: [
      { name: 'Claude Code', value: 'claude-code' },
      { name: 'Cursor', value: 'cursor' },
      { name: 'Codex', value: 'codex' },
      { name: 'OpenCode', value: 'opencode' }
    ]
  });

  const mode = await select<ConnectionMode>({
    message: 'Connection mode?',
    choices: [
      {
        name: 'stdio (recommended: client owns one local server for this repo)',
        value: 'stdio'
      },
      {
        name: 'HTTP (advanced: share a separately started server across clients)',
        value: 'http'
      }
    ]
  });

  const rootPath = path.resolve(process.cwd());
  const launch = _currentServerLaunch();
  const mcpResult = generateMcpConfig(client, rootPath, mode, launch);
  console.log(
    'This registration uses the running installation shown below. Keep that path available; it does not resolve npm latest.'
  );
  if (client === 'codex') {
    console.log(
      'Codex mcp add writes user configuration, not project-local config. An existing different entry will be preserved. See docs/client-setup.md for trusted project configuration.'
    );
  }

  console.log('\n--- MCP Config Preview ---');
  if (mcpResult.kind === 'file') {
    try {
      await fs.access(mcpResult.path);
      console.log(
        `Warning: ${mcpResult.path} already exists; valid unrelated entries will be preserved; malformed or unreadable config will be refused.`
      );
    } catch {
      // file does not exist
    }
    console.log(`File: ${mcpResult.path}\n${mcpResult.content}`);
  } else {
    console.log(`Command to run: ${_formatCommand(mcpResult.command, mcpResult.args)}`);
  }

  const applyMcp = await confirm({
    message: 'Apply MCP config? [y/N]',
    default: false
  });

  const instructionPath = resolveInstructionFilePath(client, process.cwd());

  let applyInstruction = false;
  if (instructionPath !== null) {
    let fileExists = false;
    try {
      await fs.access(instructionPath);
      fileExists = true;
    } catch {
      // does not exist
    }

    if (fileExists) {
      console.log(
        `\n--- Instruction Block Preview (existing content will be checked in ${instructionPath}) ---`
      );
    } else {
      console.log(`\n--- Instruction Block Preview (will create ${instructionPath}) ---`);
    }
    console.log(generateInstructionBlock());

    applyInstruction = await confirm({
      message: 'Write instruction block? [y/N]',
      default: false
    });
  }

  // Execute confirmed actions

  if (applyMcp) {
    if (mcpResult.kind === 'file') {
      const dir = path.dirname(mcpResult.path);
      if (dir && dir !== '.') {
        await fs.mkdir(dir, { recursive: true });
      }
      const mergedConfig =
        client === 'cursor' || client === 'opencode'
          ? await _buildMergedMcpContent(mcpResult.path, mcpResult.content, client)
          : { content: mcpResult.content, mergedFromExisting: false };
      await fs.writeFile(mcpResult.path, mergedConfig.content, 'utf8');
      if (mergedConfig.mergedFromExisting) {
        console.log(`Merged: ${mcpResult.path} (existing entries preserved)`);
      }
      console.log(`Written: ${mcpResult.path}`);
    } else {
      if (!_runMcpRegistration(mcpResult)) {
        console.log(
          mcpResult.command === 'codex'
            ? 'Codex registration was not changed. Inspect existing user configuration; use isolated CODEX_HOME for this candidate trial. Do not overwrite another repository entry.'
            : `Could not run '${mcpResult.command}' automatically. Review and run this command in ${process.platform === 'win32' ? 'PowerShell' : 'a POSIX shell'}:\n  ${_formatCommand(mcpResult.command, mcpResult.args)}`
        );
      }
    }
  }

  if (applyInstruction && instructionPath !== null) {
    const status = await _appendInstructionBlock(instructionPath, {
      confirmUpgrade: async () => {
        console.log('\n--- Existing generated instruction block upgrade preview ---');
        console.log(generateInstructionBlock());
        return confirm({
          message: 'Replace the old generated block with this version? [y/N]',
          default: false
        });
      }
    });
    if (status === 'skipped') {
      console.log(`Instruction block already present in ${instructionPath}, skipping.`);
    } else if (status === 'preserved') {
      console.log(
        `Existing instruction content in ${instructionPath} was preserved; no generated block was replaced.`
      );
    } else if (status === 'upgraded') {
      console.log(`Upgraded generated instruction block in ${instructionPath}.`);
    } else {
      console.log(`Written: ${instructionPath}`);
    }
  }

  const nextSteps = [
    '\nNext steps:',
    '  Read `codebase://context` in the client for the conventions map.',
    mode === 'http'
      ? `  Start this installation separately: ${_formatCommand(launch.command, [...launch.args, '--http', rootPath])}`
      : '  Open the client in this repository; it will start the registered stdio process on demand.'
  ];
  console.log(nextSteps.join('\n') + '\n');
}
