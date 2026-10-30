import { describe, expect, it } from 'vitest';
import { formatConfigPreview } from '../src/cli-init-preview.js';

describe('formatConfigPreview', () => {
  it('shows a unified diff for updates', () => {
    const preview = formatConfigPreview('.cursor/mcp.json', '{"a":1}\n', '{"a":2}\n');
    expect(preview).toContain('--- .cursor/mcp.json');
    expect(preview).toContain('-{"a":1}');
    expect(preview).toContain('+{"a":2}');
  });

  it('marks unchanged configs', () => {
    expect(formatConfigPreview('mcp.json', '{"same":true}', '{"same":true}')).toContain(
      '(unchanged)'
    );
  });
});
