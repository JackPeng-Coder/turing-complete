/**
 * Chapter 4's reference programs.
 *
 * WHY PROGRAMS AND NOT BOARDS. `ch3-references.ts` holds circuits because
 * chapter 3's levels ship none; chapter 4 turns that around and the board comes
 * from the level itself (`graphFromBoard(level.id, level.board)` in the batch
 * tests). Filing a board here too would be a second copy of the CPU, free to
 * drift from the one the levels ship -- and the drift would read as a PASS,
 * because the reference would keep grading green against a machine the levels
 * no longer hand the player. Ruling 1 says it in one line: the board does not
 * enter this fixture.
 *
 * WHY THE `format` FIELD TRAVELS WITH THE TEXT. The reader is the LEVEL's
 * choice -- level 50 is hand-written machine code (`bytes` -> `parseImage`),
 * levels 51 to 56 are assembly (`asm` -> `assemble`) -- and the player channel
 * grades with the reader the check declares. A reference filed under the other
 * one would not parse the way its level grades the player's buffer, so the pair
 * is stored whole and the batch test pins the two against each other. The
 * closed-loop levels (54 and 56) have no `format` field on the level at all:
 * both checkers read the player's buffer as assembly, which is what
 * `playerProgramFormat` answers for a `custom` channel, and their entries say
 * `'asm'` for that reason rather than by convention.
 *
 * ONLY PROGRAMS THAT PASS THEIR LEVEL LIVE HERE -- the ones the three-star
 * targets were measured from. The plausible-wrong programs (the sabotaged
 * constants, the 5r draft of level 52) stay in the batch test that asserts
 * they fail, because those are that file's argument.
 *
 * The byte strings are the controller's pre-verified encodings (see
 * `.superpowers/sdd/2026-10-08-turing-complete-phase3/reference-programs.md`);
 * `test/levels/ch4-batch1.test.ts` and `test/levels/ch4-batch2.test.ts` re-derive
 * them from `asm/isa.ts`'s table so an encoding change cannot pass by moving
 * fixture and assembler together.
 */
export const CH4_REFERENCES: Record<string, { program: string; format: 'asm' | 'bytes' }> = {
  /**
   * Level 50, out = (in + 5) & 0xff, one byte per line in binary.
   *
   * This is the level where the bytes ARE the point: the punchcard format has
   * no mnemonics, so each line carries its own opcode bits and the trailing
   * comment is the only translation. `B1 05 82 40 9F` in hex.
   */
  'ch4-50-punchcard-programming': {
    program: [
      '10110001    # move|inp|d1   r1 = in',
      '00000101    # loadi|5       r0 = 5',
      '10000010    # move|s0|d2    r2 = 5',
      '01000000    # add           r3 = in + 5',
      '10011111    # move|s3|out   out = r3',
    ].join('\n'),
    format: 'bytes',
  },

  /**
   * Level 51, out = (in + 3) & 0xff: the same five instructions as level 50,
   * spelled the way the assembler reads them. `B1 03 82 40 9F`.
   */
  'ch4-51-assembly-programming': {
    program: [
      'move|inp|d1    # r1 = in',
      'loadi|3        # r0 = 3',
      'move|s0|d2     # r2 = 3',
      'add            # r3 = in + 3',
      'move|s3|out    # out = r3',
    ].join('\n'),
    format: 'asm',
  },

  /**
   * Level 52, out = (6 * r) & 0xff -- r counted "three times twice".
   *
   * `add` always reads REG1 and REG2 and always writes REG3, so every doubling
   * or tripling has to move its result back into place first: r + r = 2r,
   * 2r + r = 3r, then 3r + 3r = 6r. The seventh instruction (`move|s3|d1`) is
   * the one the first draft forgot -- without it the program computes 5r, which
   * is the sabotage case the batch test runs. `B1 B2 40 99 40 9A 99 40 9F`.
   */
  'ch4-52-circumference': {
    program: [
      'move|inp|d1    # r1 = r',
      'move|inp|d2    # r2 = r',
      'add            # r3 = 2r',
      'move|s3|d1     # r1 = 2r',
      'add            # r3 = 3r   (2r + r)',
      'move|s3|d2     # r2 = 3r',
      'move|s3|d1     # r1 = 3r',
      'add            # r3 = 6r   (3r + 3r)',
      'move|s3|out    # out = r3',
    ].join('\n'),
    format: 'asm',
  },

  /**
   * Level 53, out = (n + (n-1) + ... + 1) & 0xff: the countdown loop.
   *
   * r5 is the counter and r4 the running total. `add` and `sub` always read
   * REG1/REG2 and write REG3, so both operands are moved into place before every
   * operation: the pass adds the counter to the total, then takes the counter
   * down by one, and leaves the loop through `jz` when the subtraction produced
   * zero. The two `loadi` before the jumps are the jump's TARGET (REG0) and the
   * condition is REG3 (the compendium's §6.4), which is why a jump is always two
   * instructions: one to say where, one to say when.
   *
   * For n = 10 the `out` instruction at address 14 is reached on tick 129, and
   * the default halt freezes the counter there so 55 stays on `out`. `B5 A9 A2
   * 40 9C A9 01 82 48 9D 0E C8 01 C0 A7`.
   */
  'ch4-53-conditional-jumps': {
    program: [
      'move|inp|d5    # r5 = n            (the counter)',
      'move|s5|d1     # <- loop: r1 = counter',
      'move|s4|d2     # r2 = total',
      'add            # r3 = counter + total',
      'move|s3|d4     # total = r3',
      'move|s5|d1     # r1 = counter',
      'loadi|1        # r0 = 1',
      'move|s0|d2     # r2 = 1',
      'sub            # r3 = counter - 1',
      'move|s3|d5     # counter = r3',
      'loadi|14       # r0 = 14           (the exit)',
      'jz             # counter == 0 -> 14',
      'loadi|1        # r0 = 1            (the loop head)',
      'j              # -> 1',
      'move|s4|out    # out = total',
    ].join('\n'),
    format: 'asm',
  },

  /**
   * Level 54, the code lock's search: try REG5, read `match`, count up until the
   * answer arrives.
   *
   * The checker READS `try` first and answers the byte it read in the same
   * exchange, so the publish (`move|s5|out` at address 2) is the loop head and
   * the match test (`move|inp|d1` at 3) is one instruction later. Fourteen
   * instructions per candidate put candidate 42 on tick 590.
   *
   * THE "FOUND" BRANCH IS NEVER TAKEN, and that is a fact about the MACHINE
   * rather than about the program: `out` is combinational and only published
   * while the instruction writing it is decoded, while `match` is sampled by
   * another instruction, so the byte this program reads is always 0. The level's
   * criterion is "the secret byte went out inside the budget", which is what the
   * search does on every pass. The two `loadi|16` / `j` at 16-17 are the
   * self-spin that branch would reach; they are kept so the fixture is the
   * controller's pre-verified text. `00 85 AF B1 00 82 40 10 D0 A9 01 82 40 9D
   * 02 C0 10 C0`.
   */
  'ch4-54-code-breaker': {
    program: [
      'loadi|0        # r0 = 0',
      'move|s0|d5     # r5 = 0            (the candidate)',
      'move|s5|out    # <- loop: try = candidate',
      'move|inp|d1    # r1 = match',
      'loadi|0        # r0 = 0',
      'move|s0|d2     # r2 = 0',
      'add            # r3 = match',
      'loadi|16       # r0 = 16',
      'jnz            # match != 0 -> 16',
      'move|s5|d1     # r1 = candidate',
      'loadi|1        # r0 = 1',
      'move|s0|d2     # r2 = 1',
      'add            # r3 = candidate + 1',
      'move|s3|d5     # candidate = r3',
      'loadi|2        # r0 = 2',
      'j              # -> 2',
      'loadi|16       # r0 = 16           (unreachable: see the note)',
      'j              # spin',
    ].join('\n'),
    format: 'asm',
  },

  /**
   * Level 55, out = in & 3: level 51's five instructions with `and` (01_010_000)
   * where `add` (01_000_000) was -- one bit of the instruction's operation field,
   * and the whole lesson of the level. The answer appears on tick 4, the index of
   * the `move|s3|out`. `B1 03 82 50 9F`.
   */
  'ch4-55-mod-4': {
    program: [
      'move|inp|d1    # r1 = in',
      'loadi|3        # r0 = 3',
      'move|s0|d2     # r2 = 3',
      'and            # r3 = in & 3',
      'move|s3|out    # out = r3',
    ].join('\n'),
    format: 'asm',
  },

  /**
   * Level 56, the wall follower: read the sensors, turn left when the left is
   * open, otherwise walk when ahead is open, otherwise turn right.
   *
   * EVERY LOOP-BACK GOES TO ADDRESS 0, and that is the correction T4b measured
   * on a real circuit: address 0 is the instruction that reads `inp`, so a pass
   * that re-entered at 1 would decide forever from the sensors of the first tick
   * (the brief's own "read the sensors on every pass" ruling). The three `loadi|0`
   * before those `j`s are that fix; addresses 17 and 18 are the right-turn
   * branch's unreachable filler, kept because the controller pre-verified this
   * text byte for byte. The masks are 2 (left wall) and 1 (ahead wall), and the
   * three destinations are 19 (turn left), 23 (forward) and the fall-through
   * right turn. `B4 A1 02 82 50 13 C8 A1 01 82 50 17 C8 03 87 00 C0 00 C0 02 87
   * 00 C0 01 87 00 C0`.
   */
  'ch4-56-the-maze': {
    program: [
      'move|inp|d4    # <- loop (address 0): r4 = sensors',
      'move|s4|d1     # r1 = sensors',
      'loadi|2        # r0 = 2',
      'move|s0|d2     # r2 = 2',
      'and            # r3 = sensors & 2   (the left wall)',
      'loadi|19       # r0 = 19',
      'jz             # left open -> 19 (turn left)',
      'move|s4|d1     # r1 = sensors',
      'loadi|1        # r0 = 1',
      'move|s0|d2     # r2 = 1',
      'and            # r3 = sensors & 1   (the wall ahead)',
      'loadi|23       # r0 = 23',
      'jz             # ahead open -> 23 (forward)',
      'loadi|3        # r0 = 3',
      'move|s0|out    # move = 3           (turn right)',
      'loadi|0        # r0 = 0',
      'j              # -> 0',
      'loadi|0        # unreachable filler',
      'j',
      'loadi|2        # r0 = 2',
      'move|s0|out    # move = 2           (turn left)',
      'loadi|0        # r0 = 0',
      'j              # -> 0',
      'loadi|1        # r0 = 1',
      'move|s0|out    # move = 1           (forward)',
      'loadi|0        # r0 = 0',
      'j              # -> 0',
    ].join('\n'),
    format: 'asm',
  },
};
