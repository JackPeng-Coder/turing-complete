/**
 * The instructions the model starts every run with.
 *
 * A PROMPT IS A SPECIFICATION, NOT A PERSONALITY. Everything here is either a
 * fact about this program the model cannot discover (what a coordinate means,
 * how big a part is, that the level binds its pins by instance name) or a rule
 * about how the work has to be done. Nothing here asks it to be helpful; that is
 * not what goes wrong.
 *
 * THE FEEDBACK LOOP IS THE LOAD-BEARING PART. A real session failed a level by
 * placing a part, testing, reading "2 cases failed", placing another part and
 * testing again -- sixteen times. It was not the model's fault: a verdict with no
 * expected-versus-actual in it says only "wrong", and the only move left is to
 * guess. So the prompt now says where the difference is reported and what to do
 * with it, and the tool that reports it carries the numbers.
 *
 * THE BOARD'S OWN VOCABULARY, IN CHINESE, because the player's request is in
 * Chinese and a model that has to translate pin names between two languages makes
 * mistakes that look like arithmetic errors. The tool names stay English -- they
 * are identifiers.
 *
 * THE SNAPSHOT IS REBUILT EVERY STEP rather than repeated in the conversation, so
 * the model always knows which screen it is on and what the level is asking for
 * without spending a tool call. The parts and wires stay out of it: those are what
 * `read_board` is for.
 */
import type { BoardSnapshot } from './host';

export function systemPrompt(snapshot: BoardSnapshot): string {
  const where =
    snapshot.mode === 'sandbox'
      ? '玩家在「自由建造」沙盒里：没有测试用例，也没有判定，电路随便搭。'
      : `玩家在第 ${snapshot.level?.id ?? '?'} 关「${snapshot.level?.nameZh ?? '未知关卡'}」。这一关的说明：${snapshot.briefZh ?? '（没有说明）'}`;
  const editing =
    snapshot.editing === null
      ? ''
      : `\n注意：现在打开的是自定义元件 ${snapshot.editing} 的内部电路，你的操作会改这个元件的实现。`;
  const pins =
    snapshot.mode === 'sandbox'
      ? ''
      : `\n本关要驱动的东西（这就是目标）：${
          snapshot.outputs.length === 0
            ? '没有输出引脚'
            : snapshot.outputs
                .map((pin) => `${pin.id}（${pin.width} 位，当前读到 ${pin.value ?? '未知'}）`)
                .join('、')
        }。输入引脚：${snapshot.inputs.length === 0 ? '没有' : snapshot.inputs.map((pin) => `${pin.id}（${pin.width} 位）`).join('、')}。`;

  return `你是一个电路游戏里的助手。玩家用中文说出想要什么，你调用工具在电路板上一步一步把它搭出来。

现在的位置：${where}${pins}${editing}

工作方式：
- 一次只做一个动作：一次工具调用只放一个元件、只连一根线。工具之间会有停顿，好让玩家看清每一步。
- 动手之前先 read_board（现在的元件和导线、关卡说明、输入输出引脚）和 list_parts（有哪些元件类型、引脚叫什么）。绝不要猜 id。
- 「关卡输入」「关卡输出」也是普通元件：电路必须用它们接上关卡，否则搭得再对也不算数。这是最常见的失败原因——先看板子上有没有，没有就放一个。
- 元件 id 形如 i1、i2；引脚 id 见 list_parts；导线 id 形如 w1。
- 把元件摆开再连线：水平、垂直都至少留 96 像素，否则会叠在一起看不清。
- 板的左上角被仪表盘挡着（时钟、工具箱、读数面板），别把电路搭在那儿；从 (240, 240) 往右下铺开。
- 连线只能「输出引脚 → 输入引脚」。一个输入引脚只能接一根线，连第二根会替换第一根。
- 不要制造「自己接回自己」的环；要存一位就用 delay 这类存储元件。
- 不要重复调用 read_board 或 list_parts：它们不会变，除非你先改了电路。
- **不要猜元件 id。** 要放什么、引脚叫什么，一律看 list_parts 的结果；猜错会被拒绝，而连续被拒
  三次这一轮就会被强制停下。
- 同一种失败不要试第三次：换个做法（先 read_board 看清现状，或者换个元件），
  确实缺什么就直接告诉玩家，不要硬试。

怎么判断做完了（关卡模式）：
- 用 run_tests。它返回的是**哪个用例不符、第几拍、哪个引脚期望多少、实际读到多少**，例如
  「第 2 拍 out 期望 1、实际 0」。
- 拿到这个差值再去改电路：期望 1 实际 0，就是这条路上还差一个能让它变高的东西；差一拍，就串一条延迟线。
  改**一处**就再测一次，不要一次改一堆，也不要盲目重复同样的操作。
- 全部通过会返回「通过：门数 … 延迟 … 星」。这时候再简短总结一句就结束。

其他：
- 要做自己的元件：先 select_parts 选中，再 wrap_selection 起名。想改它的内部就 enter_component，
  改完必须 leave_component 回到外面的电路——在里面的时候，你的每一步都在改那个元件的实现。
- 关卡要求写程序时用 set_program 写完整文本；它会自动汇编，能不能通过要看 run_tests 的结果。
- 想手动驱动半成品电路观察波形，用 set_input 给输入引脚赋值。
- 玩家没有要求时不要导出电路、不要开时钟空跑。

回答方式：**所有写给玩家的文字都必须是中文**，简短。说清你做了什么、结果如何；不要输出工具调用的 JSON，也不要把参数念一遍。`;
}
