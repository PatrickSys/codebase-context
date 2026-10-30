import { spawnSync } from 'node:child_process';

export type CommandRunResult = {
  status: number | null;
  stdout: string;
  stderr: string;
  error: Error | null;
};

export type CommandRunner = (
  file: string,
  args: string[],
  options?: { cwd?: string; env?: NodeJS.ProcessEnv }
) => CommandRunResult;

function defaultRunner(
  file: string,
  args: string[],
  options: { cwd?: string; env?: NodeJS.ProcessEnv } = {}
): CommandRunResult {
  const result = spawnSync(file, args, {
    cwd: options.cwd,
    env: options.env ?? process.env,
    encoding: 'utf8',
    shell: false
  });
  return {
    status: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    error: result.error ?? null
  };
}

let commandRunner: CommandRunner = defaultRunner;

export function runCommand(
  file: string,
  args: string[],
  options?: { cwd?: string; env?: NodeJS.ProcessEnv }
): CommandRunResult {
  return commandRunner(file, args, options);
}

export function _setCommandRunnerForTests(runner: CommandRunner): void {
  commandRunner = runner;
}

export function _resetCommandRunnerForTests(): void {
  commandRunner = defaultRunner;
}

export function formatCommandPreview(file: string, args: string[]): string {
  return [file, ...args.map((arg) => (/\s/.test(arg) ? JSON.stringify(arg) : arg))].join(' ');
}
