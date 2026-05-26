import assert from 'node:assert/strict';
import test from 'node:test';

import {
  analyzeTranscript,
  buildCliArgs,
  buildScenarios,
  createHomeFixtureConfig,
  createScenarioErrorResult,
  formatReport,
  hasSelectedOption,
  hasScenarioExitStep,
  resolveNodePtySpawnHelperPath,
  updateTranscriptCursor,
  stripAnsi,
} from '../scripts/codex-interactive-check.mjs';

test('analyzeTranscript flags excessive repeated menu renders', () => {
  const transcript = Array.from({ length: 12 }, () => '? Select action\n> Configure language\n  Exit').join('\n');

  const result = analyzeTranscript(transcript, {
    repeatedRenderPattern: 'Select action',
    maxRepeatedRenders: 5,
    expectedPatterns: [],
  });

  assert.equal(result.ok, false);
  assert.match(result.summary, /repeated/i);
  assert.deepEqual(result.failures, [
    'Repeated render pattern "Select action" appeared 12 times, exceeding threshold 5.',
  ]);
});

test('analyzeTranscript reports missing expected interactive states', () => {
  const result = analyzeTranscript('Main menu\n> Configure tools\n', {
    repeatedRenderPattern: 'Select action',
    maxRepeatedRenders: 5,
    expectedPatterns: ['Codex', 'Tool menu'],
  });

  assert.equal(result.ok, false);
  assert.deepEqual(result.failures, [
    'Expected terminal output did not include "Codex".',
    'Expected terminal output did not include "Tool menu".',
  ]);
});

test('analyzeTranscript tolerates omitted analysis options', () => {
  const result = analyzeTranscript('Main menu\n');

  assert.equal(result.ok, true);
  assert.deepEqual(result.failures, []);
});

test('stripAnsi removes terminal control sequences before analysis', () => {
  assert.equal(stripAnsi('\u001bc\u001b[2J\u001b[32mCodex\u001b[39m'), 'Codex');
});

test('resolveNodePtySpawnHelperPath points from node-pty main file to platform helper', () => {
  const helperPath = resolveNodePtySpawnHelperPath('/repo/node_modules/node-pty/lib/index.js', 'darwin', 'arm64');

  assert.equal(helperPath.replace(/\\/g, '/'), '/repo/node_modules/node-pty/prebuilds/darwin-arm64/spawn-helper');
});

test('buildCliArgs uses Node 18 compatible CommonJS preload', () => {
  assert.deepEqual(buildCliArgs(['enter', 'codex'], '/tmp/disable-fetch.cjs'), [
    '--require',
    '/tmp/disable-fetch.cjs',
    'dist/cli.js',
    'enter',
    'codex',
  ]);
});

test('buildScenarios covers dynamically discovered tools', () => {
  const tools = [
    { name: 'alpha', displayName: 'Alpha Tool' },
    { name: 'beta', displayName: 'Beta Tool' },
  ];

  assert.deepEqual(
    buildScenarios(tools).map((scenario) => scenario.name),
    [
      'main menu keyboard navigation',
      'tool selector keyboard navigation',
      'Alpha Tool tool menu keyboard navigation',
      'Beta Tool tool menu keyboard navigation',
    ],
  );
});

test('createHomeFixtureConfig includes model state for every current tool config family', () => {
  const config = createHomeFixtureConfig();

  assert.match(config, /claudeCode:/);
  assert.match(config, /codexModel:/);
  assert.match(config, /codeBuddyModels:/);
  assert.match(config, /workbuddyModels:/);
  assert.match(config, /hermesModel:/);
});

test('updateTranscriptCursor only matches output appended after the previous cursor', () => {
  const transcript = ['Main Menu\nConfigure tools\n'];
  const cursor = stripAnsi(transcript.join('')).length;

  assert.equal(updateTranscriptCursor(transcript, cursor, 'Configure tools'), null);

  transcript.push('Tool selector\nCodex\n');
  assert.equal(updateTranscriptCursor(transcript, cursor, 'Codex'), `${transcript[0]}Tool selector\nCodex`.length);
});

test('updateTranscriptCursor preserves later output in the same appended chunk', () => {
  const transcript = ['Tool selector\nAlpha Tool\nBeta Tool\n'];

  const nextCursor = updateTranscriptCursor(transcript, 0, 'Alpha Tool');

  assert.equal(nextCursor, 'Tool selector\nAlpha Tool'.length);
  assert.equal(updateTranscriptCursor(transcript, nextCursor, 'Beta Tool'), 'Tool selector\nAlpha Tool\nBeta Tool'.length);
});

test('hasSelectedOption requires the pointer to be on the expected option', () => {
  assert.equal(hasSelectedOption('❯ ◆ 配置语言\n  ◇ 配置线路', '配置语言'), true);
  assert.equal(hasSelectedOption('  ◆ 配置语言\n❯ ◇ 配置线路', '配置语言'), false);
});

test('buildScenarios marks exit steps explicitly', () => {
  const scenarios = buildScenarios([{ name: 'alpha', displayName: 'Alpha Tool' }]);

  assert.equal(scenarios.every(hasScenarioExitStep), true);
});

test('buildScenarios keeps an exit path when no tools are registered', () => {
  const scenarios = buildScenarios([]);

  assert.equal(scenarios.every(hasScenarioExitStep), true);
  assert.deepEqual(
    scenarios.map((scenario) => scenario.name),
    ['main menu keyboard navigation', 'tool selector keyboard navigation'],
  );
});

test('createScenarioErrorResult preserves transcript and failure reason in report', () => {
  const result = createScenarioErrorResult(
    { name: 'broken scenario', analysis: { repeatedRenderPattern: 'Select action', maxRepeatedRenders: 5, expectedPatterns: [] } },
    ['Main Menu\n❯ Exit\n'],
    new Error('Timed out waiting for selected option'),
  );

  assert.equal(result.analysis.ok, false);
  assert.match(result.analysis.failures[0], /Timed out waiting/);
  const report = formatReport([result]);
  assert.match(report, /broken scenario/);
  assert.match(report, /Main Menu/);
  assert.match(report, /Timed out waiting/);
});
