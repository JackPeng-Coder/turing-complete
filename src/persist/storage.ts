import { emptyProgress } from '../app/progress';
import type { LevelRecord, Progress } from '../app/progress';
import { libraryFromRecord, type BlueprintLibrary } from '../levels/blueprints';
import { currentIdOf } from '../levels/id-map';

/**
 * 进度记录的持久化。
 *
 * localStorage 并不总是可用——单元测试跑在没有 DOM 的 node 里，浏览器的隐私
 * 模式也可能拒绝写入。因此这里任何代码都不得因此抛出异常：权威的 `Progress`
 * 由调用方保存在内存中，存储只是尽力而为；存储不可用时退化为"只在本次会话
 * 有效"的存档，而不是让游戏坏掉。
 *
 * 本模块里唯一会抛异常的是 `migrate`（以及直接暴露给导入功能的
 * `importProgress`）：它们面对的是"这段内容是不是一份能用的存档"这个问题，
 * 而答案是"不是"时，调用方需要知道原因。所有自动发生的读写都包在 try 里。
 */
export const STORAGE_KEY = 'tc.progress.v1';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * 校验并修复一份不可信的进度载荷。
 *
 * 返回一个全新的对象，只保留 `Progress` 声明的那几个字段：`version`、
 * `levels`、`programs`，以及经 `libraryFromRecord` 规范化读入的
 * `blueprints`。旧版本构建写出的存档可能带着已经失去意义的字段（例如曾存过的
 * `unlockedComponents` 集合，现在改为由关卡奖励推导），原样拷贝会把这些字段
 * 重新复活。缺少 `programs`——编程章节之前所有存档的形状——会被读成空程序表，
 * 缺少 `blueprints` 则读成空元件库，都不是损坏的存档。
 *
 * 关卡键会经过 `levels/id-map.ts` 翻译。2.x 对齐改掉了 37 个关卡的 id、删除了
 * 3 个关卡，而存档以 id 为键——不翻译的话，玩家的星星会悄悄挂到已经不存在的
 * 关卡上。已经是当前 id 的键原样通过，指向已退休关卡的键被丢弃：没有关卡
 * 可供它描述了。
 *
 * 程序键也做同样处理，原因和规则都相同：程序以"为哪个关卡写的"为键，所以
 * 退休关卡的程序会被丢弃，而不是留着让它被恢复到继承其位置的关卡上。只有
 * 字符串值能存活——关卡 id 与程序文本一样都是玩家数据，手改过的存档不能把
 * 数字塞到 IDE 即将调用 `.split()` 的位置。
 *
 * 非对象载荷、或版本号不是 1 的载荷会抛出异常；`loadProgress` 是自动读取的
 * 唯一入口，它捕获后把这种情况当作全新存档。
 */
export function migrate(raw: unknown): Progress {
  if (!isRecord(raw)) {
    throw new Error('not a progress payload');
  }
  if (raw.version !== 1) {
    throw new Error(`unsupported progress version: ${String(raw.version)}`);
  }
  const levels: Record<string, LevelRecord> = {};
  if (isRecord(raw.levels)) {
    for (const [id, record] of Object.entries(raw.levels)) {
      const current = currentIdOf(id);
      if (current !== null) levels[current] = record as LevelRecord;
    }
  }
  const programs: Record<string, string> = {};
  if (isRecord(raw.programs)) {
    for (const [id, text] of Object.entries(raw.programs)) {
      const current = currentIdOf(id);
      if (current !== null && typeof text === 'string') programs[current] = text;
    }
  }
  // 自定义元件以自己的 id 为键，而不是以关卡为键，所以不需要 id 翻译——
  // 但需要通过唯一的规范化入口读入，因为元件库是一张图，而来自
  // localStorage 的图是不可信输入。元件功能出现之前的存档没有 `blueprints`
  // 字段，会读成空库，而不是损坏的存档。
  const blueprints: BlueprintLibrary = libraryFromRecord(raw.blueprints);
  return { version: 1, levels, programs, blueprints };
}

/**
 * 尽力加载；存储不存在或内容损坏都读成新存档。
 *
 * `globalThis.localStorage?.` 的可选链同时覆盖两种情况：node 测试里根本没有
 * 这个全局对象，隐私模式下 getItem 本身可能抛出 SecurityError。
 */
export function loadProgress(): Progress {
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
    if (!raw) return emptyProgress();
    return migrate(JSON.parse(raw));
  } catch {
    return emptyProgress();
  }
}

/**
 * 尽力保存；没有存储时进度只留在内存里。
 *
 * 这里不把 `Progress` 拆成多个键：一次 `setItem` 写一个 JSON 字符串，要么
 * 整份是新进度，要么整份还是旧进度，不会出现"星星写进去了、程序没写进去"
 * 的半份存档。
 */
export function saveProgress(progress: Progress): void {
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(progress));
  } catch {
    /* 存储不可用（隐私模式、测试）：进度只保留在内存里 */
  }
}

/** 带缩进导出，导出的存档可读、可手工 diff。 */
export function exportProgress(progress: Progress): string {
  return JSON.stringify(progress, null, 2);
}

/**
 * 从 JSON 文本导入进度。
 *
 * JSON 语法错误、以及任何 `migrate` 拒绝的载荷都会抛出异常；导入入口是玩家
 * 明确发起的动作，所以把失败原因交给调用方显示出来，比静默换成新存档更诚实。
 */
export function importProgress(json: string): Progress {
  return migrate(JSON.parse(json));
}
