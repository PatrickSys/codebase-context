import { expect, it } from 'vitest';
import { isSourceBodyWithinInterval } from '../src/utils/source-interval.js';

it.each([
  { name: 'empty source body', source: '', content: '', startLine: 1, endLine: 1, valid: true },
  { name: 'absent source line', source: '', content: '', startLine: 2, endLine: 2, valid: false },
  {
    name: 'trailing newline',
    source: 'value\n',
    content: 'value\n',
    startLine: 1,
    endLine: 2,
    valid: true
  },
  {
    name: 'unclaimed trailing newline',
    source: 'value\n',
    content: 'value\n',
    startLine: 1,
    endLine: 1,
    valid: false
  },
  {
    name: 'partial Unicode AST body',
    source: 'before(); onReady:()=>open("雪"); after();',
    content: 'onReady:()=>open("雪")',
    startLine: 1,
    endLine: 1,
    valid: true
  },
  {
    name: 'normalized CRLF',
    source: 'before();\r\nonReady:()=>open("雪")\r\n',
    content: 'onReady:()=>open("雪")',
    startLine: 2,
    endLine: 2,
    valid: true
  },
  {
    name: 'duplicate text inside interval',
    source: 'same();\nsame();\n',
    content: 'same();',
    startLine: 2,
    endLine: 2,
    valid: true
  },
  {
    name: 'text exists only outside interval',
    source: 'before();\nafter();',
    content: 'before();',
    startLine: 2,
    endLine: 2,
    valid: false
  },
  {
    name: 'forged prefix',
    source: 'onReady:()=>open()',
    content: '// prefix\nonReady:()=>open()',
    startLine: 1,
    endLine: 1,
    valid: false
  },
  {
    name: 'fabricated body in valid range',
    source: 'onReady:()=>open()',
    content: 'onReady:()=>erase()',
    startLine: 1,
    endLine: 1,
    valid: false
  },
  {
    name: 'reversed interval',
    source: 'a\nb',
    content: 'b',
    startLine: 2,
    endLine: 1,
    valid: false
  },
  {
    name: 'nonintegral interval',
    source: 'a',
    content: 'a',
    startLine: 1.5,
    endLine: 1.5,
    valid: false
  }
])('checks $name without salvaging a different body', ({ source, valid, ...chunk }) => {
  expect(isSourceBodyWithinInterval(chunk, source.replace(/\r\n/g, '\n').split('\n'))).toBe(valid);
});
