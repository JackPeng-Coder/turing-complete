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

export type LevelCheck = TruthTableCheck | ScriptCheck | ConstraintCheck;

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

export interface CheckFailure {
  readonly check: LevelCheck['kind'];
  readonly inputs: Readonly<Record<string, number>>;
  readonly expected: Readonly<Record<string, number>>;
  readonly actual: Readonly<Record<string, number>>;
  readonly tick: number;
  readonly reason?:
    | 'mismatch'
    | 'unstable'
    | 'invalid'
    | 'missing-io'
    | 'missing-rows';
}

export interface CheckOutcome {
  readonly passed: boolean;
  readonly failures: readonly CheckFailure[];
  readonly ticksUsed: number;
}
