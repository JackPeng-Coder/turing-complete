/**
 * THE ASSISTANT'S PALETTE IS THE PLAYER'S PALETTE, ON EVERY SHIPPED LEVEL.
 *
 * `main.ts` builds the agent host's `parts()` out of `offeredDefsFor`, the same
 * function the parts tray calls, so a part a level withholds is withheld from the
 * model as well -- `list_parts` cannot name it and `place_part` refuses it. That
 * is the agent half of the rule `test/levels/palette-answer.test.ts` proves by
 * grading: the tray and the assistant cannot disagree about what is on offer,
 * because there is one function and this test walks it against the real level
 * data rather than a stub.
 *
 * WHY THESE LEVELS. `ch1-11-bigger-and-gate` is the 三路与门 defect: `and3` was
 * on its palette and answered it in one drop, and the fix moved the pointer
 * (the reward) to the level that teaches the gate. `ch2-39-counter` withholds
 * `counter8` by the chapter's own rule (the level measures the drop-in and
 * refuses it), which makes it the second witness: the rule is not a one-off
 * patch on a single level.
 *
 * The tool results are the model's view, not the tray's: a refusal here is the
 * JSON the agent reads back after a wrong `place_part`, and the part it names is
 * the list it would have had to read first.
 */
import { describe, expect, it } from 'vitest';
import { emptyProgress, offeredDefsFor } from '../../src/app/progress';
import type { PartInfo } from '../../src/agent/host';
import { circuitTools } from '../../src/agent/ops';
import { findTool, runTool, type ToolSpec } from '../../src/agent/tools';
import { getLevel, LEVELS } from '../../src/levels/index';
import { SANDBOX_LEVEL } from '../../src/levels/sandbox';
import { registry } from '../fixtures/build';
import { makeTestHost } from './host-fixture';

const SIGNAL = new AbortController().signal;

/** A registry def as the host reports it. */
function partInfo(id: string): PartInfo {
  const def = registry.get(id);
  return {
    id: def.id,
    nameZh: def.name.zh,
    nameEn: def.name.en,
    category: def.category,
    hidden: def.hidden === true,
    inputs: def.inputs.map((pin) => ({ id: pin.id, width: pin.width })),
    outputs: def.outputs.map((pin) => ({ id: pin.id, width: pin.width })),
  };
}

/**
 * The host a shipped level gives the assistant.
 *
 * `dev: true` is the WIDEST palette a level ever has -- it skips the unlock
 * filter and keeps the level's own list -- so a part missing here is missing on
 * every save, however much of the campaign the player has passed.
 */
function hostFor(levelId: string) {
  const level = getLevel(levelId);
  const palette = offeredDefsFor(emptyProgress(), LEVELS, level, true, registry);
  return { level, fixture: makeTestHost({ parts: palette.map(partInfo) }) };
}

function toolOf(fixture: ReturnType<typeof makeTestHost>, name: string): ToolSpec {
  const spec = findTool(circuitTools(fixture.host), name);
  if (spec === null) throw new Error(`no tool ${name}`);
  return spec;
}

async function call(
  fixture: ReturnType<typeof makeTestHost>,
  name: string,
  args: unknown,
): Promise<{ ok: boolean; body: any }> {
  const outcome = await runTool(toolOf(fixture, name), JSON.stringify(args), { signal: SIGNAL });
  return { ok: outcome.ok, body: JSON.parse(outcome.text) };
}

/** The ids `list_parts` reports, which is the model's whole catalogue. */
async function listed(fixture: ReturnType<typeof makeTestHost>): Promise<string[]> {
  const { body } = await call(fixture, 'list_parts', {});
  return (body.result as { id: string }[]).map((part) => part.id);
}

describe('a withheld answer is withheld from the assistant', () => {
  it('三路与门 does not list and3, and refuses to place it', async () => {
    const { fixture } = hostFor('ch1-11-bigger-and-gate');
    const ids = await listed(fixture);
    expect(ids).not.toContain('and3');
    // The palette is still a palette: the two-input AND the cascade is built from.
    expect(ids).toContain('and');

    const refused = await call(fixture, 'place_part', { defId: 'and3', x: 0, y: 0 });
    expect(refused.ok).toBe(false);
    // The refusal names the list, so a model that guessed learns where to look.
    expect(refused.body.error).toContain('list_parts');
    expect(fixture.graph.instances).toEqual([]);
  });

  it('the counter level does not list counter8, and refuses to place it', async () => {
    const { fixture } = hostFor('ch2-39-counter');
    const ids = await listed(fixture);
    expect(ids).not.toContain('counter8');
    expect(ids).toContain('reg8');

    const refused = await call(fixture, 'place_part', { defId: 'counter8', x: 0, y: 0 });
    expect(refused.ok).toBe(false);
    expect(fixture.graph.instances).toEqual([]);
  });

  it('places a part the level does offer, so the refusal is about the part', async () => {
    const { fixture } = hostFor('ch1-11-bigger-and-gate');
    const placed = await call(fixture, 'place_part', { defId: 'and', x: 0, y: 0 });
    expect(placed.ok).toBe(true);
    expect(fixture.graph.instances.map((inst) => inst.def)).toEqual(['and']);
  });

  it('offers the sandbox its connectors, so the assistant can be driven and read', async () => {
    // THE SANDBOX HAS NO LEVEL PINS, so its palette carries the two connectors
    // (`sandboxPaletteDefs`). Without them a session could build a circuit and
    // then have nothing to place as an output -- the reported "怎么没有输出".
    const palette = offeredDefsFor(emptyProgress(), LEVELS, SANDBOX_LEVEL, false, registry);
    expect(palette).toContain('level_input');
    expect(palette).toContain('level_output');

    const fixture = makeTestHost({ parts: palette.map(partInfo) });
    // The sandbox host names a placed connector `IN_1` / `OUT_1` (see
    // `levelIoPlacement`), which is what `read_board` reports as a pin.
    fixture.connectors.level_input = { id: 'IN_1', width: 1 };
    fixture.connectors.level_output = { id: 'OUT_1', width: 1 };

    expect(await listed(fixture)).toContain('level_output');
    const placed = await call(fixture, 'place_part', { defId: 'level_output', x: 0, y: 0 });
    expect(placed.ok).toBe(true);
    expect(placed.body.result.id).toBe('OUT_1');
  });

  it('offers the sandbox the wide packers its connectors can reach', async () => {
    // A sandbox connector's width is the player's, up to 32 bits, and the 8-bit
    // packers truncate anything wider -- so the sandbox palette carries the
    // 16/32-bit pair (`PACKER_DEFS`). The agent's catalogue is the tray's, which
    // is the user-visible half of the fix; the defs themselves are
    // `test/core/defs-wide.test.ts`.
    const palette = offeredDefsFor(emptyProgress(), LEVELS, SANDBOX_LEVEL, false, registry);
    expect(palette).toEqual(
      expect.arrayContaining(['splitter16', 'maker16', 'splitter32', 'maker32']),
    );

    const fixture = makeTestHost({ parts: palette.map(partInfo) });
    expect(await listed(fixture)).toEqual(expect.arrayContaining(['splitter16', 'maker16']));
    const placed = await call(fixture, 'place_part', { defId: 'splitter16', x: 0, y: 0 });
    expect(placed.ok).toBe(true);
    expect(fixture.graph.instances.map((inst) => inst.def)).toEqual(['splitter16']);
  });

  it('names the connectors in the readable step line once the board is a sandbox', async () => {
    // The line the player reads is the tool's `note`, and on a sandbox it must not
    // hide the two parts that make a circuit observable.
    const palette = offeredDefsFor(emptyProgress(), LEVELS, SANDBOX_LEVEL, false, registry);
    const fixture = makeTestHost({ parts: palette.map(partInfo), mode: 'sandbox' });
    const outcome = await runTool(toolOf(fixture, 'list_parts'), '{}', { signal: SIGNAL });
    expect(outcome.note).toContain('关卡输入');
    expect(outcome.note).toContain('关卡输出');
  });
});

describe("every shipped level's agent palette is its own list", () => {
  it('never offers the assistant a part the level does not list', () => {
    // The whole-campaign form of the two witnesses above: for every shipped level,
    // in both modes, the parts the assistant may place are drawn from that level's
    // `allowedComponents` and nothing else. `dev` is included because it is the
    // widest the palette ever gets, and the sandbox is excluded because it is not a
    // puzzle (its palette is the registry's base set by design -- `sandboxPaletteDefs`).
    const progress = emptyProgress();
    let walked = 0;
    for (const level of LEVELS) {
      if (level.sandbox === true) continue;
      for (const dev of [false, true]) {
        const parts = offeredDefsFor(progress, LEVELS, level, dev, registry);
        for (const def of parts) {
          expect(level.allowedComponents, `${level.id} (dev=${String(dev)}) offers ${def}`).toContain(def);
        }
        walked += 1;
      }
    }
    // Non-vacuity: both modes of every shipped level were walked.
    expect(walked).toBe(LEVELS.length * 2);
  });
});
