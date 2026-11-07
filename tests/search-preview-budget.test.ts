import { describe, expect, it } from 'vitest';
import { boundSearchPreview } from '../src/tools/search-payload-budget.js';

describe('bounded compact source evidence', () => {
  it('retains the condition, cleanup and return as whole contiguous source lines', () => {
    const lines = [
      'def release(item):',
      '  now = clock()',
      '  if item.deadline < now:',
      '    close(item)',
      '    remove(item)',
      '    return False',
      '  return True',
      '# next'
    ];
    const preview = boundSearchPreview(lines, 2);
    expect(preview).toEqual({ text: lines.slice(0, 7).join('\n'), start: 0, end: 7 });
  });

  it('keeps an interior match and exact offsets instead of joining disconnected lines', () => {
    const lines = Array.from({ length: 30 }, (_, i) => `statement_${i}();`);
    const preview = boundSearchPreview(lines, 17);
    expect(preview).toEqual({ text: lines.slice(15, 22).join('\n'), start: 15, end: 22 });
  });

  it('bounds serialized UTF-8 bytes including JSON escaping without slicing source lines', () => {
    const lines = ['prefix', '"\\'.repeat(80), '  cleanup("你好");', 'tail', '好'.repeat(180)];
    const preview = boundSearchPreview(lines, 2);
    expect(preview).toBeDefined();
    if (!preview) throw new Error('Expected cleanup evidence');
    expect(preview.text).toContain('  cleanup("你好");');
    expect(preview.text).toBe(lines.slice(preview.start, preview.end).join('\n'));
    const serialized = JSON.stringify(
      { results: [{ signaturePreview: preview.text, score: 1 }] },
      null,
      2
    );
    const field = serialized
      .split('\n')
      .find((line) => line.trimStart().startsWith('"signaturePreview":'));
    expect(field).toBeDefined();
    expect(Buffer.byteLength(field ?? '', 'utf8')).toBeLessThanOrEqual(480);
  });

  it('omits an oversized matched line so the caller can supply a read range', () => {
    expect(boundSearchPreview(['before', '界'.repeat(200), 'after'], 1)).toBeUndefined();
  });

  it.each([[], [''], ['   ']])('omits empty evidence %j', (...lines) => {
    expect(boundSearchPreview(lines, 0)).toBeUndefined();
  });
});
