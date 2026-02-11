/**
 * Library Usage Tracker & Pattern Detector
 * Tracks what libraries are used and detects common coding patterns
 */

export interface LibraryUsageStats {
  [libraryPath: string]: {
    count: number;
    examples: string[];
  };
}

export type PatternTrend = 'Rising' | 'Declining' | 'Stable';

export interface PatternUsageStats {
  [patternName: string]: {
    primary: {
      name: string;
      count: number;
      frequency: string;
      examples: string[];
      canonicalExample?: { file: string; snippet: string };
      newestFileDate?: string;
      trend?: PatternTrend;
      /** Actionable guidance: "USE: X" or "CAUTION: Y" */
      guidance?: string;
    };
    alsoDetected?: Array<{
      name: string;
      count: number;
      frequency: string;
      newestFileDate?: string;
      trend?: PatternTrend;
      /** Actionable guidance for alternative patterns */
      guidance?: string;
    }>;
  };
}

export interface ImportUsage {
  file: string;
  line: number;
}

export interface ComponentUsageInfo {
  definedIn?: string;
  usedIn: ImportUsage[];
  usageCount: number;
}

export class ImportGraph {
  // Map: importSource -> files that import it
  private usages: Map<string, ImportUsage[]> = new Map();
  // Map: file -> what it exports (simplified: just the file path for now)
  private exports: Map<string, string[]> = new Map();

  trackImport(importSource: string, importingFile: string, line: number = 1): void {
    // Normalize
    const normalized = this.normalizeSource(importSource);
    if (!normalized) return;

    const existing = this.usages.get(normalized) || [];
    const relPath = this.toRelativePath(importingFile);

    // Avoid duplicates
    if (!existing.some((u) => u.file === relPath && u.line === line)) {
      existing.push({ file: relPath, line });
      this.usages.set(normalized, existing);
    }
  }

  trackExport(filePath: string, exportName: string): void {
    const relPath = this.toRelativePath(filePath);
    const existing = this.exports.get(relPath) || [];
    if (!existing.includes(exportName)) {
      existing.push(exportName);
      this.exports.set(relPath, existing);
    }
  }

  private normalizeSource(source: string): string | null {
    // Keep all imports except relative paths (we track those separately)
    if (source.startsWith('.')) return null;
    return source;
  }

  private toRelativePath(fullPath: string): string {
    // Take last 4 path segments for readability
    const parts = fullPath.replace(/\\/g, '/').split('/');
    return parts.slice(-4).join('/');
  }

  /**
   * Find all files that import a given source
   * This is "Find Usages" - the key value
   */
  getUsages(importSource: string): ComponentUsageInfo {
    const normalized = this.normalizeSource(importSource) || importSource;
    const usages = this.usages.get(normalized) || [];

    return {
      usedIn: usages,
      usageCount: usages.length
    };
  }

  /**
   * Get full usage stats for all tracked imports
   */
  getAllUsages(): Record<string, ComponentUsageInfo> {
    const result: Record<string, ComponentUsageInfo> = {};

    for (const [source, usages] of this.usages.entries()) {
      result[source] = {
        usedIn: usages.slice(0, 10), // Top 10 usages
        usageCount: usages.length
      };
    }

    return result;
  }

  /**
   * Get top N most-used imports
   */
  getTopUsed(n: number = 20): Array<{ source: string; count: number }> {
    return Array.from(this.usages.entries())
      .map(([source, usages]) => ({
        source,
        count: usages.length
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, n);
  }
}

export class LibraryUsageTracker {
  private usage: Map<string, { count: number; examples: Set<string> }> = new Map();

  track(importSource: string, filePath: string, line: number = 1): void {
    const normalized = this.normalizeImportSource(importSource);
    if (!normalized) return;

    const existing = this.usage.get(normalized) || { count: 0, examples: new Set() };
    existing.count++;

    // Keep top 3 examples
    if (existing.examples.size < 3) {
      const relativePath = filePath.split(/[\\/]/).slice(-3).join('/');
      existing.examples.add(`${relativePath}:${line}`);
    }

    this.usage.set(normalized, existing);
  }

  private normalizeImportSource(source: string): string | null {
    // Ignore relative imports and node built-ins
    if (source.startsWith('.')) return null;
    if (['fs', 'path', 'http', 'https', 'crypto', 'util', 'events'].includes(source)) return null;

    return source;
  }

  getStats(): LibraryUsageStats {
    const stats: LibraryUsageStats = {};

    for (const [lib, data] of this.usage.entries()) {
      stats[lib] = {
        count: data.count,
        examples: Array.from(data.examples).slice(0, 3)
      };
    }

    return stats;
  }

  getTopLibraries(n: number = 10): Array<[string, number]> {
    return Array.from(this.usage.entries())
      .map(([lib, data]) => [lib, data.count] as [string, number])
      .sort((a, b) => b[1] - a[1])
      .slice(0, n);
  }
}

interface TestFrameworkConfig {
  name: string;
  type: 'unit' | 'e2e';
  indicators: string[];
  priority: number;
}

export interface GoldenFile {
  file: string;
  score: number;
  patterns: {
    inject: boolean;
    signals: boolean;
    computed: boolean;
    effect: boolean;
    standalone: boolean;
    signalInputs: boolean;
  };
}

const DEFAULT_TEST_FRAMEWORK_CONFIGS: TestFrameworkConfig[] = [
  // E2E
  {
    name: 'Playwright',
    type: 'e2e',
    indicators: ['@playwright/test', 'page.goto(', 'page.locator('],
    priority: 100
  },
  {
    name: 'Cypress',
    type: 'e2e',
    indicators: ['cy.visit(', 'cy.get(', 'cy.request(', 'cy.window('],
    priority: 100
  },
  {
    name: 'Puppeteer',
    type: 'e2e',
    indicators: ['puppeteer.launch(', 'page.goto(', 'page.locator('],
    priority: 100
  },

  // Unit - specific patterns
  {
    name: 'Jest',
    type: 'unit',
    indicators: ['jest.mock(', 'jest.fn(', 'jest.spyOn(', '@jest/globals', 'types/jest'],
    priority: 100
  },
  { name: 'Vitest', type: 'unit', indicators: ['vi.mock(', 'vi.fn(', '@vitest'], priority: 100 },
  {
    name: 'Jasmine',
    type: 'unit',
    indicators: ['jasmine.createSpy', 'jasmine.createSpyObj'],
    priority: 100
  },

  // Angular TestBed
  {
    name: 'Angular TestBed',
    type: 'unit',
    indicators: ['TestBed.configureTestingModule'],
    priority: 50
  },

  // Generic fallback
  { name: 'Generic Test', type: 'unit', indicators: ['describe(', 'it(', 'expect('], priority: 10 }
];

import { calculateTrend } from './git-dates.js';

export class PatternDetector {
  private patterns: Map<string, Map<string, number>> = new Map();
  private canonicalExamples: Map<string, { file: string; snippet: string }> = new Map();
  private patternFileDates: Map<string, number[]> = new Map(); // Track ALL file dates per pattern (timestamps)
  private goldenFiles: GoldenFile[] = [];
  private testFrameworkConfigs: TestFrameworkConfig[];

  constructor(customConfigs?: TestFrameworkConfig[]) {
    this.testFrameworkConfigs = customConfigs || DEFAULT_TEST_FRAMEWORK_CONFIGS;
  }

  track(
    category: string,
    patternName: string,
    example?: { file: string; snippet: string },
    fileDate?: Date
  ): void {
    if (!this.patterns.has(category)) {
      this.patterns.set(category, new Map());
    }

    const categoryPatterns = this.patterns.get(category)!;
    categoryPatterns.set(patternName, (categoryPatterns.get(patternName) || 0) + 1);

    // Track file dates for P90 robust trend analysis
    if (fileDate) {
      const dateKey = `${category}:${patternName}`;
      const dates = this.patternFileDates.get(dateKey);
      if (dates) {
        dates.push(fileDate.getTime());
      } else {
        this.patternFileDates.set(dateKey, [fileDate.getTime()]);
      }
    }

    // Smart Canonical Example Selection
    const exampleKey = `${category}:${patternName}`;

    if (example) {
      if (!this.canonicalExamples.has(exampleKey)) {
        this.canonicalExamples.set(exampleKey, example);
      } else {
        // Check if new example is better
        const existing = this.canonicalExamples.get(exampleKey)!;

        // Priority 1: Core/Shared directories (likely definitive)
        const isCoreOrShared = (f: string) => f.includes('core/') || f.includes('shared/');
        const newIsPriority = isCoreOrShared(example.file);
        const oldIsPriority = isCoreOrShared(existing.file);

        if (newIsPriority && !oldIsPriority) {
          this.canonicalExamples.set(exampleKey, example);
        } else if (newIsPriority === oldIsPriority) {
          // Priority 2: Concise length (but not too short)
          const newLen = example.snippet.length;
          const oldLen = existing.snippet.length;

          // If current is very long (>200 chars) and new is shorter but substantial (>50), take new
          if (oldLen > 200 && newLen < oldLen && newLen > 50) {
            this.canonicalExamples.set(exampleKey, example);
          }
        }
      }
    }
  }

  /**
   * Track a file as a potential "Golden File" - a file that demonstrates multiple modern patterns
   */
  trackGoldenFile(file: string, score: number, patterns: GoldenFile['patterns']): void {
    // Check if already tracked
    const existing = this.goldenFiles.find((gf) => gf.file === file);
    if (existing) {
      if (score > existing.score) {
        existing.score = score;
        existing.patterns = patterns;
      }
    } else {
      this.goldenFiles.push({ file, score, patterns });
    }
  }

  /**
   * Get top N Golden Files - files that best demonstrate all modern patterns together
   */
  getGoldenFiles(n: number = 5): GoldenFile[] {
    return this.goldenFiles.sort((a, b) => b.score - a.score).slice(0, n);
  }

  /**
   * Generate actionable guidance from percentage + trend.
   * This is what AI agents can directly consume.
   *
   * Examples:
   * - "USE: inject() – 97% adoption, stable"
   * - "CAUTION: constructor DI – 3%, declining"
   * - "AVOID: BehaviorSubject – legacy pattern, declining"
   */
  private generateGuidance(
    patternName: string,
    percentage: number,
    trend: PatternTrend | undefined,
    isAlternative: boolean = false,
    hasRisingAlternative: boolean = false
  ): string {
    const trendLabel = trend ? `, ${trend.toLowerCase()}` : '';

    // Alternative pattern that is rising (migration target)
    if (isAlternative && trend === 'Rising') {
      return `USE: ${patternName} – ${percentage}%, rising (migration target)`;
    }

    // Primary pattern that is declining while an alternative is rising
    if (!isAlternative && trend === 'Declining' && hasRisingAlternative) {
      return `CAUTION: ${patternName} – ${percentage}%, declining (legacy)`;
    }

    // Primary pattern with high adoption
    if (!isAlternative && percentage >= 80) {
      // If primary is declining, downgrade to PREFER
      if (trend === 'Declining')
        return `PREFER: ${patternName} – ${percentage}% adoption, declining`;
      return `USE: ${patternName} – ${percentage}% adoption${trendLabel}`;
    }

    // Primary pattern with moderate adoption
    if (!isAlternative && percentage >= 50) {
      return `PREFER: ${patternName} – ${percentage}% adoption${trendLabel}`;
    }

    // Alternative pattern that is declining
    if (isAlternative && trend === 'Declining') {
      return `AVOID: ${patternName} – ${percentage}%, declining (legacy)`;
    }

    // Alternative with low adoption
    if (isAlternative && percentage < 20) {
      // If it's rising, we already handled it above. If stable/declining, it's a caution.
      return `CAUTION: ${patternName} – ${percentage}% minority pattern${trendLabel}`;
    }

    // Default: just describe it
    return `${patternName} – ${percentage}%${trendLabel}`;
  }

  /**
   * Get robust date for a pattern (P90 percentile) to avoid "single file edit" skew
   * This means we take the date of the 10th percentile newest file.
   * For example, if there are 100 files, we take the 10th newest file's date.
   * This allows ~10% of legacy files to be edited without resetting the trend.
   */
  private getRobustDate(category: string, patternName: string): Date | undefined {
    const dates = this.patternFileDates.get(`${category}:${patternName}`);
    if (!dates || dates.length === 0) return undefined;

    // Sort descending (newest first)
    dates.sort((a, b) => b - a);

    // If few samples, trust the newest (not enough for stats)
    if (dates.length < 5) return new Date(dates[0]);

    // Use 90th percentile (exclude top 10% outliers)
    // For 100 files, P90 is index 10 (11th newest file)
    // This allows ~10% of legacy files to be edited without resetting the trend
    const p90Index = Math.floor(dates.length * 0.1);
    return new Date(dates[p90Index]);
  }

  getConsensus(category: string): PatternUsageStats[string] | null {
    const categoryPatterns = this.patterns.get(category);
    if (!categoryPatterns || categoryPatterns.size === 0) return null;

    const total = Array.from(categoryPatterns.values()).reduce((a, b) => a + b, 0);
    const sorted = Array.from(categoryPatterns.entries()).sort((a, b) => b[1] - a[1]);

    const [primaryName, primaryCount] = sorted[0];
    const primaryFreq = Math.round((primaryCount / total) * 100);
    const exampleKey = `${category}:${primaryName}`;
    const canonicalExample = this.canonicalExamples.get(exampleKey);

    const primaryDate = this.getRobustDate(category, primaryName);
    const primaryTrend = calculateTrend(primaryDate);

    let hasRisingAlternative = false;
    let alternatives: Array<{
      name: string;
      count: number;
      frequency: number;
      date: Date | undefined;
      trend: PatternTrend | undefined;
    }> = [];

    if (sorted.length > 1) {
      alternatives = sorted.slice(1, 4).map(([name, count]) => {
        const altDate = this.getRobustDate(category, name);
        const altTrend = calculateTrend(altDate);
        const altFreq = Math.round((count / total) * 100);
        if (altTrend === 'Rising') hasRisingAlternative = true;
        return { name, count, frequency: altFreq, date: altDate, trend: altTrend };
      });
    }

    // Generate actionable guidance from percentage + trend, now aware of rising alternatives
    const primaryGuidance = this.generateGuidance(
      primaryName,
      primaryFreq,
      primaryTrend,
      false,
      hasRisingAlternative
    );

    const result: PatternUsageStats[string] = {
      primary: {
        name: primaryName,
        count: primaryCount,
        frequency: `${primaryFreq}%`,
        examples: canonicalExample ? [canonicalExample.file] : [],
        canonicalExample: canonicalExample,
        newestFileDate: primaryDate?.toISOString(),
        trend: primaryTrend,
        guidance: primaryGuidance
      }
    };

    if (alternatives.length > 0) {
      result.alsoDetected = alternatives.map((alt) => ({
        name: alt.name,
        count: alt.count,
        frequency: `${alt.frequency}%`,
        newestFileDate: alt.date?.toISOString(),
        trend: alt.trend,
        guidance: this.generateGuidance(alt.name, alt.frequency, alt.trend, true)
      }));
    }

    return result;
  }

  getAllPatterns(): PatternUsageStats {
    const stats: PatternUsageStats = {};

    for (const category of this.patterns.keys()) {
      const consensus = this.getConsensus(category);
      if (consensus) {
        stats[category] = consensus;
      }
    }

    return stats;
  }

  /**
   * Detect test framework from content using config-driven matching
   * Returns detected framework with confidence based on priority scoring
   */
  private detectTestFramework(content: string, _filePath: string): { unit?: string; e2e?: string } {
    const results: { type: 'unit' | 'e2e'; name: string; priority: number }[] = [];

    for (const config of this.testFrameworkConfigs) {
      const matched = config.indicators.some((indicator) => content.includes(indicator));
      if (matched) {
        results.push({ type: config.type, name: config.name, priority: config.priority });
      }
    }

    if (results.length === 0) return {};

    // Find highest priority match for each type
    const unitMatches = results
      .filter((r) => r.type === 'unit')
      .sort((a, b) => b.priority - a.priority);
    const e2eMatches = results
      .filter((r) => r.type === 'e2e')
      .sort((a, b) => b.priority - a.priority);

    const detected: { unit?: string; e2e?: string } = {};

    // For unit tests, apply special logic for TestBed disambiguation
    if (unitMatches.length > 0) {
      const topUnit = unitMatches[0];

      // If only TestBed or Generic Test was found, try to disambiguate
      if (topUnit.name === 'Angular TestBed' || topUnit.name === 'Generic Test') {
        if (content.includes('jest')) {
          detected.unit = 'Jest';
        } else if (content.includes('jasmine')) {
          detected.unit = 'Jasmine';
        } else if (content.includes('vitest')) {
          detected.unit = 'Vitest';
        } else {
          detected.unit = topUnit.name;
        }
      } else {
        detected.unit = topUnit.name;
      }
    }

    if (e2eMatches.length > 0) {
      detected.e2e = e2eMatches[0].name;
    }

    return detected;
  }

  /**
   * Detect patterns from code - FRAMEWORK-AGNOSTIC
   * Framework-specific patterns should be detected by framework analyzers
   */
  detectFromCode(content: string, filePath: string): void {
    // Test file detection
    if (filePath.includes('.spec.') || filePath.includes('.test.') || filePath.includes('/e2e/')) {
      const detected = this.detectTestFramework(content, filePath);

      if (detected.e2e) {
        this.track('e2eFramework', detected.e2e);
      }

      if (detected.unit) {
        this.track('unitTestFramework', detected.unit);
      }

      // Keep testingFramework aligned with unit tests only.
      // e2e trends are tracked separately via e2eFramework.
      if (detected.unit && detected.unit !== 'Generic Test') {
        this.track('testingFramework', detected.unit);
      }

      // Track mocking style (secondary pattern)
      if (content.includes('jest.mock(') || content.includes('jest.fn(')) {
        this.track('testMocking', 'Jest mocks');
      } else if (content.includes('.spyOn(')) {
        this.track('testMocking', 'Spy-based mocking');
      } else if (content.includes('vi.mock(') || content.includes('vi.fn(')) {
        this.track('testMocking', 'Vitest mocks');
      }

      // Track testing utilities
      if (content.includes('MockComponent') || content.includes('ng-mocks')) {
        this.track('testUtility', 'ng-mocks');
      } else if (content.includes('msw') && content.includes('setupServer')) {
        this.track('testUtility', 'MSW');
      } else if (content.includes('@testing-library')) {
        this.track('testUtility', 'Testing Library');
      }
    }

    // Generic state patterns (framework-agnostic)
    if (content.includes('BehaviorSubject') || content.includes('ReplaySubject')) {
      this.track('stateManagement', 'RxJS Subjects');
    }
    if (content.includes('createStore') || content.includes('configureStore')) {
      this.track('stateManagement', 'Redux-style store');
    }
  }
}

/**
 * InternalFileGraph - Tracks file-to-file import relationships for internal files only.
 * Used for:
 * 1. Circular dependency detection (toxic coupling)
 * 2. Unused export detection (dead code identification)
 *
 * Unlike ImportGraph which tracks external package usage, this tracks the internal
 * dependency graph between project files.
 */
export interface FileExport {
  name: string;
  type: 'class' | 'function' | 'variable' | 'interface' | 'type' | 'default' | 'other';
}

export interface CyclePath {
  files: string[];
  // Length of the cycle (2 = A<->B, 3 = A->B->C->A, etc.)
  length: number;
}

export interface UnusedExport {
  file: string;
  exports: string[];
}

export class InternalFileGraph {
  // Map: normalized file path -> Set of normalized file paths it imports
  private imports: Map<string, Set<string>> = new Map();
  // Map: normalized file path -> exports from that file
  private exports: Map<string, FileExport[]> = new Map();
  // Map: normalized file path -> Set of what symbols are imported from this file
  private importedSymbols: Map<string, Set<string>> = new Map();
  // Root path for relative path conversion
  private rootPath: string;

  constructor(rootPath: string) {
    this.rootPath = rootPath.replace(/\\/g, '/');
  }

  /**
   * Normalize a file path to be relative to root and use forward slashes
   */
  private normalizePath(filePath: string): string {
    // Convert backslashes to forward slashes
    let normalized = filePath.replace(/\\/g, '/');

    // Make relative to root if absolute
    if (normalized.startsWith(this.rootPath)) {
      normalized = normalized.slice(this.rootPath.length);
      if (normalized.startsWith('/')) {
        normalized = normalized.slice(1);
      }
    }

    // Remove leading ./ if present
    if (normalized.startsWith('./')) {
      normalized = normalized.slice(2);
    }

    return normalized;
  }

  /**
   * Track that importingFile imports importedFile
   * Both should be absolute paths; they will be normalized internally.
   */
  trackImport(importingFile: string, importedFile: string, importedSymbols?: string[]): void {
    const fromFile = this.normalizePath(importingFile);
    const toFile = this.normalizePath(importedFile);

    // Initialize if needed
    if (!this.imports.has(fromFile)) {
      this.imports.set(fromFile, new Set());
    }

    this.imports.get(fromFile)!.add(toFile);

    // Track which symbols are imported from the target file
    if (importedSymbols && importedSymbols.length > 0) {
      if (!this.importedSymbols.has(toFile)) {
        this.importedSymbols.set(toFile, new Set());
      }
      for (const sym of importedSymbols) {
        if (sym !== '*' && sym !== 'default') {
          this.importedSymbols.get(toFile)!.add(sym);
        }
      }
    }
  }

  /**
   * Track exports from a file
   */
  trackExports(filePath: string, fileExports: FileExport[]): void {
    const normalized = this.normalizePath(filePath);
    this.exports.set(normalized, fileExports);
  }

  /**
   * Find all circular dependencies in the graph using DFS with recursion stack.
   * Returns unique cycles (avoids duplicates like A->B->A and B->A->B).
   *
   * @param scope Optional path prefix to limit analysis (e.g., 'src/features')
   */
  findCycles(scope?: string): CyclePath[] {
    const visited = new Set<string>();
    const recursionStack = new Set<string>();
    const cycles: CyclePath[] = [];
    const cycleSignatures = new Set<string>(); // To avoid duplicates

    // Get all files to check
    let filesToCheck = Array.from(this.imports.keys());
    if (scope) {
      filesToCheck = filesToCheck.filter((f) => f.startsWith(scope));
    }

    const dfs = (node: string, path: string[]): void => {
      visited.add(node);
      recursionStack.add(node);
      path.push(node);

      const neighbors = this.imports.get(node) || new Set<string>();
      for (const neighbor of neighbors) {
        // Apply scope filter to neighbors too
        if (scope && !neighbor.startsWith(scope)) continue;

        if (recursionStack.has(neighbor)) {
          // Found a cycle! Extract just the cycle portion
          const cycleStart = path.indexOf(neighbor);
          if (cycleStart !== -1) {
            const cyclePath = [...path.slice(cycleStart), neighbor];

            // Create a normalized signature to avoid duplicate cycles
            // Sort by the minimum element to create a canonical form
            const normalized = [...cyclePath.slice(0, -1)].sort();
            const signature = normalized.join('|');

            if (!cycleSignatures.has(signature)) {
              cycleSignatures.add(signature);
              cycles.push({
                files: cyclePath,
                length: cyclePath.length - 1 // -1 because last element = first element
              });
            }
          }
        } else if (!visited.has(neighbor)) {
          dfs(neighbor, path);
        }
      }

      path.pop();
      recursionStack.delete(node);
    };

    for (const file of filesToCheck) {
      if (!visited.has(file)) {
        dfs(file, []);
      }
    }

    // Sort by cycle length (shorter cycles are often more problematic)
    return cycles.sort((a, b) => a.length - b.length);
  }

  /**
   * Find exports that are never imported anywhere in the codebase.
   * These may indicate dead code or forgotten APIs.
   *
   * @param scope Optional path prefix to limit analysis
   */
  findUnusedExports(scope?: string): UnusedExport[] {
    const result: UnusedExport[] = [];

    for (const [file, fileExports] of this.exports.entries()) {
      // Apply scope filter
      if (scope && !file.startsWith(scope)) continue;

      // Skip index/barrel files - they often re-export things
      if (file.endsWith('/index.ts') || file.endsWith('/index.js')) continue;

      // Skip test files
      if (file.includes('.spec.') || file.includes('.test.')) continue;

      const importedFromThisFile = this.importedSymbols.get(file) || new Set();

      const unusedExports: string[] = [];
      for (const exp of fileExports) {
        // Skip default exports (commonly used implicitly)
        if (exp.type === 'default') continue;

        // Check if this export is imported anywhere
        if (!importedFromThisFile.has(exp.name)) {
          unusedExports.push(exp.name);
        }
      }

      if (unusedExports.length > 0) {
        result.push({ file, exports: unusedExports });
      }
    }

    // Sort by file path for consistent output
    return result.sort((a, b) => a.file.localeCompare(b.file));
  }

  /**
   * Get statistics about the internal dependency graph
   */
  getStats(): { files: number; edges: number; avgDependencies: number } {
    const files = this.imports.size;
    let edges = 0;
    for (const deps of this.imports.values()) {
      edges += deps.size;
    }
    return {
      files,
      edges,
      avgDependencies: files > 0 ? Math.round((edges / files) * 10) / 10 : 0
    };
  }

  /**
   * Serialize for persistence to .codebase-context/intelligence.json
   */
  toJSON(): {
    imports: Record<string, string[]>;
    exports: Record<string, FileExport[]>;
    stats: { files: number; edges: number; avgDependencies: number };
  } {
    const imports: Record<string, string[]> = {};
    for (const [file, deps] of this.imports.entries()) {
      imports[file] = Array.from(deps);
    }

    const exports: Record<string, FileExport[]> = {};
    for (const [file, exps] of this.exports.entries()) {
      exports[file] = exps;
    }

    return { imports, exports, stats: this.getStats() };
  }

  /**
   * Restore from JSON (for loading from .codebase-context/intelligence.json)
   */
  static fromJSON(
    data: {
      imports?: Record<string, string[]>;
      exports?: Record<string, FileExport[]>;
    },
    rootPath: string
  ): InternalFileGraph {
    const graph = new InternalFileGraph(rootPath);

    if (data.imports) {
      for (const [file, deps] of Object.entries(data.imports)) {
        graph.imports.set(file, new Set(deps));
      }
    }

    if (data.exports) {
      for (const [file, exps] of Object.entries(data.exports)) {
        graph.exports.set(file, exps);
      }
    }

    return graph;
  }
}
