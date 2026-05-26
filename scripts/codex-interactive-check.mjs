#!/usr/bin/env node

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const DEFAULT_TIMEOUT_MS = 15000;
const DEFAULT_REPORT_PATH = 'codex-interactive-report.md';
const DISABLE_FETCH_PRELOAD = 'disable-fetch.cjs';
const DISABLE_FETCH_PRELOAD_SOURCE = 'globalThis.fetch = () => new Promise(() => {});\n';

export function stripAnsi(value) {
  return value.replace(/\u001B(?:[@-Z\\-_a-z]|\[[0-?]*[ -/]*[@-~])/g, '');
}

export function analyzeTranscript(transcript, options) {
  const clean = stripAnsi(transcript);
  const failures = [];

  for (const expected of options.expectedPatterns) {
    if (!clean.includes(expected)) {
      failures.push(`Expected terminal output did not include "${expected}".`);
    }
  }

  const pattern = options.repeatedRenderPattern;
  const count = pattern ? clean.split(pattern).length - 1 : 0;
  if (pattern && count > options.maxRepeatedRenders) {
    failures.push(
      `Repeated render pattern "${pattern}" appeared ${count} times, exceeding threshold ${options.maxRepeatedRenders}.`,
    );
  }

  return {
    ok: failures.length === 0,
    failures,
    repeatedRenderCount: count,
    summary: failures.length ? failures.join('\n') : 'Interactive terminal check passed.',
  };
}

export function updateTranscriptCursor(transcript, cursor, expected) {
  const clean = stripAnsi(transcript.join(''));
  const slice = clean.slice(cursor);
  const index = slice.indexOf(expected);
  if (index === -1) {
    return null;
  }
  return cursor + index + expected.length;
}

export function hasSelectedOption(transcript, optionText) {
  return stripAnsi(transcript)
    .split('\n')
    .some((line) => line.includes('❯') && line.includes(optionText));
}

export function hasScenarioExitStep(scenario) {
  return scenario.steps.some((step) => step.expectExit);
}

export function buildCliArgs(scenarioArgs, preloadPath) {
  return ['--require', preloadPath, 'dist/cli.js', ...scenarioArgs];
}

export function resolveNodePtySpawnHelperPath(packageMainPath, platform = process.platform, arch = process.arch) {
  return path.join(path.dirname(packageMainPath), '..', 'prebuilds', `${platform}-${arch}`, 'spawn-helper');
}

function ensureNodePtySpawnHelperExecutable() {
  const require = createRequire(import.meta.url);
  try {
    const helperPath = resolveNodePtySpawnHelperPath(require.resolve('node-pty'));
    if (fs.existsSync(helperPath)) {
      fs.chmodSync(helperPath, 0o755);
    }
  } catch {
    // 只读 node_modules 或受限 CI 环境下 chmod 失败时，继续交互检查。
  }
}

async function runScenario(pty, scenario, homeDir) {
  const transcript = [];
  const preloadPath = ensureDisableFetchPreload(homeDir);
  const processState = { exited: false, code: null, signal: null };
  const child = pty.spawn(process.execPath, buildCliArgs(scenario.args, preloadPath), {
    name: 'xterm-256color',
    cols: 100,
    rows: 30,
    cwd: process.cwd(),
    env: {
      ...process.env,
      HOME: homeDir,
      USERPROFILE: homeDir,
      LANG: 'zh_CN.UTF-8',
      TERM: 'xterm-256color',
      NO_COLOR: '1',
    },
  });

  child.onData((data) => {
    transcript.push(data);
  });
  const exitSubscription = child.onExit(({ exitCode, signal }) => {
    processState.exited = true;
    processState.code = exitCode;
    processState.signal = signal;
  });

  let cursor = 0;
  let exitResult = { timedOut: false, code: null, signal: null };
  let scenarioError = null;

  try {
    try {
      for (const step of scenario.steps) {
        if (processState.exited && !step.expectExit) {
          throw new Error(`Process exited before scenario step completed with code ${processState.code ?? 'null'}.`);
        }
        if (step.waitFor) {
          cursor = await waitForNewTranscript(
            transcript,
            cursor,
            step.waitFor,
            step.timeoutMs || DEFAULT_TIMEOUT_MS,
            processState,
          );
        }
        if (step.input) {
          child.write(step.input);
        }
        if (step.waitAfter) {
          cursor = await waitForNewTranscript(
            transcript,
            cursor,
            step.waitAfter,
            step.timeoutMs || DEFAULT_TIMEOUT_MS,
            processState,
          );
        }
        if (step.pauseMs) {
          await delay(step.pauseMs);
        }
        if (step.expectSelected) {
          cursor = await waitForSelectedOption(
            transcript,
            cursor,
            step.expectSelected,
            step.timeoutMs || DEFAULT_TIMEOUT_MS,
            processState,
          );
        }
        if (step.expectExit) {
          exitResult = await waitForExitOrKill(child, processState, step.timeoutMs || scenario.exitTimeoutMs || 5000);
          cursor = stripAnsi(transcript.join('')).length;
        }
      }
      if (!scenario.steps.some((step) => step.expectExit)) {
        exitResult = await waitForExitOrKill(child, processState, scenario.exitTimeoutMs || 5000);
      }
    } catch (error) {
      scenarioError = error;
    }
  } finally {
    exitSubscription.dispose();
    if (!processState.exited) {
      safeKill(child);
    }
  }

  if (scenarioError) {
    return createScenarioErrorResult(scenario, transcript, scenarioError);
  }

  const output = transcript.join('');
  const analysis = analyzeTranscript(output, scenario.analysis);
  if (exitResult.timedOut) {
    analysis.failures.push(`Process did not exit within ${scenario.exitTimeoutMs || 5000}ms after scenario input completed.`);
    analysis.ok = false;
    analysis.summary = analysis.failures.join('\n');
  }
  if (exitResult.code !== null && exitResult.code !== 0) {
    analysis.failures.push(`Process exited with non-zero code ${exitResult.code}.`);
    analysis.ok = false;
    analysis.summary = analysis.failures.join('\n');
  }
  return {
    name: scenario.name,
    output,
    analysis,
  };
}

export function createScenarioErrorResult(scenario, transcript, error) {
  const output = transcript.join('');
  const analysis = analyzeTranscript(output, scenario.analysis);
  const message = error instanceof Error ? error.message : String(error);
  analysis.failures.push(message);
  analysis.ok = false;
  analysis.summary = analysis.failures.join('\n');
  return {
    name: scenario.name,
    output,
    analysis,
  };
}

function waitForSelectedOption(transcript, cursor, optionText, timeoutMs, processState = null) {
  const startedAt = Date.now();
  return new Promise((resolve, reject) => {
    const timer = setInterval(() => {
      const clean = stripAnsi(transcript.join(''));
      if (hasSelectedOption(clean.slice(cursor), optionText)) {
        clearInterval(timer);
        resolve(clean.length);
        return;
      }
      if (processState?.exited) {
        clearInterval(timer);
        reject(new Error(`Process exited before selecting option "${optionText}" with code ${processState.code ?? 'null'}.`));
        return;
      }
      if (Date.now() - startedAt > timeoutMs) {
        clearInterval(timer);
        reject(new Error(`Timed out waiting for selected option after cursor ${cursor}: ${optionText}`));
      }
    }, 50);
  });
}

function waitForNewTranscript(transcript, cursor, expected, timeoutMs, processState = null) {
  const startedAt = Date.now();
  return new Promise((resolve, reject) => {
    const timer = setInterval(() => {
      const nextCursor = updateTranscriptCursor(transcript, cursor, expected);
      if (nextCursor !== null) {
        clearInterval(timer);
        resolve(nextCursor);
        return;
      }
      if (processState?.exited) {
        clearInterval(timer);
        reject(new Error(`Process exited before terminal output appeared with code ${processState.code ?? 'null'}: ${expected}`));
        return;
      }
      if (Date.now() - startedAt > timeoutMs) {
        clearInterval(timer);
        reject(new Error(`Timed out waiting for new terminal output after cursor ${cursor}: ${expected}`));
      }
    }, 50);
  });
}

function waitForExitOrKill(child, processState, timeoutMs) {
  return new Promise((resolve) => {
    if (processState.exited) {
      resolve({ timedOut: false, code: processState.code, signal: processState.signal });
      return;
    }

    let exitSubscription;
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) {
        safeKill(child);
        settled = true;
        exitSubscription?.dispose();
        resolve({ timedOut: true, code: null, signal: null });
      }
    }, timeoutMs);

    exitSubscription = child.onExit(({ exitCode, signal }) => {
      if (!settled) {
        clearTimeout(timer);
        settled = true;
        exitSubscription?.dispose();
        resolve({ timedOut: false, code: exitCode, signal });
      }
    });
  });
}

function safeKill(child) {
  try {
    child.kill();
  } catch {
    // 进程可能已经退出，node-pty 在这种情况下可能抛 ESRCH。
  }
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function createHomeFixtureConfig() {
  return [
    'lang: zh_CN',
    'endpoint: china',
    'api_key: qiniu-test-token',
    'claudeCode:',
    '  haikuModel: claude-3-5-haiku-latest',
    '  sonnetModel: claude-sonnet-4-5',
    '  opusModel: claude-opus-4-5',
    '  subagentModel: claude-sonnet-4-5',
    '  useDefaultModels: false',
    'codexModel: openai/gpt-5.5',
    'codeBuddyModels:',
    '  - openai/gpt-5.5',
    'workbuddyModels:',
    '  - openai/gpt-5.5',
    'hermesModel: openai/gpt-5.5',
    '',
  ].join('\n');
}

function createHomeFixture() {
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coding-helper-interactive-'));
  const configDir = path.join(homeDir, '.coding-helper');
  fs.mkdirSync(configDir, { recursive: true, mode: 0o700 });
  fs.writeFileSync(path.join(configDir, 'config.yaml'), createHomeFixtureConfig(), { mode: 0o600 });
  return homeDir;
}

function ensureDisableFetchPreload(homeDir) {
  const preloadPath = path.join(homeDir, DISABLE_FETCH_PRELOAD);
  if (!fs.existsSync(preloadPath)) {
    fs.writeFileSync(preloadPath, DISABLE_FETCH_PRELOAD_SOURCE, { mode: 0o600 });
  }
  return preloadPath;
}

const MAIN_MENU_OPTIONS = ['配置语言', '配置线路', '设置 API Key', '配置编码工具', '健康检查', '重新初始化', '退出'];
const TOOL_MENU_OPTIONS = ['配置模型', '配置装载', '卸载配置', '验证配置', '重新加载', '查看状态', '返回'];

function downToOption(options, fromOption, toOption) {
  const fromIndex = options.indexOf(fromOption);
  const toIndex = options.indexOf(toOption);
  if (fromIndex === -1 || toIndex === -1 || toIndex < fromIndex) {
    throw new Error(`Cannot navigate from "${fromOption}" to "${toOption}".`);
  }
  return '\u001B[B'.repeat(toIndex - fromIndex);
}

function createToolMenuScenario(tool) {
  const title = tool.displayName;
  return {
    name: `${title} tool menu keyboard navigation`,
    args: ['enter', tool.name],
    steps: [
      { waitFor: '配置模型', input: '\u001B[B', expectSelected: '配置装载' },
      { input: '\u001B[A', expectSelected: '配置模型' },
      { input: downToOption(TOOL_MENU_OPTIONS, '配置模型', '返回'), expectSelected: '返回' },
      { input: '\r', expectExit: true },
    ],
    analysis: {
      repeatedRenderPattern: '请选择操作',
      maxRepeatedRenders: 20,
      expectedPatterns: [`${title} 配置`, '配置模型', '配置装载', '返回'],
    },
  };
}

export function buildScenarios(tools) {
  const toolNames = tools.map((tool) => tool.displayName);
  const toolSelectorTarget = tools[1] || tools[0];
  const toolSelectorSteps = toolSelectorTarget
    ? [
        { waitFor: '主菜单', input: `${downToOption(MAIN_MENU_OPTIONS, '配置语言', '配置编码工具')}\r`, pauseMs: 200 },
        { waitFor: '配置编码工具', pauseMs: 200 },
      ]
    : [
        { waitFor: '主菜单', input: downToOption(MAIN_MENU_OPTIONS, '配置语言', '退出'), expectSelected: '退出' },
        { input: '\r', expectExit: true },
      ];

  if (toolSelectorTarget) {
    const downCount = tools.findIndex((tool) => tool.name === toolSelectorTarget.name);
    toolSelectorSteps.push({
      input: '\u001B[B'.repeat(Math.max(0, downCount)),
      pauseMs: 200,
      expectSelected: toolSelectorTarget.displayName,
    });
    toolSelectorSteps.push({
      input: '\r',
      waitAfter: '配置模型',
    });
    toolSelectorSteps.push({
      input: downToOption(TOOL_MENU_OPTIONS, '配置模型', '返回'),
      expectSelected: '返回',
    });
    toolSelectorSteps.push({
      input: '\r',
      waitAfter: '主菜单',
    });
    toolSelectorSteps.push({
      input: downToOption(MAIN_MENU_OPTIONS, '配置语言', '退出'),
      expectSelected: '退出',
    });
    toolSelectorSteps.push({
      input: '\r',
      expectExit: true,
    });
  }

  return [
    {
      name: 'main menu keyboard navigation',
      args: ['enter'],
      steps: [
        { waitFor: '主菜单', input: '\u001B[B', expectSelected: '配置线路' },
        { input: '\u001B[A', expectSelected: '配置语言' },
        { input: downToOption(MAIN_MENU_OPTIONS, '配置语言', '退出'), expectSelected: '退出' },
        { input: '\r', expectExit: true },
      ],
      analysis: {
        repeatedRenderPattern: '请选择操作',
        maxRepeatedRenders: 20,
        expectedPatterns: ['主菜单', '配置语言', '配置线路', '退出'],
      },
    },
    {
      name: 'tool selector keyboard navigation',
      args: ['enter'],
      steps: toolSelectorSteps,
      analysis: {
        repeatedRenderPattern: '请选择操作',
        maxRepeatedRenders: 30,
        expectedPatterns: ['配置编码工具', ...toolNames],
      },
    },
    ...tools.map((tool) => createToolMenuScenario(tool)),
  ];
}

export function formatReport(results) {
  const lines = ['# Codex Interactive Terminal Check', ''];
  for (const result of results) {
    lines.push(`## ${result.name}`, '');
    lines.push(result.analysis.ok ? 'Status: passed' : 'Status: failed', '');
    if (result.analysis.failures.length) {
      lines.push('Failures:');
      for (const failure of result.analysis.failures) {
        lines.push(`- ${failure}`);
      }
      lines.push('');
    }
    lines.push(`Repeated render count: ${result.analysis.repeatedRenderCount}`, '');
    lines.push('Terminal transcript:');
    lines.push('```text');
    lines.push(stripAnsi(result.output).trimEnd());
    lines.push('```', '');
  }
  return `${lines.join('\n')}\n`;
}

async function main() {
  ensureNodePtySpawnHelperExecutable();
  const { default: pty } = await import('node-pty');
  const { toolManager } = await import('../dist/lib/tool-manager.js');
  const tools = toolManager.getAll().map((tool) => ({
    name: tool.name,
    displayName: tool.displayName,
  }));
  const homeDir = createHomeFixture();
  const results = [];

  try {
    for (const scenario of buildScenarios(tools)) {
      results.push(await runScenario(pty, scenario, homeDir));
    }
  } finally {
    fs.rmSync(homeDir, { recursive: true, force: true });
  }

  const reportPath = process.env.CODEX_INTERACTIVE_REPORT || DEFAULT_REPORT_PATH;
  fs.writeFileSync(reportPath, formatReport(results));

  const failures = results.flatMap((result) => result.analysis.failures.map((failure) => `${result.name}: ${failure}`));
  if (failures.length) {
    console.error(failures.join('\n'));
    process.exit(1);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.stack || error.message : String(error));
    process.exit(1);
  });
}
