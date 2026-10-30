import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { isCodeFile, detectLanguage } from '../src/utils/language-detection.js';
import { GenericAnalyzer } from '../src/analyzers/generic/index.js';
import { NextJsAnalyzer } from '../src/analyzers/nextjs/index.js';
import {
  detectFrontendFrameworkFromDeps,
  extractSingleFileComponentScript
} from '../src/utils/frontend-framework-metadata.js';

describe('frontend single-file component support', () => {
  it('treats .vue and .svelte as code files', () => {
    expect(isCodeFile('src/Button.vue')).toBe(true);
    expect(isCodeFile('routes/+page.svelte')).toBe(true);
    expect(detectLanguage('App.vue')).toBe('vue');
    expect(detectLanguage('Page.svelte')).toBe('svelte');
  });

  it('extracts script blocks from vue and svelte files', () => {
    const vue = extractSingleFileComponentScript(
      '<script setup lang="ts">export const x = 1</script><template></template>',
      'vue'
    );
    expect(vue).toEqual({ body: 'export const x = 1', language: 'typescript' });

    const svelte = extractSingleFileComponentScript(
      '<script lang="ts">export let name = "";</script>',
      'svelte'
    );
    expect(svelte?.language).toBe('typescript');
  });

  it('indexes vue components through the generic analyzer', async () => {
    const fixture = path.join(process.cwd(), 'tests/fixtures/frontend-vue-mini/Button.vue');
    const analyzer = new GenericAnalyzer();
    expect(analyzer.canAnalyze(fixture)).toBe(true);

    const content = await import('node:fs/promises').then((fs) => fs.readFile(fixture, 'utf-8'));
    const result = await analyzer.analyze(fixture, content);
    expect(result.chunks.length).toBeGreaterThan(0);
    const serialized = JSON.stringify(result);
    expect(serialized.includes('ButtonProps')).toBe(true);
  });

  it('does not classify SvelteKit +page files or Nuxt app/pages vue as Next.js', () => {
    const analyzer = new NextJsAnalyzer();
    expect(
      analyzer.canAnalyze(
        '/repo/packages/kit/test/+page.server.js',
        'export async function load() { return {}; }'
      )
    ).toBe(false);
    expect(
      analyzer.canAnalyze(
        '/repo/playgrounds/nuxt/app/pages/typography.vue',
        '<template><div /></template>'
      )
    ).toBe(false);
    expect(
      analyzer.canAnalyze(
        path.join(process.cwd(), 'app', 'dashboard', 'page.tsx'),
        'export default function Page() { return null; }'
      )
    ).toBe(true);
  });

  it('detects Nuxt and SvelteKit framework metadata from dependencies', () => {
    const nuxt = detectFrontendFrameworkFromDeps({
      nuxt: '^4.0.0',
      '@nuxt/kit': 'catalog:',
      vue: '^3.5.0'
    });
    expect(nuxt?.type).toBe('vue');
    expect(nuxt?.name).toBe('Nuxt');

    const kit = detectFrontendFrameworkFromDeps({
      '@sveltejs/kit': '^2.0.0',
      svelte: '^5.0.0',
      vite: '^6.0.0'
    });
    expect(kit?.type).toBe('svelte');
    expect(kit?.name).toBe('SvelteKit');
  });
});

describe('frontend fixture indexing smoke', () => {
  it('writes vue files into a temp project manifest via glob include patterns', async () => {
    const root = path.join(process.cwd(), 'tests/fixtures/frontend-vue-mini');
    const analyzer = new GenericAnalyzer();
    const filePath = path.join(root, 'Button.vue');
    const content = await import('node:fs/promises').then((fs) => fs.readFile(filePath, 'utf-8'));
    const result = await analyzer.analyze(filePath, content);
    expect(result.language).toBe('vue');
    expect(result.chunks[0]?.metadata.analyzer).toBe('generic');
  });

  it('creates an isolated vue file for incremental tests', async () => {
    const dir = path.join(process.cwd(), 'tests/fixtures/.tmp', randomUUID());
    const filePath = path.join(dir, 'Widget.vue');
    const source =
      '<script setup lang="ts">export type WidgetProps = { id: string };</script><template></template>';
    await mkdir(dir, { recursive: true });
    try {
      await writeFile(filePath, source);
      const analyzer = new GenericAnalyzer();
      expect(analyzer.canAnalyze(filePath)).toBe(true);
      const result = await analyzer.analyze(filePath, source);
      expect(result.chunks.length).toBeGreaterThan(0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
