import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';

/** Publish complete text by a same-directory rename; failures leave the target intact. */
export async function atomicWrite(target: string, content: string): Promise<void> {
  const temporary = `${target}.${randomUUID()}.tmp`;
  const mode = await fs.stat(target).then(
    (stat) => stat.mode,
    (error: unknown) => {
      if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT')
        return 0o600;
      throw error;
    }
  );
  try {
    await fs.writeFile(temporary, content, { encoding: 'utf8', flag: 'wx', mode });
    await fs.rename(temporary, target);
  } finally {
    await fs.rm(temporary, { force: true }).catch(() => undefined);
  }
}
