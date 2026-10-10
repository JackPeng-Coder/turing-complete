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
 * levels 51 and 52 are assembly (`asm` -> `assemble`) -- and the player channel
 * grades with the reader the check declares. A reference filed under the other
 * one would not parse the way its level grades the player's buffer, so the pair
 * is stored whole and the batch test pins the two against each other.
 *
 * ONLY PROGRAMS THAT PASS THEIR LEVEL LIVE HERE -- the ones the three-star
 * targets were measured from. The plausible-wrong programs (the sabotaged
 * constants, the 5r draft of level 52) stay in the batch test that asserts
 * they fail, because those are that file's argument.
 *
 * The byte strings are the controller's pre-verified encodings (see
 * `.superpowers/sdd/2026-10-08-turing-complete-phase3/reference-programs.md`);
 * `test/levels/ch4-batch1.test.ts` re-derives them from `asm/isa.ts`'s table so
 * an encoding change cannot pass by moving fixture and assembler together.
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
};
