/**
 * eslint-lying-assertion.spec.ts
 *
 * Verifies that the ESLint no-restricted-syntax rules for lying assertions
 * (x as string[], x as number[], x as boolean[]) are actually present in
 * .eslintrc.json and would catch violating code.
 *
 * WHITE-BOX (rule presence check):
 *   - Reads .eslintrc.json (raw text, with comment stripping) and asserts the
 *     three TSAsExpression selectors exist
 *
 * BLACK-BOX (reverse evidence — child process ESLint run via npx):
 *   - Creates a temporary fixture file with `const x = (foo as string[])`
 *   - Runs ESLint with a minimal inline config (no tsconfig project needed)
 *   - Asserts exit code != 0 AND output contains the rule name
 */

import * as fs from 'fs';
import * as path from 'path';
import { spawnSync } from 'child_process';

const FRONTEND_ROOT = path.resolve(__dirname, '../../');
const ESLINT_RC = path.join(FRONTEND_ROOT, '.eslintrc.json');

// ---------------------------------------------------------------------------
// Helper: strip JS-style comments from JSON so JSON.parse can handle it
// (ESLint config files allow comments; standard JSON.parse does not)
// ---------------------------------------------------------------------------

function parseJsonWithComments(raw: string): unknown {
  // Remove single-line // comments (not inside strings — simple heuristic is fine for config files)
  const stripped = raw
    .replace(/\/\/[^\n]*/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '');
  return JSON.parse(stripped) as unknown;
}

// ---------------------------------------------------------------------------
// White-box: rule presence in .eslintrc.json
// ---------------------------------------------------------------------------

describe('ESLint lying-assertion protection — white-box rule presence', () => {
  let eslintConfig: {
    rules?: Record<string, unknown>;
  };

  beforeAll(() => {
    const raw = fs.readFileSync(ESLINT_RC, 'utf8');
    eslintConfig = parseJsonWithComments(raw) as typeof eslintConfig;
  });

  it('.eslintrc.json has no-restricted-syntax rule defined', () => {
    expect(eslintConfig.rules).toBeDefined();
    expect(eslintConfig.rules!['no-restricted-syntax']).toBeDefined();
  });

  it('no-restricted-syntax includes TSAsExpression + TSStringKeyword rule', () => {
    const rules = eslintConfig.rules?.['no-restricted-syntax'];
    expect(Array.isArray(rules)).toBe(true);
    const ruleEntries = (
      rules as Array<string | { selector: string; message: string }>
    ).filter(
      (r): r is { selector: string; message: string } =>
        typeof r === 'object' && r !== null
    );
    const stringRule = ruleEntries.find(
      (r) =>
        r.selector.includes('TSStringKeyword') &&
        r.selector.includes('TSAsExpression')
    );
    expect(stringRule).toBeDefined();
    expect(stringRule?.message).toMatch(/lying assertion/i);
  });

  it('no-restricted-syntax includes TSAsExpression + TSNumberKeyword rule', () => {
    const rules = eslintConfig.rules?.['no-restricted-syntax'];
    const ruleEntries = (
      rules as Array<string | { selector: string; message: string }>
    ).filter(
      (r): r is { selector: string; message: string } =>
        typeof r === 'object' && r !== null
    );
    const numberRule = ruleEntries.find(
      (r) =>
        r.selector.includes('TSNumberKeyword') &&
        r.selector.includes('TSAsExpression')
    );
    expect(numberRule).toBeDefined();
  });

  it('no-restricted-syntax includes TSAsExpression + TSBooleanKeyword rule', () => {
    const rules = eslintConfig.rules?.['no-restricted-syntax'];
    const ruleEntries = (
      rules as Array<string | { selector: string; message: string }>
    ).filter(
      (r): r is { selector: string; message: string } =>
        typeof r === 'object' && r !== null
    );
    const boolRule = ruleEntries.find(
      (r) =>
        r.selector.includes('TSBooleanKeyword') &&
        r.selector.includes('TSAsExpression')
    );
    expect(boolRule).toBeDefined();
  });

  it('the string rule remediation message mentions runtime alternatives (zod or unknown[])', () => {
    const rules = eslintConfig.rules?.['no-restricted-syntax'];
    const ruleEntries = (
      rules as Array<string | { selector: string; message: string }>
    ).filter(
      (r): r is { selector: string; message: string } =>
        typeof r === 'object' && r !== null
    );
    const stringRule = ruleEntries.find(
      (r) =>
        r.selector.includes('TSStringKeyword') &&
        r.selector.includes('TSAsExpression')
    );
    expect(stringRule?.message).toMatch(/zod|unknown\[\]/i);
  });
});

// ---------------------------------------------------------------------------
// Black-box: reverse evidence — does ESLint actually fire on violating code?
//
// Uses `npx eslint` with shell:true (cross-platform) and a minimal inline
// config JSON that does NOT require tsconfig project (AST-level rules only).
// ---------------------------------------------------------------------------

describe('ESLint lying-assertion protection — black-box reverse evidence', () => {
  const TMP_DIR = path.join(FRONTEND_ROOT, '__tests__/protection-net');
  const FIXTURE_FILE = path.join(TMP_DIR, 'lying-assertion.fixture.ts');
  const MINI_CONFIG = path.join(TMP_DIR, '.eslintrc-mini.json');

  beforeAll(() => {
    // Write the violating fixture
    fs.writeFileSync(
      FIXTURE_FILE,
      [
        '// lying assertion fixture — used by eslint-lying-assertion.spec.ts',
        '// This file intentionally contains a banned pattern to verify ESLint catches it.',
        'declare const foo: unknown;',
        '// eslint-disable-next-line @typescript-eslint/no-unused-vars',
        'const x = (foo as string[]); // eslint should flag this',
        'export {};',
      ].join('\n'),
      'utf8'
    );

    // Minimal ESLint config — no project reference needed for AST rules
    const miniConfig = {
      parser: '@typescript-eslint/parser',
      parserOptions: {
        ecmaVersion: 2021,
        sourceType: 'module',
      },
      plugins: ['@typescript-eslint'],
      rules: {
        'no-restricted-syntax': [
          'error',
          {
            selector:
              "TSAsExpression[typeAnnotation.type='TSArrayType'][typeAnnotation.elementType.type='TSStringKeyword']",
            message:
              '禁止 `(x as string[])` lying assertion — use runtime type-check or zod parse.',
          },
        ],
      },
    };
    fs.writeFileSync(MINI_CONFIG, JSON.stringify(miniConfig, null, 2), 'utf8');
  });

  afterAll(() => {
    if (fs.existsSync(FIXTURE_FILE)) fs.unlinkSync(FIXTURE_FILE);
    if (fs.existsSync(MINI_CONFIG)) fs.unlinkSync(MINI_CONFIG);
  });

  it('REVERSE EVIDENCE: ESLint flags (foo as string[]) with non-zero exit code', () => {
    // Use npx + shell:true for cross-platform compatibility
    const result = spawnSync(
      'npx',
      ['eslint', '--no-eslintrc', '--config', MINI_CONFIG, FIXTURE_FILE],
      {
        cwd: FRONTEND_ROOT,
        encoding: 'utf8',
        shell: true,
      }
    );

    // ESLint exits 1 when there are lint errors
    // If status is null, the process failed to launch
    if (result.status === null) {
      throw new Error(
        `ESLint process failed to launch. stderr: ${result.stderr ?? ''} error: ${result.error?.message ?? ''}`
      );
    }

    expect(result.status).not.toBe(0);

    // The output should mention the rule ID or our message keyword
    const combined = (result.stdout ?? '') + (result.stderr ?? '');
    expect(combined).toMatch(/lying assertion|no-restricted-syntax/i);
  }, 30000);

  it('REVERSE EVIDENCE: clean code (no lying assertion) passes ESLint with exit 0', () => {
    const cleanFixture = path.join(TMP_DIR, 'clean-assertion.fixture.ts');
    fs.writeFileSync(
      cleanFixture,
      [
        'declare const foo: unknown;',
        '// safe: runtime check instead of lying assertion',
        'const x = (foo as unknown[]).map(item => (typeof item === "string" ? item : String(item)));',
        'export { x };',
      ].join('\n'),
      'utf8'
    );

    const result = spawnSync(
      'npx',
      ['eslint', '--no-eslintrc', '--config', MINI_CONFIG, cleanFixture],
      {
        cwd: FRONTEND_ROOT,
        encoding: 'utf8',
        shell: true,
      }
    );

    if (fs.existsSync(cleanFixture)) fs.unlinkSync(cleanFixture);

    if (result.status === null) {
      throw new Error(
        `ESLint process failed to launch. stderr: ${result.stderr ?? ''}`
      );
    }

    expect(result.status).toBe(0);
  }, 30000);
});
