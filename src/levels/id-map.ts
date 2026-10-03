/**
 * The 1.x level ids, and what each of them is called now.
 *
 * The 2026-10-04 realignment moved every level in chapters 1-3 to its 2.x
 * position (see `src/levels/campaign.ts`), which changed the id of 44 of them:
 * the id carries the level's global index, so renumbering one level renumbers
 * everything after it.
 *
 * A saved game is keyed by those ids (`persist/storage.ts`), so `migrate` reads
 * this table to carry a player's stars across the change. It is a translation
 * table, not a level list: an id that is already current -- or one this table
 * has never heard of -- passes through untouched, which is what makes the
 * migration idempotent.
 *
 * The three ids in `RETIRED_LEVEL_IDS` are the other half of the same story:
 * 2.x has no level for them, so a save that mentions one loses that record.
 */
export const LEGACY_LEVEL_IDS: Readonly<Record<string, string>> = {
  'ch1-01-crude-awakening': 'ch1-01-humble-beginnings',
  'ch1-06-nor-gate': 'ch1-05-nor-gate',
  'ch1-05-or-gate': 'ch1-06-or-gate',
  'ch1-08-second-tick': 'ch1-08-second-cycle',
  'ch1-12-binary-racer': 'ch2-14-binary-racer',
  'ch2-14-double-trouble': 'ch2-15-double-detection',
  'ch2-13-odd-number-of-signals': 'ch2-16-odd-number-of-signals',
  'ch2-28-circular-dependency': 'ch2-17-circular-dependency',
  'ch2-16-counting-signals': 'ch2-18-counting-signals',
  'ch2-20-half-adder': 'ch2-19-half-adder',
  'ch2-29-delayed-lines': 'ch2-20-delayed-lines',
  'ch2-17-double-the-number': 'ch2-21-double-the-number',
  'ch2-21-full-adder': 'ch2-22-full-adder',
  'ch2-30-odd-ticks': 'ch2-23-odd-cycles',
  'ch2-32-bit-switch': 'ch2-24-bit-switch',
  'ch2-19-byte-not': 'ch2-26-byte-not',
  'ch2-22-adding-bytes': 'ch2-27-adding-bytes',
  'ch2-31-bit-inverter': 'ch2-28-bit-inverter',
  'ch2-23-negative-numbers': 'ch2-29-negative-numbers',
  'ch2-33-input-selector': 'ch2-30-multiplexer',
  'ch2-24-signed-negator': 'ch2-31-signed-negator',
  'ch2-34-the-bus': 'ch2-32-the-bus',
  'ch2-35-saving-gracefully': 'ch2-33-saving-gracefully',
  'ch2-36-saving-bytes': 'ch2-34-saving-bytes',
  'ch2-25-1-bit-decoder': 'ch2-35-1-bit-decoder',
  'ch2-26-3-bit-decoder': 'ch2-37-3-bit-decoder',
  'ch2-37-little-box': 'ch2-38-little-box',
  'ch2-38-counter': 'ch2-39-counter',
  'ch3-39-arithmetic-engine': 'ch3-40-alu-1',
  'ch3-40-registers': 'ch3-41-registers',
  'ch3-41-component-factory': 'ch3-43-the-foundry',
  'ch3-42-instruction-decoder': 'ch3-44-instruction-decoder',
  'ch3-44-conditions': 'ch3-45-conditions',
  'ch3-43-calculations': 'ch3-46-alu',
  'ch3-46-immediate-values': 'ch3-47-immediate-values',
  'ch3-45-program': 'ch3-48-program',
  'ch3-47-turing-complete': 'ch3-49-turing-complete',
};

/**
 * Levels that no level exists for any more.
 *
 * Chapter 2 lost three of its 1.x levels to the 2.x realignment: `Byte OR` (2.x
 * has `Byte NAND` in the neighbourhood instead), `Logic Engine` (removed by 2.x)
 * and the popcount level that was misnamed `Binary Racer` (it duplicated
 * `Counting Signals`; 2.x has one Binary Racer and it is the four-bit reader).
 */
export const RETIRED_LEVEL_IDS: readonly string[] = [
  'ch2-15-binary-racer',
  'ch2-18-byte-or',
  'ch2-27-logic-engine',
];

/** The current id for a stored one, or null if no level answers to it any more. */
export function currentIdOf(id: string): string | null {
  const mapped = LEGACY_LEVEL_IDS[id];
  if (mapped !== undefined) return mapped;
  return RETIRED_LEVEL_IDS.includes(id) ? null : id;
}
