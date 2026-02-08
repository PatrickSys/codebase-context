/**
 * Analyzer Registry - Manages all framework analyzers
 * Automatically selects the best analyzer based on file type and priority
 */

import { FrameworkAnalyzer, AnalysisResult } from '../types/index.js';

export class AnalyzerRegistry {
  private analyzers: Map<string, FrameworkAnalyzer> = new Map();
  private sortedAnalyzers: FrameworkAnalyzer[] = [];

  register(analyzer: FrameworkAnalyzer): void {
    this.analyzers.set(analyzer.name, analyzer);

    // Re-sort by priority (highest first)
    this.sortedAnalyzers = Array.from(this.analyzers.values()).sort(
      (a, b) => b.priority - a.priority
    );

    // Debug logging guarded by env var - avoids stderr output during MCP STDIO handshake
    if (process.env.CODEBASE_CONTEXT_DEBUG) {
      console.error(
        `[DEBUG] Registered analyzer: ${analyzer.name} (priority: ${analyzer.priority})`
      );
    }
  }

  unregister(name: string): boolean {
    const deleted = this.analyzers.delete(name);
    if (deleted) {
      this.sortedAnalyzers = Array.from(this.analyzers.values()).sort(
        (a, b) => b.priority - a.priority
      );
    }
    return deleted;
  }

  get(name: string): FrameworkAnalyzer | undefined {
    return this.analyzers.get(name);
  }

  getAll(): FrameworkAnalyzer[] {
    return [...this.sortedAnalyzers];
  }

  /**
   * Find the best analyzer for a given file
   * Returns the analyzer with highest priority that can handle the file
   */
  findAnalyzer(filePath: string, content?: string): FrameworkAnalyzer | null {
    for (const analyzer of this.sortedAnalyzers) {
      if (analyzer.canAnalyze(filePath, content)) {
        return analyzer;
      }
    }
    return null;
  }

  /**
   * Find all analyzers that can handle a file
   */
  findAllAnalyzers(filePath: string, content?: string): FrameworkAnalyzer[] {
    return this.sortedAnalyzers.filter((analyzer) => analyzer.canAnalyze(filePath, content));
  }

  /**
   * Analyze a file using the best available analyzer
   */
  async analyzeFile(filePath: string, content: string): Promise<AnalysisResult | null> {
    const analyzer = this.findAnalyzer(filePath, content);

    if (!analyzer) {
      if (process.env.CODEBASE_CONTEXT_DEBUG) {
        console.error(`[DEBUG] No analyzer found for file: ${filePath}`);
      }
      return null;
    }

    // console.error(`Analyzing ${filePath} with ${analyzer.name} analyzer`);

    try {
      return await analyzer.analyze(filePath, content);
    } catch (error) {
      console.error(`Error analyzing ${filePath} with ${analyzer.name}:`, error);
      return null;
    }
  }

  /**
   * Get analyzer statistics
   */
  getStats(): { name: string; priority: number; extensions: string[] }[] {
    return this.sortedAnalyzers.map((analyzer) => ({
      name: analyzer.name,
      priority: analyzer.priority,
      extensions: analyzer.supportedExtensions
    }));
  }
}

// Global registry instance
export const analyzerRegistry = new AnalyzerRegistry();
