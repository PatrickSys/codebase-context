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
import * as fs from 'node:fs/promises';
import { execFileSync } from 'child_process';
import { select, confirm } from '@inquirer/prompts';

export type Client = 'claude-code' | 'cursor' | 'codex' | 'opencode';
export type ConnectionMode = 'stdio' | 'http';

export type McpConfigResult =
  | { kind: 'file'; path: string; content: string }
  | { kind: 'command'; command: 'claude' | 'codex'; args: string[] };

type CommandMcpConfig = Extract<McpConfigResult, { kind: 'command' }>;

type JsonObject = Record<string, unknown>;

/** Execute a confirmed CLI registration using the client executable. */
export function _runMcpRegistration(result: CommandMcpConfig): boolean {
  try {
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
  mode: ConnectionMode = 'stdio'
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
            'npx',
            '-y',
            'codebase-context',
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
                  command: 'npx',
                  args: ['-y', 'codebase-context', rootPath]
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
          args: ['mcp', 'add', 'codebase-context', '--', 'npx', '-y', 'codebase-context', rootPath]
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
                  command: ['npx', '-y', 'codebase-context', rootPath],
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
export async function _appendInstructionBlock(filePath: string): Promise<'written' | 'skipped'> {
  let existing = '';
  try {
    existing = await fs.readFile(filePath, 'utf8');
  } catch {
    // file does not exist — write fresh
    await fs.writeFile(filePath, generateInstructionBlock(), 'utf8');
    return 'written';
  }

  if (existing.includes('<!-- codebase-context:start -->')) {
    return 'skipped';
  }

  await fs.writeFile(filePath, existing + '\n' + generateInstructionBlock(), 'utf8');
  return 'written';
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
  } catch {
    return { content: generatedContent, mergedFromExisting: false };
  }

  const generated = JSON.parse(generatedContent) as unknown;
  if (!isJsonObject(existing) || !isJsonObject(generated)) {
    return { content: generatedContent, mergedFromExisting: false };
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
  const mcpResult = generateMcpConfig(client, rootPath, mode);

  console.log('\n--- MCP Config Preview ---');
  if (mcpResult.kind === 'file') {
    try {
      await fs.access(mcpResult.path);
      console.log(`Warning: ${mcpResult.path} already exists; existing entries will be preserved.`);
    } catch {
      // file does not exist
    }
    console.log(`File: ${mcpResult.path}\n${mcpResult.content}`);
  } else {
    console.log(`Command to run: ${mcpResult.command} ${mcpResult.args.join(' ')}`);
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
      console.log(`\n--- Instruction Block Preview (will append to ${instructionPath}) ---`);
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
          `Could not run '${mcpResult.command}' automatically. Run it yourself:\n  ${mcpResult.command} ${mcpResult.args.join(' ')}`
        );
      }
    }
  }

  if (applyInstruction && instructionPath !== null) {
    const status = await _appendInstructionBlock(instructionPath);
    if (status === 'skipped') {
      console.log(`Instruction block already present in ${instructionPath}, skipping.`);
    } else {
      console.log(`Written: ${instructionPath}`);
    }
  }

  const nextSteps = [
    '\nNext steps:',
    '  Read `codebase://context` (or run `npx codebase-context map`) for the conventions map.',
    mode === 'http'
      ? `  Start the registered HTTP server separately: npx codebase-context --http "${rootPath}"`
      : '  Open the client in this repository; it will start the registered stdio process on demand.'
  ];
  console.log(nextSteps.join('\n') + '\n');
}
