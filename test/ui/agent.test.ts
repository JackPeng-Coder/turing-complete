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
import type { AgentConfig } from '../../src/agent/config';
import { setupSeen } from '../../src/agent/config';
import type { RunOptions, RunResult } from '../../src/agent/loop';
import { makeTestHost } from '../agent/host-fixture';

const CONFIG: AgentConfig = {
  baseUrl: 'https://x.test',
  apiKey: 'sk-1',
  model: 'm',
  stepMs: 0,
};

const DONE = (messages: RunOptions['messages']): RunResult => ({
  messages,
  stopped: 'done',
  error: null,
  steps: 1,
});

/**
 * Whether the first-run card is on screen.
 *
 * The `hidden` flag belongs to the OVERLAY, not to the card: the overlay is what
 * covers the stage and takes the pointer, and a hidden card inside a live overlay
 * would be a screen that looks closed and eats every click behind it.
 */
function setupShown(stage: HTMLElement): boolean {
  return !stage.querySelector('.overlay-agent-setup')!.hasAttribute('hidden');
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
  const state = { current: config, saved: [] as AgentConfig[], cleared: 0 };
  const runs: RunOptions[] = [];
  const panel = mountAgentPanel(stage, {
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
  });
  return { stage, panel, state, runs };
}

afterEach(() => {
  document.body.innerHTML = '';
  // The panel writes the "we asked already" flag through the real config module,
  // so a test that dismissed the card would otherwise hide it from the next one.
  globalThis.localStorage?.clear();
});

describe('a first run', () => {
  it('asks for the API information before anything else', () => {
    const { stage } = mount(null);
    expect(setupShown(stage)).toBe(true);
    expect(stage.querySelector('.agent-card:not(.agent-setup)')!.hasAttribute('hidden')).toBe(true);
    expect(stage.querySelector('.agent-toggle')!.textContent).toContain('未配置');
  });

  it('keeps the settings and opens the conversation once they are saved', () => {
    const { stage, state } = mount(null);
    const [baseUrl, apiKey, model] = [
      ...stage.querySelectorAll<HTMLInputElement>('.agent-setup .agent-field input'),
    ];
    baseUrl!.value = 'https://api.deepseek.com/';
    apiKey!.value = 'sk-secret';
    model!.value = 'deepseek-chat';
    clickButton(stage.querySelector('.agent-setup')!, '保存');
    expect(state.saved).toHaveLength(1);
    expect(state.saved[0]).toEqual({
      baseUrl: 'https://api.deepseek.com/',
      apiKey: 'sk-secret',
      model: 'deepseek-chat',
      stepMs: 160,
    });
    expect(setupShown(stage)).toBe(false);
    expect(stage.querySelector('.agent-card:not(.agent-setup)')!.hasAttribute('hidden')).toBe(false);
    expect(stage.querySelector('.agent-toggle')!.textContent).toBe('Agent');
  });

  it('refuses to save an incomplete configuration', () => {
    const { stage, state } = mount(null);
    const [baseUrl] = [...stage.querySelectorAll<HTMLInputElement>('.agent-setup .agent-field input')];
    baseUrl!.value = 'https://api.deepseek.com';
    clickButton(stage.querySelector('.agent-setup')!, '保存');
    expect(state.saved).toEqual([]);
    expect(setupShown(stage)).toBe(true);
  });

  it('can be dismissed, because the game plays fine without it', () => {
    const { stage } = mount(null);
    clickButton(stage.querySelector('.agent-setup')!, '以后再说');
    expect(setupShown(stage)).toBe(false);
    expect(setupSeen()).toBe(true);
    // And a second visit is not asked again: the answer was remembered.
    const second = mount(null);
    expect(setupShown(second.stage)).toBe(false);
  });

  it('forgets a stored key on request', () => {
    const { stage, state } = mount(CONFIG);
    stage.querySelector<HTMLButtonElement>('.agent-toggle')!.click();
    clickButton(stage, '设置');
    clickButton(stage.querySelector('.agent-setup')!, '清除已保存的 key');
    expect(state.cleared).toBe(1);
    expect(state.current).toBeNull();
  });

  it('opens the settings card instead of sending when nothing is configured', () => {
    const { stage, runs } = mount(null);
    clickButton(stage.querySelector('.agent-setup')!, '以后再说');
    const input = stage.querySelector<HTMLTextAreaElement>('.agent-input')!;
    input.value = '放一个与非门';
    clickButton(stage, '发送');
    expect(runs).toEqual([]);
    expect(setupShown(stage)).toBe(true);
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
      });
      options.onEvent?.({ kind: 'text', text: '与非门。' });
      return Promise.resolve(DONE([...options.messages]));
    };
    const { stage } = mount(CONFIG, scripted);
    stage.querySelector<HTMLButtonElement>('.agent-toggle')!.click();
    stage.querySelector<HTMLTextAreaElement>('.agent-input')!.value = '搭一个与非门';
    clickButton(stage, '发送');
    await tick();
    expect(stage.querySelector('.agent-text')!.textContent).toBe('先放一个与非门。');
    const tool = stage.querySelector('.agent-tool')!;
    expect(tool.textContent).toBe('place_part · {"id":"i1"}');
    expect(tool.className).toContain('agent-tool-end');
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
      return Promise.resolve({ messages: [...options.messages], stopped: 'error', error: null, steps: 1 });
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
            resolve({ messages: [...options.messages], stopped: 'aborted', error: null, steps: 1 }),
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
    expect(toggle.textContent).toContain('未配置');
    expect(toggle.className).toContain('agent-toggle-warn');
  });
});
