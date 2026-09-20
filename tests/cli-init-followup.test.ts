import { describe, it, expect, vi, beforeEach } from 'vitest';
vi.mock('child_process', () => ({ execFileSync: vi.fn() }));
vi.mock('node:fs/promises', () => ({ readFile: vi.fn(), writeFile: vi.fn() }));
import { execFileSync } from 'child_process';
import { readFile, writeFile } from 'node:fs/promises';
import {
  _runMcpRegistration,
  _buildMergedMcpContent,
  _currentServerLaunch,
  _formatCommand,
  generateMcpConfig
} from '../src/cli-init.js';
const execute = vi.mocked(execFileSync),
  read = vi.mocked(readFile);
beforeEach(() => vi.resetAllMocks());
describe('returning-user configuration boundaries', () => {
  it('preserves Codex repo A when repo B would overwrite its global registration', () => {
    execute.mockReturnValue(
      JSON.stringify([
        {
          name: 'codebase-context',
          transport: { type: 'stdio', command: 'node', args: ['/server.js', '/repo A'] }
        }
      ])
    );
    const desired = generateMcpConfig('codex', '/repo B', 'stdio', {
      command: 'node',
      args: ['/server.js']
    });
    if (desired.kind !== 'command') throw Error('command expected');
    expect(_runMcpRegistration(desired)).toBe(false);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledWith('codex', ['mcp', 'list', '--json'], { encoding: 'utf8' });
  });
  it('keeps an identical Codex registration without rewriting it', () => {
    execute.mockReturnValue(
      JSON.stringify([
        {
          name: 'codebase-context',
          transport: { type: 'stdio', command: 'node', args: ['/server.js', '/repo A'] }
        }
      ])
    );
    const desired = generateMcpConfig('codex', '/repo A', 'stdio', {
      command: 'node',
      args: ['/server.js']
    });
    if (desired.kind !== 'command') throw Error('command expected');
    expect(_runMcpRegistration(desired)).toBe(true);
    expect(execute).toHaveBeenCalledTimes(1);
  });
  it('adds an absent Codex registration after successful inspection', () => {
    execute.mockReturnValue('[]');
    const desired = generateMcpConfig('codex', '/repo A');
    if (desired.kind !== 'command') throw Error('command expected');
    expect(_runMcpRegistration(desired)).toBe(true);
    expect(execute).toHaveBeenLastCalledWith('codex', desired.args, { stdio: 'inherit' });
  });
  it('does not write if Codex inspection fails', () => {
    execute.mockImplementation(() => {
      throw Error('invalid configuration');
    });
    const desired = generateMcpConfig('codex', '/repo A');
    if (desired.kind !== 'command') throw Error('command expected');
    expect(_runMcpRegistration(desired)).toBe(false);
    expect(execute).toHaveBeenCalledTimes(1);
  });
  for (const content of ['{ invalid', '[]', '{"mcpServers":[]}'])
    it('refuses malformed JSON config: ' + content, async () => {
      read.mockResolvedValue(content);
      await expect(
        _buildMergedMcpContent('/config.json', '{"mcpServers":{}}', 'cursor')
      ).rejects.toThrow();
      expect(writeFile).not.toHaveBeenCalled();
    });
  it('refuses unreadable config but allows a missing file', async () => {
    read.mockRejectedValue(Object.assign(new Error('denied'), { code: 'EACCES' }));
    await expect(_buildMergedMcpContent('/config.json', '{}', 'cursor')).rejects.toThrow(
      'not replaced'
    );
    read.mockRejectedValue(Object.assign(new Error('missing'), { code: 'ENOENT' }));
    await expect(_buildMergedMcpContent('/config.json', '{}', 'cursor')).resolves.toEqual({
      content: '{}',
      mergedFromExisting: false
    });
  });
  it('uses the explicitly selected installation instead of resolving npm latest', () => {
    const launch = {
      command: '/node with spaces/node',
      args: ['/candidate with spaces/dist/index.js']
    };
    for (const client of ['claude-code', 'cursor', 'codex', 'opencode'] as const) {
      const cfg = generateMcpConfig(client, '/repo with spaces', 'stdio', launch);
      const text = JSON.stringify(cfg);
      expect(text).toContain(launch.command);
      expect(text).toContain(launch.args[0]);
      expect(text).not.toContain('npx');
    }
    expect(_currentServerLaunch().command).toBe(process.execPath);
    expect(_currentServerLaunch().args[0]).toMatch(/[/\\]index\.js$/);
  });
  it('labels quoting for POSIX shells and PowerShell separately', () => {
    expect(_formatCommand('node', ["a b'c$HOME"], false)).toBe("'node' 'a b'\"'\"'c$HOME'");
    expect(_formatCommand('C:\\Program Files\\node.exe', ["a'b"], true)).toBe(
      "& 'C:\\Program Files\\node.exe' 'a''b'"
    );
  });
});
