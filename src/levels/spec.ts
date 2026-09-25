export interface LocalizedText {
  readonly zh: string;
  readonly en: string;
}

export interface PinSpec {
  readonly id: string;
  readonly width: number;
  readonly label?: LocalizedText;
}

export interface TruthRow {
  readonly inputs: Readonly<Record<string, number>>;
  readonly outputs: Readonly<Record<string, number>>;
}

export interface TruthTableCheck {
  readonly kind: 'truth-table';
  /**
   * The rows to compare against, stated explicitly.
   *
   * Omitting `rows`, or passing an empty array, is a hard `missing-rows`
   * failure -- it is NOT "exhaustively enumerate every input combination". A
   * table with no expectations would compare nothing and pass every circuit
   * ever built, so a level must supply its rows. To build them from per-pin
   * expectation functions, enumerate the inputs with `generateRows` and assign
   * the result here; enumeration only ever happens to PRODUCE rows, never
   * because they were left out.
   */
  readonly rows?: readonly TruthRow[];
}

export interface ScriptStep {
  readonly tick: number;
  readonly inputs?: Readonly<Record<string, number>>;
  readonly expect?: Readonly<Record<string, number>>;
}

export interface ScriptCheck {
  readonly kind: 'script';
  readonly steps: readonly ScriptStep[];
}

export type ConstraintRule =
  | { readonly kind: 'sum-equals'; readonly inputs: readonly string[]; readonly output: string }
  | {
      readonly kind: 'at-least';
      readonly inputs: readonly string[];
      readonly count: number;
      readonly output: string;
    };

export interface ConstraintCheck {
  readonly kind: 'constraint';
  readonly rule: ConstraintRule;
}

/**
 * The values a fuzz round *draws* for the level's input pins: one entry per pin,
 * each already inside that pin's width, produced by the check's own seeded PRNG.
 *
 * Used by `FuzzCheck.inputs`, never driven into a circuit as-is: the input
 * function for a pin decides what that pin is actually written with.
 */
export type FuzzSample = Readonly<Record<string, number>>;

/** The values one fuzz round drives into the level's input pins. */
export type FuzzVector = Readonly<Record<string, number>>;

/**
 * Random vectors from a fixed seed, repeated `rounds` times.
 *
 * Both records are keyed by the level's own pin ids and must name every pin of
 * the level (`spec.io.inputs` / `spec.io.outputs`) and nothing else; a missing
 * or unknown name is an `invalid` failure, exactly like `truthTable`'s refusal
 * to leave an output pin out. The functions are PURE: no network, no real time,
 * no `Math.random()` -- the kernel's PRNG is the only source of variation, and
 * the same `seed` always produces the same vectors.
 */
export interface FuzzCheck {
  readonly kind: 'fuzz';
  /** PRNG seed, coerced with `>>> 0`. Must be an integer. */
  readonly seed: number;
  /**
   * How many random vectors to run. Defaults to `DEFAULT_FUZZ_ROUNDS` and is
   * clamped to `FUZZ_ROUNDS_CAP` (both in `levels/checks.ts`).
   *
   * Omitting it is fine; stating `0`, a negative number, a fraction or `NaN` is
   * a hard `missing-vectors` failure. A check that runs no rounds would compare
   * nothing and pass every circuit ever built -- the `missing-rows` lesson.
   */
  readonly rounds?: number;
  /** One pure function per input pin: the drawn sample in, the value to drive out. */
  readonly inputs: Readonly<Record<string, (sample: FuzzSample) => number>>;
  /**
   * One pure function per output pin: the driven vector in, the expected value
   * out.
   *
   * The value is a whole number per pin, whatever the pin's width: a pin wider
   * than eight bits is compared as the number `LevelIo.readOutput` reads back
   * (up to 2^53), so an 8-bit sum is written `(a + b) & 0xff`. Nothing is masked
   * for the author here -- a value that does not fit its pin is an `invalid`
   * failure naming the pin, not a silently reduced comparison.
   */
  readonly outputs: Readonly<Record<string, (inputs: FuzzVector) => number>>;
}

/**
 * A level-specific hook, looked up by id in the registry at
 * `levels/custom/index.ts`.
 *
 * Only the id lives in level data. An implementation inlined into a level is
 * neither serialisable nor reviewable, so the kernel refuses to call one.
 */
export interface CustomCheck {
  readonly kind: 'custom';
  /** Key into the custom check registry; an unregistered id is `missing-check`. */
  readonly id: string;
}

export type LevelCheck =
  | TruthTableCheck
  | ScriptCheck
  | ConstraintCheck
  | FuzzCheck
  | CustomCheck;

export interface LevelSpec {
  readonly id: string;
  readonly chapter: number;
  readonly index: number;
  readonly name: LocalizedText;
  readonly brief: LocalizedText;
  readonly hint: LocalizedText;
  readonly allowedComponents: readonly string[];
  readonly io: {
    readonly inputs: readonly PinSpec[];
    readonly outputs: readonly PinSpec[];
  };
  readonly checks: readonly LevelCheck[];
  readonly threeStar?: {
    readonly gate?: number;
    readonly delay?: number;
    readonly tick?: number;
  };
  readonly rewards?: { readonly components?: readonly string[] };
}

/**
 * Every reason a check failure can carry, as a runtime array.
 *
 * This array is the single source of truth: `FailureReason` is derived from it,
 * and the validation of a custom checker's failure records (`levels/checks.ts`)
 * reads the array itself. Adding a reason to one and not the other is therefore
 * impossible -- and it matters, because a reason the union declares but the
 * array does not would make every checker that used it report "malformed".
 */
export const FAILURE_REASONS = [
  'mismatch',
  'unstable',
  'invalid',
  'missing-io',
  'missing-rows',
  /**
   * A `fuzz` check that would exercise nothing: no usable `rounds`, no input
   * pins to vary, or no expectation functions to compare with. The `fuzz`
   * analogue of `missing-rows`.
   */
  'missing-vectors',
  /** A `custom` check whose id is not in the registry. */
  'missing-check',
] as const;

/** Why a check failure was recorded: one of `FAILURE_REASONS`. */
export type FailureReason = (typeof FAILURE_REASONS)[number];

export interface CheckFailure {
  readonly check: LevelCheck['kind'];
  readonly inputs: Readonly<Record<string, number>>;
  readonly expected: Readonly<Record<string, number>>;
  readonly actual: Readonly<Record<string, number>>;
  readonly tick: number;
  /**
   * 0-based fuzz round this failure came from; absent on every other kind.
   *
   * Its own field rather than a value smuggled into `inputs`, because `inputs`
   * is the vector the circuit was driven with and the failure table renders it
   * pin by pin.
   */
  readonly round?: number;
  /**
   * One line naming the specifics -- which round of how many, which pin, which
   * unregistered id. Not localized: it is for logs, tests and a future UI, and
   * the numeric records above stay the machine-readable part.
   */
  readonly detail?: string;
  readonly reason?: FailureReason;
}

export interface CheckOutcome {
  readonly passed: boolean;
  readonly failures: readonly CheckFailure[];
  readonly ticksUsed: number;
}
