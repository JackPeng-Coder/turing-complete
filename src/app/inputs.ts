import type { BoardPins } from '../levels/sandbox';

/**
 * What a click on an input connector leaves that pin driven with, or `null`.
 *
 * ONE BIT TOGGLES; A WIDER PIN COUNTS UP AND WRAPS. That is the board's own nudge
 * gesture -- the readout panel's per-bit cells are how an exact byte is typed --
 * and it is the same rule on a level as in the sandbox. The only difference
 * between the two boards is what names the pin: a level's pin is `IN_<pinId>`,
 * while a sandbox connector's pin id IS its instance id (`sandboxPins`).
 *
 * BOTH SPELLINGS, ONE PLACE. The board used to resolve the name itself, by
 * slicing `IN_` off the instance id and looking the rest up in `level.io`. A
 * sandbox has no `level.io`, so a click on `IN_1` found nothing and did nothing --
 * the same defect as a sandbox that offered no connectors, one layer up. Reading
 * the pins from `boardPins` (which every other reader already uses) is what makes
 * a click work on both boards.
 *
 * `null` for a click on anything that is not an input connector: a click on a gate
 * means select, and always has.
 */
export function nudgedInput(
  pins: BoardPins,
  instanceId: string,
  vector: Readonly<Record<string, number>>,
): { readonly pinId: string; readonly value: number } | null {
  const pin =
    pins.inputs.find((candidate) => candidate.id === instanceId) ??
    pins.inputs.find((candidate) => `IN_${candidate.id}` === instanceId);
  if (pin === undefined) return null;
  const max = pin.width >= 31 ? Number.MAX_SAFE_INTEGER : 2 ** pin.width - 1;
  const current = vector[pin.id] ?? 0;
  return { pinId: pin.id, value: current >= max ? 0 : current + 1 };
}
