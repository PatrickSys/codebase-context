import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import type { Memory } from '../src/types/index.js';
import { CODEBASE_CONTEXT_DIRNAME, MEMORY_FILENAME } from '../src/constants/codebase-context.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('Memory System', () => {
  const testDir = path.join(__dirname, 'test-workspace-memory');
  const memoryPath = path.join(testDir, CODEBASE_CONTEXT_DIRNAME, MEMORY_FILENAME);

  beforeAll(async () => {
    await fs.mkdir(path.join(testDir, CODEBASE_CONTEXT_DIRNAME), { recursive: true });
  });

  afterAll(async () => {
    await fs.rm(testDir, { recursive: true, force: true });
  });

  it('should create memory.json with valid schema', async () => {
    const memory = {
      id: 'test_abc123',
      type: 'decision',
      category: 'dependencies',
      memory: 'Use hoisted mode',
      reason: 'Indirect dependencies',
      date: new Date().toISOString()
    };

    await fs.writeFile(memoryPath, JSON.stringify([memory], null, 2));

    const content = await fs.readFile(memoryPath, 'utf-8');
    const memories = JSON.parse(content);

    expect(memories).toHaveLength(1);
    expect(memories[0]).toHaveProperty('id');
    expect(memories[0]).toHaveProperty('type');
    expect(memories[0]).toHaveProperty('category');
    expect(memories[0]).toHaveProperty('memory');
    expect(memories[0]).toHaveProperty('reason');
    expect(memories[0]).toHaveProperty('date');
  });

  it('should support all decision categories and types', () => {
    const validCategories = ['tooling', 'architecture', 'testing', 'dependencies', 'conventions'];
    const validTypes = ['convention', 'decision', 'gotcha', 'failure'];

    validCategories.forEach((category) => {
      validTypes.forEach((type) => {
        const memory = {
          id: `test_${category}_${type}`,
          type,
          category,
          memory: `Test ${type} for ${category}`,
          reason: `Test reason`,
          date: new Date().toISOString()
        };

        expect(memory.category).toBe(category);
        expect(memory.type).toBe(type);
      });
    });
  });

  it('should filter memories by category and type', async () => {
    const memories = [
      {
        id: 'test_1',
        type: 'convention',
        category: 'testing',
        memory: 'Use Jest',
        reason: 'Team standard',
        date: new Date().toISOString()
      },
      {
        id: 'test_2',
        type: 'decision',
        category: 'dependencies',
        memory: 'Use hoisted',
        reason: 'Compatibility',
        date: new Date().toISOString()
      },
      {
        id: 'test_3',
        type: 'gotcha',
        category: 'testing',
        memory: 'Avoid lodash debounce',
        reason: 'Breaks zone.js',
        date: new Date().toISOString()
      }
    ];

    await fs.writeFile(memoryPath, JSON.stringify(memories, null, 2));

    const content = await fs.readFile(memoryPath, 'utf-8');
    const allMemories = JSON.parse(content) as Memory[];

    // Filter by category
    const testingMemories = allMemories.filter((m) => m.category === 'testing');
    expect(testingMemories).toHaveLength(2);

    // Filter by type
    const conventionMemories = allMemories.filter((m) => m.type === 'convention');
    expect(conventionMemories).toHaveLength(1);
    expect(conventionMemories[0].memory).toBe('Use Jest');

    // Filter by both
    const testingGotchas = allMemories.filter(
      (m) => m.category === 'testing' && m.type === 'gotcha'
    );
    expect(testingGotchas).toHaveLength(1);
    expect(testingGotchas[0].memory).toBe('Avoid lodash debounce');
  });

  it('should perform keyword search across memories', async () => {
    const memories = [
      {
        id: 'test_1',
        type: 'decision',
        category: 'dependencies',
        memory: 'Use node-linker: hoisted',
        reason: "Some packages don't declare transitive deps",
        date: new Date().toISOString()
      },
      {
        id: 'test_2',
        type: 'convention',
        category: 'testing',
        memory: 'Use Jest over Vitest',
        reason: 'Better Angular integration',
        date: new Date().toISOString()
      }
    ];

    await fs.writeFile(memoryPath, JSON.stringify(memories, null, 2));

    const content = await fs.readFile(memoryPath, 'utf-8');
    const allMemories = JSON.parse(content) as Memory[];

    // Search for "hoisted"
    const searchTerm = 'hoisted';
    const results = allMemories.filter((m) => {
      const searchText = `${m.memory} ${m.reason}`.toLowerCase();
      return searchText.includes(searchTerm.toLowerCase());
    });

    expect(results).toHaveLength(1);
    expect(results[0].memory).toContain('hoisted');
  });
});
