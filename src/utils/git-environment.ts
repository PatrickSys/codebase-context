import { execFileSync } from 'node:child_process';

let localEnvironmentVariableNames: string[] | undefined;

function getLocalEnvironmentVariableNames(): string[] {
  if (!localEnvironmentVariableNames) {
    const output = execFileSync('git', ['rev-parse', '--local-env-vars'], {
      encoding: 'utf8'
    });
    localEnvironmentVariableNames = output.split(/\r?\n/).filter(Boolean);
  }

  return localEnvironmentVariableNames;
}

/** Remove Git's repository-local context while preserving global configuration. */
export function gitEnvironmentWithoutLocalRepositoryContext(
  environment: NodeJS.ProcessEnv = process.env
): NodeJS.ProcessEnv {
  const sanitized = { ...environment };

  for (const name of getLocalEnvironmentVariableNames()) {
    delete sanitized[name];
  }

  return sanitized;
}
