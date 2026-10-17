// @vitest-environment jsdom
/**
 * The panel, driven the way a player drives it.
 *
 * The run itself is injected: what is asserted here is the PANEL -- that a first
 * run asks for the settings, that a message becomes a user line and a request,
 * that a streamed answer and its tool rows land in the log in order, and that 停止
 * aborts the signal the loop is holding. The loop's own behaviour is
 * `test/agent/loop.test.ts`, and keeping the two apart is what lets either fail
 * on its own.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { mountAgentPanel } from '../../src/ui/agent';
import { DEFAULT_MAX_STEPS, type AgentConfig } from '../../src/agent/config';
import type { RunOptions, RunResult, RunStats } from '../../src/agent/loop';
import { makeTestHost } from '../agent/host-fixture';

const CONFIG: AgentConfig = {
  baseUrl: 'https://x.test',
  apiKey: 'sk-1',
  model: 'm',
  maxSteps: 0,
};

/** A run with no measured spend, for the stubs that are not about the numbers. */
const NO_STATS: RunStats = {
  llmMs: 0,
  ttftMs: 0,
  ttftSteps: 0,
  decodeMs: 0,
  decodeTokens: 0,
  usage: null,
  costCny: null,
};

const DONE = (messages: RunOptions['messages']): RunResult => ({
  messages,
  stopped: 'done',
  error: null,
  steps: 1,
  stats: NO_STATS,
});

/**
 * Whether the first-run card is on screen.
 *
 * The `hidden` flag belongs to the OVERLAY, not to the card: the overlay is what
 * covers the stage and takes the pointer, and a hidden card inside a live overlay
 * would be a screen that looks closed and eats every click behind it.
 */
function setupShown(): boolean {
  return !document.querySelector('.overlay-agent-setup')!.hasAttribute('hidden');
}

function clickButton(root: ParentNode, label: string): void {  const found = [...root.querySelectorAll('button')].find(
    (candidate) => candidate.textContent === label,
  );
  if (!found) throw new Error(`no button labelled ${label}`);
  found.click();
}

function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function mount(config: AgentConfig | null, run?: (options: RunOptions) => Promise<RunResult>) {
  const stage = document.createElement('div');
  document.body.append(stage);
  const rail = document.createElement('div');
  const sidebar = document.createElement('div');
  stage.append(rail, sidebar);
  const state = { current: config, saved: [] as AgentConfig[], cleared: 0 };
  const runs: RunOptions[] = [];
  const panel = mountAgentPanel(
    { toggle: rail, sidebar },
    {
      host: makeTestHost().host,
      config: () => state.current,
      onSave: (next) => {
        state.current = next;
        state.saved.push(next);
      },
      onClear: () => {
        state.cleared += 1;
        state.current = null;
      },
      run:
        run ??
        ((options) => {
          runs.push(options);
          return Promise.resolve(DONE([...options.messages]));
        }),
    },
  );
  return { stage, panel, state, runs };
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('a first run', () => {
  it('does not interrupt the board: the panel says what is missing', () => {
    const { stage } = mount(null);
    // No dialog over the board on load: the settings are a button, not a gate.
    expect(setupShown()).toBe(false);
    expect(stage.querySelector('.agent-card:not(.agent-setup)')!.hasAttribute('hidden')).toBe(true);
    expect(stage.querySelector('.agent-toggle')!.getAttribute('aria-label')).toContain('未配置');

    stage.querySelector<HTMLButtonElement>('.agent-toggle')!.click();
    const hint = stage.querySelector<HTMLElement>('.agent-setup-hint')!;
    expect(hint.hidden).toBe(false);
    expect(hint.textContent).toContain('还没有配置 API');
  });

  it('keeps the settings and removes the hint once they are saved', () => {
    const { stage, state } = mount(null);
    stage.querySelector<HTMLButtonElement>('.agent-toggle')!.click();
    clickButton(stage, '设置');
    const [baseUrl, apiKey, model, stepLimit] = [
      ...document.querySelectorAll<HTMLInputElement>('.agent-setup .agent-field input'),
    ];
    expect(model!.value).toBe('deepseek-flash');
    // A fresh install starts on the default budget, and it is editable.
    expect(stepLimit!.value).toBe(String(DEFAULT_MAX_STEPS));
    baseUrl!.value = 'https://api.deepseek.com/';
    apiKey!.value = 'sk-secret';
    model!.value = 'deepseek-flash';
    stepLimit!.value = '32';
    clickButton(document.querySelector('.agent-setup')!, '保存');
    expect(state.saved).toHaveLength(1);
    expect(state.saved[0]).toEqual({
      baseUrl: 'https://api.deepseek.com/',
      apiKey: 'sk-secret',
      model: 'deepseek-flash',
      maxSteps: 32,
    });
    expect(setupShown()).toBe(false);
    expect(stage.querySelector('.agent-card:not(.agent-setup)')!.hasAttribute('hidden')).toBe(false);
    expect(stage.querySelector<HTMLElement>('.agent-setup-hint')!.hidden).toBe(true);
    expect(stage.querySelector('.agent-toggle')!.getAttribute('aria-label')).toBe('Agent');
  });

  it('can be told not to cap the run at all', () => {
    const { stage, state } = mount(CONFIG);
    stage.querySelector<HTMLButtonElement>('.agent-toggle')!.click();
    clickButton(stage, '设置');
    const inputs = [...document.querySelectorAll<HTMLInputElement>('.agent-setup .agent-field input')];
    inputs[3]!.value = '0';
    clickButton(document.querySelector('.agent-setup')!, '保存');
    expect(state.saved[0]?.maxSteps).toBe(0);
  });

  it('refuses to save an incomplete configuration', () => {
    const { stage, state } = mount(null);
    stage.querySelector<HTMLButtonElement>('.agent-toggle')!.click();
    clickButton(stage, '设置');
    const [baseUrl] = [...document.querySelectorAll<HTMLInputElement>('.agent-setup .agent-field input')];
    baseUrl!.value = 'https://api.deepseek.com';
    clickButton(document.querySelector('.agent-setup')!, '保存');
    expect(state.saved).toEqual([]);
    expect(setupShown()).toBe(true);
  });

  it('can be dismissed, because the game plays fine without it', () => {
    const { stage } = mount(null);
    stage.querySelector<HTMLButtonElement>('.agent-toggle')!.click();
    clickButton(stage, '设置');
    clickButton(document.querySelector('.agent-setup')!, '以后再说');
    expect(setupShown()).toBe(false);
    // Closing is not remembering: the panel keeps saying what is missing.
    expect(stage.querySelector<HTMLElement>('.agent-setup-hint')!.hidden).toBe(false);
  });

  it('forgets a stored key on request', () => {
    const { stage, state } = mount(CONFIG);
    stage.querySelector<HTMLButtonElement>('.agent-toggle')!.click();
    clickButton(stage, '设置');
    clickButton(document.querySelector('.agent-setup')!, '清除已保存的 key');
    expect(state.cleared).toBe(1);
    expect(state.current).toBeNull();
  });

  it('opens the settings card instead of sending when nothing is configured', () => {
    const { stage, runs } = mount(null);
    stage.querySelector<HTMLButtonElement>('.agent-toggle')!.click();
    const input = stage.querySelector<HTMLTextAreaElement>('.agent-input')!;
    input.value = '放一个与非门';
    clickButton(stage, '发送');
    expect(runs).toEqual([]);
    expect(setupShown()).toBe(true);
  });
});

describe('a conversation', () => {
  it('sends what was typed and shows it as the player’s own line', async () => {
    const { stage, runs } = mount(CONFIG);
    stage.querySelector<HTMLButtonElement>('.agent-toggle')!.click();
    const input = stage.querySelector<HTMLTextAreaElement>('.agent-input')!;
    input.value = '放一个与非门，再把两个输入接上';
    clickButton(stage, '发送');
    await tick();
    expect(runs).toHaveLength(1);
    expect(runs[0]!.messages).toEqual([
      { role: 'user', content: '放一个与非门，再把两个输入接上' },
    ]);
    expect(stage.querySelector('.agent-user')!.textContent).toBe('放一个与非门，再把两个输入接上');
    expect(input.value).toBe('');
    expect(stage.querySelector('.agent-status')!.textContent).toBe('完成');
  });

  it('offers 继续执行 when the budget runs out, and the button continues the run', async () => {
    const runs: RunOptions[] = [];
    const scripted = (options: RunOptions): Promise<RunResult> => {
      runs.push(options);
      options.onEvent?.({ kind: 'cap', limit: 2 });
      return Promise.resolve({
        messages: [...options.messages],
        stopped: 'capped',
        error: null,
        steps: 2,
        stats: NO_STATS,
      });
    };
    const { stage } = mount({ ...CONFIG, maxSteps: 2 }, scripted);
    stage.querySelector<HTMLButtonElement>('.agent-toggle')!.click();
    const input = stage.querySelector<HTMLTextAreaElement>('.agent-input')!;
    input.value = '搭一个与非门';
    clickButton(stage, '发送');
    await tick();
    const cap = stage.querySelector('.agent-cap')!;
    expect(cap.textContent).toContain('继续执行');
    expect(cap.textContent).toContain('2 轮');

    clickButton(cap, '继续执行');
    await tick();
    // The same conversation, with no invented user line: the second request
    // carries exactly what the first one started with, which is what makes this
    // a shortcut rather than a new instruction.
    expect(runs).toHaveLength(2);
    expect(runs[1]!.messages).toEqual([{ role: 'user', content: '搭一个与非门' }]);
    expect(stage.querySelector('.agent-status')!.textContent).toBe('达到步数上限，先停下来了');
  });

  it('reports what the request cost, and totals it under the log', async () => {
    const stats: RunStats = {
      llmMs: 2_400,
      ttftMs: 300,
      ttftSteps: 1,
      decodeMs: 2_000,
      decodeTokens: 40,
      usage: { input: 1_200, output: 40, total: 1_240, cacheRead: 1_000 },
      costCny: 0.00042,
    };
    const scripted = (options: RunOptions): Promise<RunResult> => {
      options.onEvent?.({ kind: 'step', index: 0 });
      options.onEvent?.({ kind: 'text', text: '放好了' });
      return Promise.resolve({
        messages: [...options.messages],
        stopped: 'done',
        error: null,
        steps: 1,
        stats,
      });
    };
    const { stage } = mount(CONFIG, scripted);
    stage.querySelector<HTMLButtonElement>('.agent-toggle')!.click();
    const input = stage.querySelector<HTMLTextAreaElement>('.agent-input')!;
    input.value = '放一个与非门';
    clickButton(stage, '发送');
    await tick();

    const row = stage.querySelector('.agent-run-stats')!;
    // The four readings, in the order DSH's composer pills show them, plus the
    // estimated cost from the published DeepSeek prices.
    expect(row.textContent).toBe('2.4s · 1.2k tok · 20 tok/s · 缓存 83% · ¥0.0004');
    expect(row.getAttribute('title')).toContain('输入 1,200 tok');
    expect(row.getAttribute('title')).toContain('首字平均 0.3s');
    expect(row.getAttribute('title')).toContain('估算费用 ¥0.0004');

    const total = stage.querySelector('.agent-session-stats')!;
    expect(total.hasAttribute('hidden')).toBe(false);
    expect(total.textContent).toBe('累计 1 次 · 1 步 · 1.2k tok · 20 tok/s · 缓存 83% · ¥0.0004');
  });

  it('shows time alone when the provider reports no usage', async () => {
    const stats: RunStats = {
      llmMs: 1_200,
      ttftMs: 0,
      ttftSteps: 0,
      decodeMs: 0,
      decodeTokens: 0,
      usage: null,
      costCny: null,
    };
    const scripted = (options: RunOptions): Promise<RunResult> =>
      Promise.resolve({
        messages: [...options.messages],
        stopped: 'done',
        error: null,
        steps: 1,
        stats,
      });
    const { stage } = mount(CONFIG, scripted);
    stage.querySelector<HTMLButtonElement>('.agent-toggle')!.click();
    const input = stage.querySelector<HTMLTextAreaElement>('.agent-input')!;
    input.value = '放一个与非门';
    clickButton(stage, '发送');
    await tick();

    // No invented zeroes: the request took 1.2s and that is all that is known.
    expect(stage.querySelector('.agent-run-stats')!.textContent).toBe('1.2s');
    expect(stage.querySelector('.agent-run-stats')!.getAttribute('title')).toContain('没有返回用量');
    expect(stage.querySelector('.agent-session-stats')!.textContent).toBe('累计 1 次 · 1 步');
  });

  it('shows the readings live, while the request is still running', async () => {
    const liveStats: RunStats = {
      llmMs: 900,
      ttftMs: 200,
      ttftSteps: 1,
      decodeMs: 600,
      decodeTokens: 30,
      usage: { input: 500, output: 30, total: 530, cacheRead: 200 },
      costCny: 0.0002,
    };
    let release: ((result: RunResult) => void) | null = null;
    const scripted = (options: RunOptions): Promise<RunResult> => {
      options.onEvent?.({ kind: 'progress', stats: liveStats, steps: 1 });
      return new Promise<RunResult>((resolve) => {
        release = resolve;
      });
    };
    const { stage } = mount(CONFIG, scripted);
    stage.querySelector<HTMLButtonElement>('.agent-toggle')!.click();
    const input = stage.querySelector<HTMLTextAreaElement>('.agent-input')!;
    input.value = '搭一个与非门';
    clickButton(stage, '发送');
    await tick();

    // The totaliser is already live: elapsed time, the step count, the tokens and
    // the cost of the step that has settled -- not a line that waits for the run.
    const total = stage.querySelector('.agent-session-stats')!;
    expect(total.hasAttribute('hidden')).toBe(false);
    expect(total.textContent).toContain('运行中');
    expect(total.textContent).toContain('1 步');
    expect(total.textContent).toContain('530 tok');
    expect(total.textContent).toContain('¥0.0002');

    release!({ messages: [{ role: 'user', content: '搭一个与非门' }], stopped: 'done', error: null, steps: 1, stats: liveStats });
    await tick();
    expect(stage.querySelector('.agent-session-stats')!.textContent).toContain('累计 1 次');
  });

  it('shows the streamed answer and each tool row with its result', async () => {
    const scripted = (options: RunOptions): Promise<RunResult> => {
      options.onEvent?.({ kind: 'step', index: 0 });
      options.onEvent?.({ kind: 'text', text: '先放一个' });
      options.onEvent?.({ kind: 'tool', phase: 'start', callId: 'c1', name: 'place_part' });
      options.onEvent?.({
        kind: 'tool',
        phase: 'end',
        callId: 'c1',
        name: 'place_part',
        ok: true,
        text: JSON.stringify({ ok: true, result: { id: 'i1' } }),
        note: '在 (16, 32) 放了 与非门（i1）',
      });
      options.onEvent?.({ kind: 'text', text: '与非门。' });
      options.onEvent?.({ kind: 'step', index: 1 });
      options.onEvent?.({ kind: 'text', text: '搭好了。' });
      return Promise.resolve(DONE([...options.messages]));
    };
    const { stage } = mount(CONFIG, scripted);
    stage.querySelector<HTMLButtonElement>('.agent-toggle')!.click();
    stage.querySelector<HTMLTextAreaElement>('.agent-input')!.value = '搭一个与非门';
    clickButton(stage, '发送');
    await tick();
    // The step that called a tool is folded; the step that answered is not.
    const folded = stage.querySelector('.agent-think:not(.agent-think-live)')!;
    expect(folded.querySelector('.agent-think-head')!.textContent).toBe('▸ 思考 · 1 行');
    expect(folded.querySelector<HTMLElement>('.agent-think-body')!.hidden).toBe(true);
    expect(folded.querySelector('.agent-think-body')!.textContent).toBe('先放一个与非门。');
    expect(stage.querySelector('.agent-text')!.textContent).toBe('搭好了。');
    const tool = stage.querySelector('.agent-tool')!;
    expect(tool.textContent).toBe('place_part · 在 (16, 32) 放了 与非门（i1）');
    expect(tool.className).toContain('agent-tool-end');
  });

  it('shows the tail while it is writing, and folds the block when the step ends', async () => {
    let finish: () => void = () => {};
    const scripted = (options: RunOptions): Promise<RunResult> =>
      new Promise<RunResult>((resolve) => {
        finish = () => resolve(DONE([...options.messages]));
        options.onEvent?.({ kind: 'step', index: 0 });
        options.onEvent?.({ kind: 'thinking', text: '先看看板子上有什么。' });
        options.onEvent?.({ kind: 'text', text: '再决定放什么。' });
      });
    const { stage } = mount(CONFIG, scripted);
    stage.querySelector<HTMLButtonElement>('.agent-toggle')!.click();
    stage.querySelector<HTMLTextAreaElement>('.agent-input')!.value = '想想';
    clickButton(stage, '发送');
    await tick();

    // MID-STREAM: one open window holding the reasoning and the narration, with
    // a header that says it is still being written.
    const live = stage.querySelector<HTMLElement>('.agent-think-live')!;
    expect(live).not.toBeNull();
    expect(live.querySelector('.agent-think-head')!.textContent).toBe('思考中…');
    const liveBody = live.querySelector<HTMLElement>('.agent-think-body')!;
    expect(liveBody.hidden).toBe(false);
    expect(liveBody.textContent).toBe('先看看板子上有什么。\n再决定放什么。');

    // WHEN THE STEP ENDS it calls no tool, so this is the ANSWER: the reasoning
    // folds above it and the sentence stays readable.
    finish();
    await tick();
    expect(stage.querySelector('.agent-think-live')).toBeNull();
    const body = stage.querySelector<HTMLElement>('.agent-think-body')!;
    expect(body.hidden).toBe(true);
    expect(body.textContent).toBe('先看看板子上有什么。');
    expect(stage.querySelector('.agent-think-head')!.textContent).toBe('▸ 思考 · 1 行');
    expect(stage.querySelector('.agent-text')!.textContent).toBe('再决定放什么。');
  });

  it('opens a folded block when its header is clicked', async () => {
    const scripted = (options: RunOptions): Promise<RunResult> => {
      options.onEvent?.({ kind: 'step', index: 0 });
      options.onEvent?.({ kind: 'text', text: '看一看。' });
      options.onEvent?.({ kind: 'tool', phase: 'start', callId: 'c1', name: 'read_board' });
      return Promise.resolve(DONE([...options.messages]));
    };
    const { stage } = mount(CONFIG, scripted);
    stage.querySelector<HTMLButtonElement>('.agent-toggle')!.click();
    stage.querySelector<HTMLTextAreaElement>('.agent-input')!.value = '看看';
    clickButton(stage, '发送');
    await tick();
    const head = stage.querySelector<HTMLButtonElement>('.agent-think-head')!;
    expect(head.textContent).toBe('▸ 思考 · 1 行');
    head.click();
    await tick();
    const opened = stage.querySelector<HTMLButtonElement>('.agent-think-head')!;
    expect(opened.textContent).toBe('▾ 思考 · 1 行');
    expect(stage.querySelector<HTMLElement>('.agent-think-body')!.hidden).toBe(false);
  });

  it('shows the tool’s own sentence when it has one', async () => {
    const scripted = (options: RunOptions): Promise<RunResult> => {
      options.onEvent?.({ kind: 'step', index: 0 });
      options.onEvent?.({ kind: 'tool', phase: 'start', callId: 'c1', name: 'place_part' });
      options.onEvent?.({
        kind: 'tool',
        phase: 'end',
        callId: 'c1',
        name: 'place_part',
        ok: true,
        text: JSON.stringify({ ok: true, result: { id: 'i1', defId: 'nand', x: 16, y: 32 } }),
        note: '在 (16, 32) 放了 与非门（i1）',
      });
      return Promise.resolve(DONE([...options.messages]));
    };
    const { stage } = mount(CONFIG, scripted);
    stage.querySelector<HTMLButtonElement>('.agent-toggle')!.click();
    stage.querySelector<HTMLTextAreaElement>('.agent-input')!.value = '放一个与非门';
    clickButton(stage, '发送');
    await tick();
    expect(stage.querySelector('.agent-tool')!.textContent).toBe(
      'place_part · 在 (16, 32) 放了 与非门（i1）',
    );
  });

  it('shows a failed tool as a failure with the refusal it was given', async () => {
    const scripted = (options: RunOptions): Promise<RunResult> => {
      options.onEvent?.({ kind: 'step', index: 0 });
      options.onEvent?.({ kind: 'tool', phase: 'start', callId: 'c1', name: 'connect_pins' });
      options.onEvent?.({
        kind: 'tool',
        phase: 'end',
        callId: 'c1',
        name: 'connect_pins',
        ok: false,
        text: JSON.stringify({ ok: false, error: '与非门没有输入引脚「q」' }),
      });
      return Promise.resolve(DONE([...options.messages]));
    };
    const { stage } = mount(CONFIG, scripted);
    stage.querySelector<HTMLButtonElement>('.agent-toggle')!.click();
    stage.querySelector<HTMLTextAreaElement>('.agent-input')!.value = '接上 q';
    clickButton(stage, '发送');
    await tick();
    const tool = stage.querySelector('.agent-tool')!;
    expect(tool.textContent).toBe('connect_pins · 与非门没有输入引脚「q」');
    expect(tool.className).toContain('agent-tool-bad');
  });

  it('reports an error event and keeps the panel usable afterwards', async () => {
    const scripted = (options: RunOptions): Promise<RunResult> => {
      options.onEvent?.({
        kind: 'error',
        message: 'API key 被拒绝（HTTP 401）',
        detail: 'Authentication Fails',
      });
      return Promise.resolve({
        messages: [...options.messages],
        stopped: 'error',
        error: null,
        steps: 1,
        stats: NO_STATS,
      });
    };
    const { stage } = mount(CONFIG, scripted);
    stage.querySelector<HTMLButtonElement>('.agent-toggle')!.click();
    stage.querySelector<HTMLTextAreaElement>('.agent-input')!.value = '试试';
    clickButton(stage, '发送');
    await tick();
    expect(stage.querySelector('.agent-error')!.textContent).toContain('401');
    expect(stage.querySelector('.agent-status')!.textContent).toContain('出错');
    expect(stage.querySelector<HTMLButtonElement>('.agent-input')!.disabled).toBe(false);
  });

  it('aborts the run the loop is holding when 停止 is pressed', async () => {
    let held: AbortSignal | null = null;
    const { stage } = mount(
      CONFIG,
      (options) =>
        new Promise<RunResult>((resolve) => {
          held = options.signal;
          options.signal.addEventListener('abort', () =>
            resolve({
              messages: [...options.messages],
              stopped: 'aborted',
              error: null,
              steps: 1,
              stats: NO_STATS,
            }),
          );
        }),
    );
    stage.querySelector<HTMLButtonElement>('.agent-toggle')!.click();
    stage.querySelector<HTMLTextAreaElement>('.agent-input')!.value = '慢慢来';
    clickButton(stage, '发送');
    await tick();
    expect(held!.aborted).toBe(false);
    clickButton(stage, '停止');
    expect(held!.aborted).toBe(true);
    await tick();
    expect(stage.querySelector('.agent-status')!.textContent).toBe('已停止');
  });
});

describe('the toggle', () => {
  it('opens and closes the conversation card', () => {
    const { stage } = mount(CONFIG);
    const card = stage.querySelector('.agent-card:not(.agent-setup)')!;
    expect(card.hasAttribute('hidden')).toBe(true);
    stage.querySelector<HTMLButtonElement>('.agent-toggle')!.click();
    expect(card.hasAttribute('hidden')).toBe(false);
    stage.querySelector<HTMLButtonElement>('.agent-toggle')!.click();
    expect(card.hasAttribute('hidden')).toBe(true);
  });

  it('tells the player it is not configured yet', () => {
    const { stage } = mount(null);
    const toggle = stage.querySelector('.agent-toggle')!;
    // The rail is 48px wide, so the fact lives in the accessible name and the
    // warning class rather than in visible text.
    expect(toggle.getAttribute('aria-label')).toContain('未配置');
    expect(toggle.className).toContain('agent-toggle-warn');
  });
});
