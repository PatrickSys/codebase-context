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

export type McpConfigResult =
  | { kind: 'file'; path: string; content: string }
  | { kind: 'command'; args: string[] };

type JsonObject = Record<string, unknown>;

export function generateMcpConfig(client: Client): McpConfigResult {
  switch (client) {
    case 'claude-code':
      return {
        kind: 'command',
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
        args: ['mcp', 'add', 'codebase-context', 'http://127.0.0.1:3100/mcp']
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

  const mcpResult = generateMcpConfig(client);

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
    console.log(`Command to run: ${mcpResult.args[0]} ${mcpResult.args.slice(1).join(' ')}`);
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
      const [cmd, ...rest] = mcpResult.args;
      try {
        execFileSync(cmd, rest, { stdio: 'inherit' });
      } catch {
        console.log(
          `Could not run '${cmd}' automatically. Run it yourself:\n  ${cmd} ${rest.join(' ')}`
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

  console.log(
    '\nNext steps:\n' +
      '  Run `npx codebase-context map` to see your codebase conventions\n' +
      '  Start the HTTP server: npx codebase-context --http\n'
  );
}
