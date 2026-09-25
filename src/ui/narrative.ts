import type { LocalizedText } from '../levels/spec';

export interface Narrative {
  readonly before: LocalizedText;
  readonly after: LocalizedText;
}

/**
 * Original narrative shell. The source material describes an alien abduction
 * framing; this replica keeps the framing but writes its own character and
 * lines, and draws no characters at all.
 */
export const NARRATIVE: Readonly<Record<string, Narrative>> = {
  'ch1-01-crude-awakening': {
    before: {
      zh: '你在一间金属舱室里醒来。舷窗外面是一颗紫色的星球。墙上的扬声器说：「证明你值得留着。」',
      en: 'You wake in a metal cell. Through the port: a violet planet. The speaker on the wall says: prove you are worth keeping.',
    },
    after: {
      zh: '门开了。走廊尽头还有一扇门，上面刻着一个与非门的符号。',
      en: 'The cell opens. Down the corridor, another door, etched with the symbol of a NAND gate.',
    },
  },
  'ch1-02-nand-gate': {
    before: {
      zh: '「一切计算都从这一个门开始，」扬声器说，「记住它的真值表。」',
      en: 'Every computation starts with this one gate, says the speaker. Learn its truth table.',
    },
    after: {
      zh: '门滑开了。你听见远处有什么东西开始运转。',
      en: 'The door slides open. Somewhere far off, machinery begins to turn.',
    },
  },
  'ch1-03-not-gate': {
    before: {
      zh: '「一个输入，翻转它。你只有与非门——想想这意味着什么。」',
      en: 'One input. Invert it. You only have a NAND. Think about what that implies.',
    },
    after: { zh: '「很好。你开始理解『重复』的力量了。」', en: 'Good. You are starting to understand the power of repetition.' },
  },
  'ch1-04-and-gate': {
    before: { zh: '「翻转两次，就回到了原处。但中间那一步是必要的。」', en: 'Invert twice and you are back where you started, but the middle step is necessary.' },
    after: { zh: '第三扇门开了。空气里有臭氧的味道。', en: 'A third door opens. The air smells of ozone.' },
  },
  'ch1-05-or-gate': {
    before: { zh: '「德摩根留下了一条捷径。找到它，你就能少走很多弯路。」', en: 'De Morgan left a shortcut. Find it and you will save yourself a great deal of walking.' },
    after: { zh: '扬声器沉默了一会儿，然后说：「有趣。」', en: 'The speaker is quiet for a moment, then says: interesting.' },
  },
  'ch1-06-nor-gate': {
    before: { zh: '「或非门是另一条路的起点。你会发现它和与非门一样好用。」', en: 'NOR is the start of another road. You will find it as useful as NAND.' },
    after: { zh: '走廊的灯全亮了。你第一次看清了这艘飞船的全貌。', en: 'Every light in the corridor comes on. For the first time you see the ship whole.' },
  },
  'ch1-07-always-on': {
    before: { zh: '「恒定的高电平。最无聊的答案，也是最基础的答案。」', en: 'A constant high. The dullest answer, and the most fundamental one.' },
    after: { zh: '你意识到自己已经会用两种方式制造 1 和 0 了。', en: 'You realise you now have two ways to make a 1 and a 0.' },
  },
  'ch1-08-second-tick': {
    before: { zh: '「现在开始，时间也是电路的一部分。第几拍，比是不是更重要。」', en: 'From here on, time is part of the circuit. When matters more than whether.' },
    after: { zh: '你第一次让信号「等」了一下。', en: 'For the first time, you made a signal wait.' },
  },
  'ch1-09-xor-gate': {
    before: { zh: '「四个与非门。监督者认为这是衡量悟性的标准。」', en: 'Four NANDs. The Overseer considers this the measure of a mind.' },
    after: { zh: '你在墙上刻下了四道划痕。', en: 'You scratch four marks into the wall.' },
  },
  'ch1-10-bigger-or-gate': {
    before: { zh: '「三个输入。别慌，你已经会两个了。」', en: 'Three inputs. Do not panic; you already know how to do two.' },
    after: { zh: '级联的感觉像搭积木。', en: 'Cascading feels like stacking blocks.' },
  },
  'ch1-11-bigger-and-gate': {
    before: { zh: '「和或门一样简单，是吗？」', en: 'As simple as OR, is it not?' },
    after: { zh: '你点了点头，然后意识到没人看得见。', en: 'You nod, then remember nobody can see you.' },
  },
  'ch1-12-binary-racer': {
    before: { zh: '「最后一项测试。四个位，一个数。你必须一眼读出来。」', en: 'One final test. Four bits, one number. You must read it at a glance.' },
    after: {
      zh: '第一扇真正的门打开了。外面是一条约百米长的走廊，两侧全是空着的电路板插槽。',
      en: 'The first real door opens. Beyond it, a hundred-metre corridor lined with empty circuit slots.',
    },
  },
};

/**
 * The briefing shown before a level and the epilogue shown after it is passed.
 *
 * A level with no authored text yet -- every chapter after this one, for now --
 * gets generic text instead of an empty overlay, so the shell degrades to
 * "nothing to say" rather than to a blank screen the player cannot dismiss.
 */
export function narrativeFor(levelId: string): Narrative {
  return (
    NARRATIVE[levelId] ?? {
      before: { zh: '监督者没有留下说明。', en: 'The Overseer left no instructions.' },
      after: { zh: '电路安静地运转着。', en: 'The circuit runs quietly.' },
    }
  );
}
