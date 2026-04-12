import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import { CodebaseIndexer } from '../src/core/indexer';
import { analyzerRegistry } from '../src/core/analyzer-registry';
import { AngularAnalyzer } from '../src/analyzers/angular/index';
import { NextJsAnalyzer } from '../src/analyzers/nextjs/index';
import { ReactAnalyzer } from '../src/analyzers/react/index';
import { GenericAnalyzer } from '../src/analyzers/generic/index';

if (!analyzerRegistry.get('angular')) {
    analyzerRegistry.register(new AngularAnalyzer());
}
if (!analyzerRegistry.get('nextjs')) {
    analyzerRegistry.register(new NextJsAnalyzer());
}
if (!analyzerRegistry.get('react')) {
    analyzerRegistry.register(new ReactAnalyzer());
}
if (!analyzerRegistry.get('generic')) {
    analyzerRegistry.register(new GenericAnalyzer());
}

describe('CodebaseIndexer.detectMetadata', () => {
    let tempDir: string;

    beforeEach(async () => {
        tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'indexer-test-'));
    });

    afterEach(async () => {
        await fs.rm(tempDir, { recursive: true, force: true });
    });

    describe('metadata detection', () => {
        it('should detect project name from directory', async () => {
            await fs.writeFile(
                path.join(tempDir, 'package.json'),
                JSON.stringify({ name: 'test-project', dependencies: {} })
            );

            const indexer = new CodebaseIndexer({ rootPath: tempDir });
            const metadata = await indexer.detectMetadata();

            expect(metadata.rootPath).toBe(tempDir);
            expect(metadata.name).toBe('test-project');
        });

        it('should merge metadata from multiple analyzers', async () => {
            await fs.writeFile(
                path.join(tempDir, 'package.json'),
                JSON.stringify({
                    name: 'angular-project',
                    dependencies: {
                        '@angular/core': '^17.0.0',
                        '@angular/common': '^17.0.0',
                    },
                })
            );

            const indexer = new CodebaseIndexer({ rootPath: tempDir });
            const metadata = await indexer.detectMetadata();

            expect(metadata).toBeDefined();
            expect(metadata.architecture).toBeDefined();
            expect(metadata.architecture.layers).toBeDefined();
        });

        it('should prefer nextjs framework metadata over react when both apply', async () => {
            await fs.writeFile(
                path.join(tempDir, 'package.json'),
                JSON.stringify({
                    name: 'next-project',
                    dependencies: {
                        next: '^14.1.0',
                        react: '^18.2.0',
                        'react-dom': '^18.2.0',
                    },
                })
            );

            await fs.mkdir(path.join(tempDir, 'app'), { recursive: true });

            const indexer = new CodebaseIndexer({ rootPath: tempDir });
            const metadata = await indexer.detectMetadata();

            expect(metadata.framework?.type).toBe('nextjs');
            expect(metadata.framework?.name).toBe('Next.js');
        });

        it('should handle projects without package.json', async () => {
            const indexer = new CodebaseIndexer({ rootPath: tempDir });
            const metadata = await indexer.detectMetadata();

            expect(metadata).toBeDefined();
            expect(metadata.rootPath).toBe(tempDir);
            expect(metadata.dependencies).toEqual([]);
        });

        it('should merge languages from all analyzers', async () => {
            await fs.writeFile(
                path.join(tempDir, 'package.json'),
                JSON.stringify({ name: 'test' })
            );

            await fs.writeFile(
                path.join(tempDir, 'app.ts'),
                'export const app = "test";'
            );

            const indexer = new CodebaseIndexer({ rootPath: tempDir });
            const metadata = await indexer.detectMetadata();

            expect(Array.isArray(metadata.languages)).toBe(true);
        });
    });

    describe('merge behavior', () => {
        it('should deduplicate merged arrays', async () => {
            await fs.writeFile(
                path.join(tempDir, 'package.json'),
                JSON.stringify({ name: 'test' })
            );

            const indexer = new CodebaseIndexer({ rootPath: tempDir });
            const metadata = await indexer.detectMetadata();

            const uniqueStyleGuides = [...new Set(metadata.styleGuides)];
            expect(metadata.styleGuides.length).toBe(uniqueStyleGuides.length);
        });

        it('should preserve customMetadata from analyzers', async () => {
            await fs.writeFile(
                path.join(tempDir, 'package.json'),
                JSON.stringify({ name: 'test' })
            );

            const indexer = new CodebaseIndexer({ rootPath: tempDir });
            const metadata = await indexer.detectMetadata();

            expect(metadata.customMetadata).toBeDefined();
            expect(typeof metadata.customMetadata).toBe('object');
        });
    });

    describe('framework misclassification guards', () => {
        it('does not claim framework for plain Node project', async () => {
            await fs.writeFile(
                path.join(tempDir, 'package.json'),
                JSON.stringify({ name: 'plain-node', dependencies: { zod: '^3' } })
            );

            const indexer = new CodebaseIndexer({ rootPath: tempDir });
            const metadata = await indexer.detectMetadata();

            expect(metadata.framework).toBeUndefined();
        });

        it('drops React claim when indicators are below threshold', async () => {
            // react alone is only 1 indicator — should not meet the >=3 threshold
            await fs.writeFile(
                path.join(tempDir, 'package.json'),
                JSON.stringify({ name: 'thin-react', dependencies: { react: '^18' } })
            );

            const indexer = new CodebaseIndexer({ rootPath: tempDir });
            const metadata = await indexer.detectMetadata();

            expect(metadata.framework).toBeUndefined();
        });

        it('preserves Next.js preference over React when both pass threshold', async () => {
            // next + react + react-dom + app/ = 4 Next.js indicators; react + react-dom = 2 React indicators
            await fs.writeFile(
                path.join(tempDir, 'package.json'),
                JSON.stringify({
                    name: 'next-project',
                    dependencies: { next: '^14.1.0', react: '^18.2.0', 'react-dom': '^18.2.0' },
                })
            );
            await fs.mkdir(path.join(tempDir, 'app'), { recursive: true });

            const indexer = new CodebaseIndexer({ rootPath: tempDir });
            const metadata = await indexer.detectMetadata();

            expect(metadata.framework?.type).toBe('nextjs');
        });

        it('detects React when sufficient indicators are present', async () => {
            await fs.writeFile(
                path.join(tempDir, 'package.json'),
                JSON.stringify({
                    name: 'react-app',
                    dependencies: { react: '^18', 'react-dom': '^18' },
                    devDependencies: { '@types/react': '^18' },
                })
            );

            const indexer = new CodebaseIndexer({ rootPath: tempDir });
            const metadata = await indexer.detectMetadata();

            expect(metadata.framework?.type).toBe('react');
            expect(metadata.framework?.indicators).toContain('dep:react');
        });

        it('detects Angular library project with @angular/core in peerDependencies + ng-package.json', async () => {
            await fs.writeFile(
                path.join(tempDir, 'package.json'),
                JSON.stringify({
                    name: 'my-angular-lib',
                    peerDependencies: {
                        '@angular/core': '^17.0.0',
                        '@angular/common': '^17.0.0',
                    },
                    devDependencies: {
                        '@angular/compiler-cli': '^17.0.0',
                    }
                })
            );
            await fs.writeFile(
                path.join(tempDir, 'ng-package.json'),
                JSON.stringify({ lib: { entryFile: 'src/public-api.ts' } })
            );

            const indexer = new CodebaseIndexer({ rootPath: tempDir });
            const metadata = await indexer.detectMetadata();

            expect(metadata.framework?.type).toBe('angular');
            expect(metadata.framework?.indicators).toContain('dep:@angular/core');
            expect(metadata.framework?.indicators).toContain('disk:ng-package-json');
        });
    });
});
