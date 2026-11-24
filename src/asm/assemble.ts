import { insertField } from '../core/fields';
import { maskOf } from '../core/signal';
import type { FieldRange, Isa, ModeDef } from './isa';

/**
 * AXIS 汇编文本 -> 指令字节。
 *
 *   `# ...`        注释，到行尾
 *   （空行）       跳过
 *   `label name`   把 `name` 定义为"下一条指令"的序号
 *   `loadi|5`      一个 ISA 助记符，然后是 `|` 分隔的字段
 *
 * 字段只按 `|` 切分——空白从不作为分隔符，只会被从字段两端 trim 掉——助记符
 * 区分大小写。有哪些 token、每个 token 编码成什么，全部来自 `isa` 参数，而绝不
 * 来自本文件。
 *
 * 刻意不做的事：它不知道任何指令做什么（见 `isa.ts`）；它不强制 `ram_prog` 的
 * 256 字节容量，那是机器的性质而不是编码的性质，所以 257 行的程序也是一条合法
 * 字节流；它也不拒绝空程序，因为"零条指令、零个错误"是诚实的回答，而"程序必须
 * 存在"是关卡检查器的 `missing-program` 失败，不是编译器的。
 */

/**
 * 源中的一个问题，定位在引发它的那一行。
 *
 * `line` 从 1 开始，统计源文本的每一行（含注释与空行）——UI 要指向文件，而不是
 * 指向"幸存下来"的行。`text` 是出错那一行的原文（含注释），调用方不必重新拆分
 * 源文件就能渲染它。`reason` 是一句可读的话，点出失败的那个 token。
 * `AssembleError` 是数据，永远不是 `Error` 实例：它们出现在
 * `AssembleResult.errors` 里，因此不存在"调用方忘了 catch"的抛出点。
 */
export interface AssembleError {
  readonly line: number;
  readonly text: string;
  readonly reason: string;
}

export interface AssembleResult {
  /**
   * 每个成功编码的指令产生一个 8 位字，按源顺序排列。
   *
   * 失败的行不贡献任何东西（见 `assemble`），所以当 `errors` 非空时，这个数组
   * 只是诊断列表，不是映像。
   */
  readonly bytes: number[];
  /** 标号名 -> 它指代的指令序号。 */
  readonly labels: Record<string, number>;
  readonly errors: AssembleError[];
}

/** 语法里除 ISA 助记符之外唯一的指令关键字。 */
const LABEL_DIRECTIVE = 'label';

/**
 * 只接受十进制，而且是严格十进制：`Number('')` 是 0、`Number('1e2')` 是 100，
 * 若用宽松的 `Number(token)`，`loadi|` 会悄悄装入 0、`loadi|1e2` 会装入一个
 * 没人要求的数。`0x10` 被同一条规则拒绝——本项目的语法没有数字前缀，而半套
 * 数字语法（比如只认十六进制不认二进制）比没有还糟。
 */
const DECIMAL = /^\d+$/;

/**
 * 标号名以字母或 `_` 开头，绝不以数字开头：`loadi|5` 是立即数，所以名为 `5`
 * 的标号无法与它区分，每个操作数 token 都会变得有歧义。
 */
const LABEL_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

interface MnemonicEntry {
  readonly mode: ModeDef;
  readonly select: number | null;
}

/** 值在解析时就已知的操作数（一个数字，或一个代码 token）。 */
interface LiteralOperand {
  readonly kind: 'literal';
  readonly field: FieldRange;
  /** 原样写下的 token，用于错误消息。 */
  readonly token: string;
  readonly value: number;
}

/** 指向标号的操作数，地址要等整份源扫描结束后才知道。 */
interface LabelOperand {
  readonly kind: 'label';
  readonly field: FieldRange;
  readonly name: string;
}

type PendingOperand = LiteralOperand | LabelOperand;

interface PendingInstruction {
  readonly line: number;
  readonly text: string;
  readonly mnemonic: string;
  readonly mode: ModeDef;
  readonly select: number | null;
  readonly operands: readonly PendingOperand[];
}

interface LabelDefinition {
  readonly line: number;
  readonly address: number;
}

function fieldOf(mode: ModeDef, id: string): FieldRange | undefined {
  return mode.fields.find((field) => field.id === id);
}

/** 位宽为 w 的位段能表示的最大值：2^w - 1。 */
function maxValue(field: FieldRange): number {
  return maskOf(field.width);
}

/** 把位段描述成人类可读的文字，如 `6-bit "imm" field (0-63)`，供错误消息使用。 */
function describeField(field: FieldRange): string {
  return `${field.width}-bit "${field.id}" field (0-${maxValue(field)})`;
}

/** `isa` 参数本身的缺陷——那是调用方的数据问题，不是玩家源文本的问题。 */
function isaDefect(mode: ModeDef, fieldId: string): string {
  return `the ISA declares no "${fieldId}" field for mode "${mode.id}"`;
}

/** 操作数数量的英文短语，让错误消息读起来像人话（no operands / 1 operand / N operands）。 */
function operandCount(count: number): string {
  if (count === 0) return 'no operands';
  return `${count} operand${count === 1 ? '' : 's'}`;
}

/** 组织"未知助记符"的消息，并尽量给出"你是不是想写"的提示（大小写敏感）。 */
function unknownMnemonic(token: string, byLowerCase: ReadonlyMap<string, string>): string {
  const spelling = byLowerCase.get(token.toLowerCase());
  return spelling === undefined
    ? `unknown mnemonic "${token}" (mnemonics are case-sensitive)`
    : `unknown mnemonic "${token}" (mnemonics are case-sensitive; did you mean "${spelling}"?)`;
}

/**
 * token -> 模式与选择子，另附一份小写拼写表，纯粹用于"你是不是想写"提示。
 *
 * 用 `isa` 参数而不是 `AXIS_ISA` 构建，因为 ISA 是参数：未来接入另一套 ISA
 * 时，只要再给一张表，就能复用这个编译器。
 */
function indexMnemonics(isa: Isa): {
  readonly byToken: ReadonlyMap<string, MnemonicEntry>;
  readonly byLowerCase: ReadonlyMap<string, string>;
} {
  const byToken = new Map<string, MnemonicEntry>();
  const byLowerCase = new Map<string, string>();
  for (const mode of isa.modes) {
    for (const [token, select] of Object.entries(mode.mnemonics)) {
      byToken.set(token, { mode, select });
      const lower = token.toLowerCase();
      if (!byLowerCase.has(lower)) byLowerCase.set(lower, token);
    }
  }
  return { byToken, byLowerCase };
}

/**
 * 编码一条指令——或者给出它无法编码的原因。
 *
 * 原因字符串就是整条消息；行号与源文本由调用方附上。所有范围检查都在这里完成、
 * 且在 `insertField` 之前完成，于是"字段装不下的值"会变成一条能告诉源的错误，
 * 而不是一个抛穿调用方的 `RangeError`。
 */
function encode(
  instruction: PendingInstruction,
  labels: ReadonlyMap<string, LabelDefinition>,
  isa: Isa,
): { readonly byte: number } | { readonly reason: string } {
  const modeField = isa.modeField;
  if (instruction.mode.opcode > maxValue(modeField)) {
    return {
      reason:
        `the ISA's opcode ${instruction.mode.opcode} for mode "${instruction.mode.id}"` +
        ` does not fit the ${describeField(modeField)}`,
    };
  }
  let word = insertField(0, modeField.offset, modeField.width, instruction.mode.opcode);

  const selectField = instruction.mode.selectField;
  if (instruction.select !== null && selectField !== undefined) {
    const field = fieldOf(instruction.mode, selectField);
    if (!field) return { reason: isaDefect(instruction.mode, selectField) };
    if (instruction.select > maxValue(field)) {
      return {
        reason:
          `the ISA's selector ${instruction.select} for "${instruction.mnemonic}"` +
          ` does not fit the ${describeField(field)}`,
      };
    }
    word = insertField(word, field.offset, field.width, instruction.select);
  }

  for (const operand of instruction.operands) {
    let value: number;
    if (operand.kind === 'label') {
      const definition = labels.get(operand.name);
      if (!definition) return { reason: `unknown label "${operand.name}"` };
      value = definition.address;
      if (value > maxValue(operand.field)) {
        return {
          reason:
            `label "${operand.name}" is at address ${value},` +
            ` which does not fit the ${describeField(operand.field)}`,
        };
      }
    } else {
      value = operand.value;
      if (value > maxValue(operand.field)) {
        return {
          reason: `value ${operand.token} does not fit the ${describeField(operand.field)}`,
        };
      }
    }
    word = insertField(word, operand.field.offset, operand.field.width, value);
  }
  return { byte: word };
}

/**
 * 把 `source` 按 `isa` 编译。
 *
 * 全函数（TOTAL）：每个问题——包括一个格式不对的 `isa` 参数——都通过 `errors`
 * 返回，不向调用方抛任何东西（`insertField` 遇到越界字段会抛；编码器提前检查了）。
 *
 * `line` 从 1 开始统计物理行，注释与空行都算，因为 UI 要指向文件。每行最多报
 * 一个错误：该行在第一个错误处放弃，所以 `move|s9|d9` 只报 `s9`，第二个笔误
 * 留给下一轮才暴露。两个错误都收集的话，同一行源文本会在列表里出现两次，每个
 * 笔误一次。
 *
 * 失败的行不贡献任何字节。标号命名的是"它后面那个指令槽位"，而只要一行被解析
 * 成指令，槽位就存在——包括操作数后来发现是未定义标号的那种行：它解析成功、但
 * 无法解析地址。因此 `bytes` 是"成功解析的槽位"的子集，二者仅在 `errors` 为空
 * 时步调一致。曾考虑给失败的行发一个占位字节，这个方案被否决：`loadi|64` 会
 * 变成一条真实的 `loadi|0`，躺在列表里紧挨着玩家的那一行；一条"看起来是玩家写
 * 的、却从未被写进去"的指令，比一个空洞更糟。所有调用方都拒绝带错误的映像，
 * 而那正是"槽位与字节"的差别唯一可能显现的场合。
 *
 * 纯函数（PURE）：没有 I/O、没有时钟、没有 `Math.random()`。相同的 `source` 与
 * `isa` 永远产生相同的结果，因为同一关两次运行得到不同映像，会让判定器的结论
 * 不可复现（第二阶段约束 12）。
 */
export function assemble(source: string, isa: Isa): AssembleResult {
  const errors: AssembleError[] = [];
  const { byToken, byLowerCase } = indexMnemonics(isa);
  const labels = new Map<string, LabelDefinition>();
  const pending: PendingInstruction[] = [];

  // `\r\n` 算一个换行。只按 '\n' 切分会给每行留下一个回车符，这个 CR 会混进每个
  // 字段 token、也会混进 `error.text`，于是 Windows 上写的程序会败在一个玩家看不见
  // 的字符上。
  const lines = source.split(/\r\n|\r|\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = index + 1;
    const text = lines[index] ?? '';
    const body = stripComment(text).trim();
    if (body === '') continue;

    // 这里会遇到两种行形状。标号的名字跟在关键字后面、以空白分隔（`label loop`，
    // 词判断是不是标号关键字，再做任何字段切分。
    const words = body.split(/\s+/);
    if (words[0] === LABEL_DIRECTIVE) {
      // 标号独占一行。`label loop add` 会被拒绝，而不是读成"先定义、再执行一条
      // 指令"：源语法没有行内标号，接受它就得再定一条"指令从哪里开始"的规则，
      // 还会静默吞掉名字后面的 token。
      if (words.length !== 2) {
        errors.push({
          line,
          text,
          reason: `"${LABEL_DIRECTIVE}" takes exactly one name, got ${words.length - 1}`,
        });
        continue;
      }
      const name = words[1] ?? '';
      if (!LABEL_NAME.test(name)) {
        errors.push({
          line,
          text,
          reason:
            `label name "${name}" must start with a letter or "_"` +
            ' and hold only letters, digits and "_"',
        });
        continue;
      }
      const prior = labels.get(name);
      if (prior) {
        errors.push({
          line,
          text,
          reason: `label "${name}" is already defined on line ${prior.line}`,
        });
        continue;
      }
      labels.set(name, { line, address: pending.length });
      continue;
    }

    const fields = body.split('|').map((field) => field.trim());
    const head = fields[0] ?? '';
    if (head === LABEL_DIRECTIVE) {
      // `label|loop`：两种行形状唯一交叉的地方；不专门处理的话，错误会变成
      // `unknown mnemonic label|loop`，其中没有任何东西是玩家写过的 token。
      errors.push({
        line,
        text,
        reason: `"${LABEL_DIRECTIVE}" takes its name after a space, not a "|"`,
      });
      continue;
    }

    const entry = byToken.get(head);
    if (!entry) {
      errors.push({ line, text, reason: unknownMnemonic(head, byLowerCase) });
      continue;
    }

    const slots = entry.mode.operands;
    if (fields.length - 1 !== slots.length) {
      errors.push({
        line,
        text,
        reason: `"${head}" takes ${operandCount(slots.length)}, got ${fields.length - 1}`,
      });
      continue;
    }

    const operands: PendingOperand[] = [];
    let failed = false;
    for (const [slot, operand] of slots.entries()) {
      const field = fieldOf(entry.mode, operand.field);
      if (!field) {
        errors.push({ line, text, reason: isaDefect(entry.mode, operand.field) });
        failed = true;
        break;
      }
      // 空字段是错误，而不是可以跳过的 token：`move|s0|` 是一条被截断的行，
      // 若把空的尾巴丢掉，它会悄悄变成玩家没有写过的样子。
      const token = fields[slot + 1] ?? '';
      if (token === '') {
        errors.push({ line, text, reason: `field ${slot + 2} is empty` });
        failed = true;
        break;
      }
      if (operand.kind === 'immediate') {
        if (DECIMAL.test(token)) {
          operands.push({ kind: 'literal', field, token, value: Number(token) });
        } else if (LABEL_NAME.test(token)) {
          operands.push({ kind: 'label', field, name: token });
        } else {
          errors.push({
            line,
            text,
            reason: `"${token}" is neither an immediate value (0-63) nor a label name`,
          });
          failed = true;
          break;
        }
      } else {
        const codes = operand.codes ?? {};
        const code = codes[token];
        if (code === undefined) {
          errors.push({
            line,
            text,
            reason:
              `unknown code "${token}" for the "${field.id}" field` +
              ` (expected ${Object.keys(codes).join(', ')})`,
          });
          failed = true;
          break;
        }
        if (code > maxValue(field)) {
          errors.push({
            line,
            text,
            reason:
              `the ISA's code ${code} for "${token}"` +
              ` does not fit the ${describeField(field)}`,
          });
          failed = true;
          break;
        }
        operands.push({ kind: 'literal', field, token, value: code });
      }
    }
    if (failed) continue;
    pending.push({ line, text, mnemonic: head, mode: entry.mode, select: entry.select, operands });
  }

  // 第二遍：标号地址要等整份文件读完才全部已知，而前向引用是再普通不过的写法。
  const bytes: number[] = [];
  for (const instruction of pending) {
    const encoded = encode(instruction, labels, isa);
    if ('reason' in encoded) {
      errors.push({ line: instruction.line, text: instruction.text, reason: encoded.reason });
      continue;
    }
    bytes.push(encoded.byte);
  }

  // 第二遍把标号解析错误追加在第一遍的解析错误之后，所以要把列表按文件顺序排回来。
  // `errors[0]` 是调用方最先展示的那条——`program` 检查器把它放进失败详情——而
  // "第一个错误"必须指文件里的第一个，而不是最先被发现的第一个。排序是稳定的，
  // 且两个错误不会共享同一行：第一遍放弃的行不会进入第二遍编码。
  errors.sort((a, b) => a.line - b.line);

  // 用 `Object.fromEntries` 而不是往 `{}` 上赋值：标识符语法允许一个叫 `__proto__`
  // 的标号，而把该键赋到普通对象上会设置它的原型而不是属性——标号会从
  // `Object.keys(labels)` 里消失，而 `labels[name]` 却还能答出点什么。
  return {
    bytes,
    labels: Object.fromEntries([...labels].map(([name, def]) => [name, def.address])),
    errors,
  };
}

/**
 * 第一个 `#` 之前的内容；这套语法没有字符串，也没有转义。
 *
 * 之所以导出，是因为 `image.ts`——编程章节的手写机器码格式——有意采用同一条
 * 注释规则：在两种写法之间切换的玩家不该被迫学两套。只有一份实现，才能让它们
 * 保持"同一条规则"，而不是"今天恰好一致的两条规则"。
 */
export function stripComment(text: string): string {
  const hash = text.indexOf('#');
  return hash === -1 ? text : text.slice(0, hash);
}
