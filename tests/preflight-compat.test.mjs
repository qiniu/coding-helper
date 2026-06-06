import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('preflight can be parsed by older Node before showing the version guard', () => {
  const source = readFileSync(new URL('../dist/lib/preflight.js', import.meta.url), 'utf8');

  assert.doesNotMatch(source, /\?\?/, 'preflight must not use nullish coalescing before the Node version guard runs');
  assert.doesNotMatch(source, /\?\./, 'preflight must not use optional chaining before the Node version guard runs');
  assert.doesNotMatch(source, /from 'node:/, 'preflight must not use node: imports before the Node version guard runs');
});

test('cli defers application imports until after preflight runs', () => {
  const source = readFileSync(new URL('../dist/cli.js', import.meta.url), 'utf8');

  assert.match(source, /import '\.\/lib\/preflight\.js';/);
  assert.doesNotMatch(source, /import \{ createProgram \} from '\.\/lib\/command\.js';/);
  assert.doesNotMatch(source, /import \{ logger \} from '\.\/utils\/logger\.js';/);
  assert.match(source, /import\('\.\/lib\/command\.js'\)/);
  assert.match(source, /import\('\.\/utils\/logger\.js'\)/);
});
