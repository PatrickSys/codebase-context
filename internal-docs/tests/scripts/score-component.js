/**
 * Automated Component Pattern Scoring
 * 
 * Usage:
 *   node score-component.js <path-to-component-directory>
 * 
 * Example:
 *   node score-component.js c:/Users/.../SSP_Portal/libs/admin/user-settings
 */

const fs = require('fs');
const path = require('path');

function scoreComponent(componentDir) {
    const results = {
        patterns: {},
        files: [],
        score: 0,
        maxScore: 7
    };

    // Find component files
    const files = fs.readdirSync(componentDir);
    const tsFile = files.find(f => f.endsWith('.component.ts'));
    const specFile = files.find(f => f.endsWith('.spec.ts'));
    const scssFile = files.find(f => f.endsWith('.scss'));

    if (!tsFile) {
        throw new Error('No .component.ts file found');
    }

    results.files = files;

    // Read file contents
    const componentCode = fs.readFileSync(path.join(componentDir, tsFile), 'utf-8');
    const testCode = specFile ? fs.readFileSync(path.join(componentDir, specFile), 'utf-8') : '';
    const styleCode = scssFile ? fs.readFileSync(path.join(componentDir, scssFile), 'utf-8') : '';

    // Pattern 1: inject() DI
    results.patterns.inject = /inject\(/.test(componentCode);
    if (results.patterns.inject) results.score++;

    // Pattern 2: Signals (signal, computed, effect)
    results.patterns.signals = /signal\(|computed\(|effect\(/.test(componentCode);
    if (results.patterns.signals) results.score++;

    // Pattern 3: Standalone
    results.patterns.standalone = /standalone:\s*true/.test(componentCode);
    if (results.patterns.standalone) results.score++;

    // Pattern 4: Jest (check test file)
    results.patterns.jest = specFile && specFile.endsWith('.spec.ts');
    if (results.patterns.jest) results.score++;

    // Pattern 5: CodeBlue wrappers
    const hasCodeBlueImports = /@codeblue\/prime/.test(componentCode);
    const hasPrimeNGImports = /from ['"]primeng/.test(componentCode);
    results.patterns.wrappers = hasCodeBlueImports && !hasPrimeNGImports;
    if (results.patterns.wrappers) results.score++;

    // Pattern 6: OnPush
    results.patterns.onPush = /ChangeDetectionStrategy\.OnPush/.test(componentCode);
    if (results.patterns.onPush) results.score++;

    // Pattern 7: Design tokens (no hardcoded colors)
    const hardcodedColors = styleCode.match(/#[0-9a-fA-F]{3,6}|rgba?\(/g) || [];
    const hasTokens = /var\(--/.test(styleCode);
    results.patterns.designTokens = hasTokens && hardcodedColors.length === 0;
    if (results.patterns.designTokens) results.score++;

    // Additional metrics
    results.metrics = {
        loc: componentCode.split('\n').length,
        hardcodedColors: hardcodedColors.length,
        hasTests: !!specFile,
        testCount: (testCode.match(/it\(/g) || []).length
    };

    return results;
}

// CLI usage
if (require.main === module) {
    const componentDir = process.argv[2];

    if (!componentDir) {
        console.error('Usage: node score-component.js <path-to-component-directory>');
        process.exit(1);
    }

    try {
        const results = scoreComponent(componentDir);

        console.log('\n=== Component Pattern Score ===\n');
        console.log(`Score: ${results.score}/${results.maxScore}`);
        console.log('\nPatterns:');
        console.log(`  [${results.patterns.inject ? '✓' : '✗'}] inject() DI`);
        console.log(`  [${results.patterns.signals ? '✓' : '✗'}] Signals`);
        console.log(`  [${results.patterns.standalone ? '✓' : '✗'}] Standalone`);
        console.log(`  [${results.patterns.jest ? '✓' : '✗'}] Jest`);
        console.log(`  [${results.patterns.wrappers ? '✓' : '✗'}] @codeblue/prime wrappers`);
        console.log(`  [${results.patterns.onPush ? '✓' : '✗'}] OnPush`);
        console.log(`  [${results.patterns.designTokens ? '✓' : '✗'}] Design tokens`);
        console.log('\nMetrics:');
        console.log(`  LOC: ${results.metrics.loc}`);
        console.log(`  Tests: ${results.metrics.testCount}`);
        console.log(`  Hardcoded colors: ${results.metrics.hardcodedColors}`);
        console.log('\n');

        // Exit with score for automation
        process.exit(results.score === results.maxScore ? 0 : 1);
    } catch (err) {
        console.error('Error:', err.message);
        process.exit(1);
    }
}

module.exports = { scoreComponent };
