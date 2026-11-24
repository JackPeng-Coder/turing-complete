import { stripComment } from './assemble';

/**
 * 手写机器码 -> 指令字节。
 *
 * 格式（格式约定）。每行一个字节，写成八个二进制数字，空白可以为眼睛
 * 自由分组：
 *
 *   `# ...`            注释，到行尾
 *   （空行）           跳过，只有空白的行同样跳过
 *   `10110001`         一个字节
 *   `1011 0001`        同一个字节，分组书写
 *
 * 空白永远只是分隔符，而且只算一个字符。任何空白字符都能分组——空格、制表符，
 * 以及这个字符类里的其他字符——因为两组之间落进哪个字符由玩家的编辑器决定，
 * 解析器不该在意（`1011\t0001` 与 `1011 0001` 是同一个字节）。组与组之间若出现
 * 连续两个或更多空白字符，则按"空字段"拒绝：那会留下一个里面什么都没有的组，
 * 若把它折叠掉，`1011  0001` 就会与 `1011 0001` 变成同一个字节，而输入前者的
 * 玩家永远学不到机器接受的是哪种拼写。首尾空白不算空字段——整行先 trim，所以
 * 给程序缩进仍然合法。
 *
 * 为什么在汇编器之外还要有它。第四章第一关讲的就是编码——哪两位选模式、其余
 * 六位各是什么意思——所以程序必须按机器读取它的方式写。汇编器会挡在玩家和这些
 * 位之间，而"直接面对位"恰恰是那一关要教的东西；于是玩家写字节，这里就是把
 * 字节读成程序映像的读取器。它刻意不是第二个汇编器：这里没有助记符，将来也
 * 不会有。
 *
 * 刻意不做的内容：它不知道任何字节的含义（见 `isa.ts`）；它不强制 `ram_prog`
 * 的 256 字节容量（那是机器的性质，不是格式的）；它也不拒绝空程序，因为"零
 * 字节、零错误"是诚实的回答，而"程序必须存在"是关卡检查器的 `missing-program`
 * 失败，不是解析器的。
 *
 * 错误是数据，不是异常，和 `assemble()` 完全一致：这段代码跑在画板编辑路径上，
 * 这里抛出的异常会在每次按键时从 `runChecks` 逃进 `grade()`。`ImageParseError`
 * 逐字段对应 `AssembleError`——从 1 起算的 `line`、原文 `text`、可读的
 * `reason`——于是能渲染其中一个的 UI 也能渲染另一个。
 */

/**
 * 映像中的一个问题，定位在引发它的那一行。
 *
 * `line` 从 1 开始，统计源文本的每一行（含注释与空行）——UI 要指向玩家写的
 * 文本，而不是指向"幸存下来"的那些行。`text` 是那一行的原文（含注释），
 * 调用方不必重新拆分源文件就能把它展示出来。
 */
export interface ImageParseError {
  readonly line: number;
  readonly text: string;
  readonly reason: string;
}

export interface ImageParseResult {
  /**
   * 每个解析成功的行产生一个字节，按源顺序排列。
   *
   * 失败的行不贡献任何字节，因此当 `errors` 非空时，这个数组是"诊断列表"而
   * 不是映像。所有调用方都会拒绝带错误的映像，而这正是"解析出的行"与"字节"
   * 的差别唯一可能显现的场合。
   */
  readonly bytes: readonly number[];
  readonly errors: readonly ImageParseError[];
}

/** 一个字节用几位二进制数字书写。单独命名，因为两条错误消息都要说出这个数。 */
const DIGITS_PER_BYTE = 8;

/**
 * 把 `source` 编译成映像。
 *
 * 全函数（TOTAL）：所有问题都通过 `errors` 返回，不向调用方抛异常。每行最多
 * 报一个错误——该行在第一个错误处放弃，于是"既有笔误又长度不对"的行不会在
 * 列表里出现两次——并且解析会继续，因为打错三行的玩家需要一次看到三处，而
 * 不是跑三遍每次只看一处。
 *
 * 失败的行不贡献任何字节。若改成写一个占位字节，它后面每条指令的地址都会错开
 * 一位，机器就会运行玩家从没写过的东西，而检查还报告"映像已加载"。
 */
export function parseImage(source: string): ImageParseResult {
  const bytes: number[] = [];
  const errors: ImageParseError[] = [];

  // `\r\n` 算一个换行，与汇编器遵循同一条规则：只按 '\n' 切分会给 Windows 写出的
  // 程序每一行留下一个回车符，下面每个数字检查都会因为玩家看不见的字符而失败。
  const lines = source.split(/\r\n|\r|\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = index + 1;
    const text = lines[index] ?? '';
    // 先去掉注释再 trim，于是"只有注释"或"只有空格"的行会被跳过而不是报错：给
    // 程序写注释是常态，一条注释变成错误会让这个格式在写了几行之后就不可用。
    // trim 也让首尾空白不构成空字段，所以给程序缩进仍然合法。
    const body = stripComment(text).trim();
    if (body === '') continue;

    // 空白用来给数字分组，本身没有含义，所以连续两个以上空白字符会留下一个空组。
    // 这里选择拒绝而不是折叠：接受它会让 `1011  0001` 与 `1011 0001` 成为同一个
    // 字节，而输入前者的玩家永远学不到机器接受的是哪种拼写。分隔符是"任意空白"
    // 而不是只认 U+0020，因为两组之间插入哪个字符不是玩家能决定的——若这里拒绝
    // 制表符，报出来的会是玩家看不见的字符。
    //
    // 先检查连续的空白再切分，而不是在切分结果里找空字段：单个分隔符不是空字段，
    // 所以 `1011\t0001` 必须解析成两个字段，而连续空白无论由哪些字符组成都必须
    // 被拒绝。首尾空白到不了这里——上面已经 trim 过——所以连续空白只可能出现在
    // 组与组之间。
    if (/\s{2,}/.test(body)) {
      errors.push({
        line,
        text,
        reason:
          'an empty field: whitespace separates groups of digits, and two' +
          ' whitespace characters in a row leave a group with nothing in it',
      });
      continue;
    }

    const fields = body.split(/\s/);
    const digits = fields.join('');
    const foreign = [...digits].find((digit) => digit !== '0' && digit !== '1');
    if (foreign !== undefined) {
      // 把字符名字报出来，因为这是玩家实际会犯的笔误：`2` 是唯一看起来像数字、
      // 却不在二进制字母表里的按键。
      errors.push({
        line,
        text,
        reason: `"${foreign}" is not a binary digit: a byte is written as eight 0s and 1s`,
      });
      continue;
    }
    if (digits.length !== DIGITS_PER_BYTE) {
      errors.push({
        line,
        text,
        reason: `a byte is ${DIGITS_PER_BYTE} binary digits, got ${digits.length}`,
      });
      continue;
    }
    bytes.push(Number.parseInt(digits, 2));
  }

  return { bytes, errors };
}
