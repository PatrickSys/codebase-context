import type { FrameworkInfo } from '../types/index.js';
import { normalizeAnalyzerVersion } from '../analyzers/shared/metadata.js';

function hasDep(deps: Record<string, string>, name: string): boolean {
  return Object.prototype.hasOwnProperty.call(deps, name);
}

/**
 * Detect Vue / Nuxt / Svelte / SvelteKit from merged package dependencies.
 * Uses the same MIN_INDICATORS=3 gate as indexer.selectFramework.
 */
export function detectFrontendFrameworkFromDeps(
  deps: Record<string, string>
): FrameworkInfo | undefined {
  const indicators: string[] = [];

  if (hasDep(deps, 'nuxt')) indicators.push('dep:nuxt');
  if (hasDep(deps, '@nuxt/kit')) indicators.push('dep:@nuxt/kit');
  if (hasDep(deps, '@nuxt/schema')) indicators.push('dep:@nuxt/schema');
  if (hasDep(deps, 'vue')) indicators.push('dep:vue');
  if (hasDep(deps, '@sveltejs/kit')) indicators.push('dep:@sveltejs/kit');
  if (hasDep(deps, '@sveltejs/vite-plugin-svelte')) {
    indicators.push('dep:@sveltejs/vite-plugin-svelte');
  }
  if (hasDep(deps, 'svelte')) indicators.push('dep:svelte');
  if (hasDep(deps, 'vite')) indicators.push('dep:vite');

  if (indicators.length < 3) {
    return undefined;
  }

  if (indicators.includes('dep:nuxt') || indicators.includes('dep:@nuxt/kit')) {
    return {
      name: 'Nuxt',
      version: normalizeAnalyzerVersion(deps.nuxt ?? deps['@nuxt/kit'] ?? 'unknown'),
      type: 'vue',
      variant: 'nuxt',
      uiLibraries: hasDep(deps, 'tailwindcss') ? ['Tailwind'] : undefined,
      indicators
    };
  }

  if (indicators.includes('dep:@sveltejs/kit')) {
    return {
      name: 'SvelteKit',
      version: normalizeAnalyzerVersion(deps['@sveltejs/kit']),
      type: 'svelte',
      indicators
    };
  }

  if (indicators.includes('dep:vue')) {
    return {
      name: 'Vue',
      version: normalizeAnalyzerVersion(deps.vue),
      type: 'vue',
      indicators
    };
  }

  if (indicators.includes('dep:svelte')) {
    return {
      name: 'Svelte',
      version: normalizeAnalyzerVersion(deps.svelte),
      type: 'svelte',
      indicators
    };
  }

  return undefined;
}

export function extractSingleFileComponentScript(
  content: string,
  kind: 'vue' | 'svelte'
): { body: string; language: 'typescript' | 'javascript' } | null {
  const tag = 'script';
  const match = content.match(new RegExp(`<${tag}([^>]*)>([\\s\\S]*?)<\\/${tag}>`, 'i'));
  if (!match?.[2]) {
    return null;
  }

  const attrs = match[1] ?? '';
  const body = match[2].trim();
  if (!body) {
    return null;
  }

  const isTypeScript =
    /\blang\s*=\s*['"]ts['"]/i.test(attrs) ||
    /\blang\s*=\s*['"]typescript['"]/i.test(attrs) ||
    (kind === 'svelte' && attrs.includes('lang="ts"'));

  return {
    body,
    language: isTypeScript ? 'typescript' : 'javascript'
  };
}
