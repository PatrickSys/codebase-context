/** Small unified diff for config previews during init (no external diff dependency). */

export function formatConfigPreview(
  displayPath: string,
  existingText: string | null,
  mergedContent: string
): string {
  if (existingText === null) {
    const lines = mergedContent.replace(/\r\n/g, '\n').split('\n');
    return [`--- /dev/null`, `+++ ${displayPath}`, ...lines.map((line) => `+${line}`)].join('\n');
  }
  if (existingText === mergedContent) {
    return `(unchanged) ${displayPath}`;
  }

  const before = existingText.replace(/\r\n/g, '\n').split('\n');
  const after = mergedContent.replace(/\r\n/g, '\n').split('\n');
  const output = [`--- ${displayPath}`, `+++ ${displayPath}`];

  const max = Math.max(before.length, after.length);
  for (let index = 0; index < max; index++) {
    const left = before[index];
    const right = after[index];
    if (left === right) {
      if (left !== undefined) output.push(` ${left}`);
    } else {
      if (left !== undefined) output.push(`-${left}`);
      if (right !== undefined) output.push(`+${right}`);
    }
  }
  return output.join('\n');
}
