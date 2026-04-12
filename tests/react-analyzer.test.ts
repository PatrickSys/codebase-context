import { mkdir, rm, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'path';
import { describe, expect, it } from 'vitest';
import { ReactAnalyzer } from '../src/analyzers/react/index';

describe('ReactAnalyzer', () => {
  it('canAnalyze uses heuristics for non-JSX extensions', () => {
    const analyzer = new ReactAnalyzer();

    expect(analyzer.canAnalyze('/tmp/file.ts')).toBe(false);
    expect(analyzer.canAnalyze('/tmp/file.ts', 'import React from "react";')).toBe(true);
    expect(analyzer.canAnalyze('/tmp/file.js', 'const React = require("react");')).toBe(true);
    expect(analyzer.canAnalyze('/tmp/file.js', 'React.createElement("div");')).toBe(true);
  });

  it('detects components, hooks, context, and ecosystem signals', async () => {
    const analyzer = new ReactAnalyzer();
    const filePath = path.join(process.cwd(), 'src', 'components', 'MyWidget.tsx');

    const code = `
import React, { Component, Suspense, createContext, useContext, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { useQuery } from "@tanstack/react-query";
import { configureStore } from "@reduxjs/toolkit";
import "tailwindcss";

export const ThemeContext = createContext("light");

export function useTheme() {
  const [count] = useState(0);
  return useContext(ThemeContext) + count;
}

export const MyWidget = () => {
  const theme = useTheme();
  const value = useMemo(() => theme, [theme]);
  useForm();
  z.string();
  useQuery({ queryKey: ["k"], queryFn: async () => 1 });
  configureStore({ reducer: {} });
  return <Suspense fallback={null}><div>{value}</div></Suspense>;
};

export class LegacyWidget extends Component {
  render() {
    return <div />;
  }
}
`;

    const result = await analyzer.analyze(filePath, code);

    expect(result.framework).toBe('react');
    expect(
      result.components.some((component) => component.componentType === 'hook' && component.name === 'useTheme')
    ).toBe(true);
    expect(
      result.components.some(
        (component) => component.componentType === 'component' && component.name === 'MyWidget'
      )
    ).toBe(true);
    expect(
      result.components.some(
        (component) => component.componentType === 'component' && component.name === 'LegacyWidget'
      )
    ).toBe(true);

    const patterns = (result.metadata.detectedPatterns || []) as Array<{ category: string; name: string }>;
    expect(patterns).toContainEqual({ category: 'stateManagement', name: 'React Context' });
    expect(patterns).toContainEqual({ category: 'reactivity', name: 'Suspense' });
    expect(patterns).toContainEqual({ category: 'reactivity', name: 'Memoization' });
    expect(patterns).toContainEqual({ category: 'reactHooks', name: 'Custom hooks' });
    expect(patterns).toContainEqual({ category: 'reactHooks', name: 'Built-in hooks' });
    expect(patterns).toContainEqual({ category: 'forms', name: 'react-hook-form' });
    expect(patterns).toContainEqual({ category: 'validation', name: 'zod' });
    expect(patterns).toContainEqual({ category: 'data', name: 'tanstack-query' });
    expect(patterns).toContainEqual({ category: 'stateManagement', name: 'redux-toolkit' });
    expect(patterns).toContainEqual({ category: 'styling', name: 'tailwind' });
  });

  it('does not claim React framework when react dependency is absent', async () => {
    const analyzer = new ReactAnalyzer();
    const tempRoot = path.join(process.cwd(), 'tests', '.tmp', `react-${randomUUID()}`);
    await mkdir(tempRoot, { recursive: true });
    try {
      await writeFile(
        path.join(tempRoot, 'package.json'),
        JSON.stringify({ name: 'plain-node', dependencies: { lodash: '^4' } })
      );
      const metadata = await analyzer.detectCodebaseMetadata(tempRoot);
      expect(metadata.framework).toBeUndefined();
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it('populates framework.indicators when React is detected', async () => {
    const analyzer = new ReactAnalyzer();
    const tempRoot = path.join(process.cwd(), 'tests', '.tmp', `react-${randomUUID()}`);
    await mkdir(tempRoot, { recursive: true });
    try {
      await writeFile(
        path.join(tempRoot, 'package.json'),
        JSON.stringify({
          name: 'react-app',
          dependencies: { react: '^18', 'react-dom': '^18' },
          devDependencies: { '@types/react': '^18' }
        })
      );
      const metadata = await analyzer.detectCodebaseMetadata(tempRoot);
      expect(metadata.framework?.type).toBe('react');
      expect(metadata.framework?.indicators).toContain('dep:react');
      expect(metadata.framework?.indicators).toContain('dep:react-dom');
      expect(metadata.framework?.indicators).toContain('dep:@types/react');
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it('detects plain JS React project with react + react-dom + src directory', async () => {
    const analyzer = new ReactAnalyzer();
    const tempRoot = path.join(process.cwd(), 'tests', '.tmp', `react-${randomUUID()}`);
    await mkdir(tempRoot, { recursive: true });
    await mkdir(path.join(tempRoot, 'src'), { recursive: true });
    try {
      await writeFile(
        path.join(tempRoot, 'package.json'),
        JSON.stringify({
          name: 'plain-react-app',
          dependencies: { react: '^18', 'react-dom': '^18' }
        })
      );
      const metadata = await analyzer.detectCodebaseMetadata(tempRoot);
      expect(metadata.framework?.type).toBe('react');
      expect(metadata.framework?.indicators).toContain('dep:react');
      expect(metadata.framework?.indicators).toContain('dep:react-dom');
      expect(metadata.framework?.indicators).toContain('disk:src-directory');
      expect(metadata.framework?.indicators?.length).toBeGreaterThanOrEqual(3);
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });
});
