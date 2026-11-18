/**
 * 工作台自己的尺寸记录：每个侧边栏有多宽、底部面板有多高、三个停靠区各自
 * 是否折叠。
 *
 * 与别的一切分键保存。`tc.progress.v1` 是战役进度，`tc.sandbox.v1` 是一个
 * 电路，`tc.agent.v1` 是助手住的地方；布局都不属于它们——它是关于"仪器"的
 * 偏好，不是关于"作品"的事实——把它塞进任何一个键，都会让该键的每次迁移
 * 顺带背上布局。
 *
 * 这里不会抛出任何异常。单元测试里没有 localStorage，隐私窗口也可能拒绝
 * 写入；布局读失败有一个显然的答案（默认值），所以失败模式是"停靠区回到
 * 初始位置"，而不是画面坏掉。数值在读出时会夹紧到合法区间，写入侧则由拖拽
 * 按 `LAYOUT_LIMITS` 限幅（见 `main.ts`）：来自存储的数字是不可信输入，
 * `primaryW` 为 4000 会让画板一点宽度都不剩。
 */
export const LAYOUT_KEY = 'tc.layout.v1';

export interface Layout {
  /** 主侧边栏的宽度，单位是 CSS 像素。 */
  readonly primaryW: number;
  /** 次侧边栏的宽度，单位是 CSS 像素。 */
  readonly secondaryW: number;
  /** 底部面板中视图区域的高度，单位是 CSS 像素。 */
  readonly panelH: number;
  /** 主侧边栏（元件托盘那一侧）是否折叠。 */
  readonly primaryCollapsed: boolean;
  /** 次侧边栏（助手那一侧）是否折叠。 */
  readonly secondaryCollapsed: boolean;
  /** 底部面板（编程或测量面板）是否折叠。 */
  readonly panelCollapsed: boolean;
}

/** 全新启动时停靠区的位置，也是损坏载荷回退到的值。 */
export const LAYOUT_DEFAULT: Layout = {
  primaryW: 252,
  secondaryW: 348,
  panelH: 300,
  primaryCollapsed: false,
  // 助手默认收起：画板才是文档，第一次到访的人不该为一个还没配置过的
  // 功能付出空间代价。
  secondaryCollapsed: true,
  panelCollapsed: false,
};

/** 一次拖拽允许请求的尺寸范围，单位是 CSS 像素。 */
export const LAYOUT_LIMITS = {
  primaryW: { min: 180, max: 420 },
  secondaryW: { min: 260, max: 620 },
  panelH: { min: 140, max: 600 },
} as const;

/** 先四舍五入再夹到 [min, max]：拖拽给出的是小数，而布局要的是整数像素。 */
function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(value)));
}

/**
 * 把不可信的载荷读回成 `Layout`，缺失的字段用默认值补齐。
 *
 * 版本号不是 1 时整体回退到默认值，而不是逐字段猜：版本号存在的意义就是让
 * 旧格式、新格式可以被识别，猜出来的混合布局比干净的默认布局更不可预期。
 * 数值字段还要求有限（`Number.isFinite`），因为 `NaN` 能通过 `typeof` 检查，
 * 却会让 `Math.min` / `Math.max` 一路把 `NaN` 传下去，最终布局静默失效。
 */
export function normalizeLayout(raw: unknown): Layout {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return LAYOUT_DEFAULT;
  const record = raw as Record<string, unknown>;
  if (record.version !== 1) return LAYOUT_DEFAULT;
  const number = (value: unknown, fallback: number, min: number, max: number): number =>
    typeof value === 'number' && Number.isFinite(value) ? clamp(value, min, max) : fallback;
  const flag = (value: unknown, fallback: boolean): boolean =>
    typeof value === 'boolean' ? value : fallback;
  return {
    primaryW: number(record.primaryW, LAYOUT_DEFAULT.primaryW, LAYOUT_LIMITS.primaryW.min, LAYOUT_LIMITS.primaryW.max),
    secondaryW: number(
      record.secondaryW,
      LAYOUT_DEFAULT.secondaryW,
      LAYOUT_LIMITS.secondaryW.min,
      LAYOUT_LIMITS.secondaryW.max,
    ),
    panelH: number(record.panelH, LAYOUT_DEFAULT.panelH, LAYOUT_LIMITS.panelH.min, LAYOUT_LIMITS.panelH.max),
    primaryCollapsed: flag(record.primaryCollapsed, LAYOUT_DEFAULT.primaryCollapsed),
    secondaryCollapsed: flag(record.secondaryCollapsed, LAYOUT_DEFAULT.secondaryCollapsed),
    panelCollapsed: flag(record.panelCollapsed, LAYOUT_DEFAULT.panelCollapsed),
  };
}

/** 尽力加载；存储缺失、内容损坏、读取失败都读成默认布局。 */
export function loadLayout(): Layout {
  try {
    const raw = globalThis.localStorage?.getItem(LAYOUT_KEY);
    if (!raw) return LAYOUT_DEFAULT;
    return normalizeLayout(JSON.parse(raw));
  } catch {
    return LAYOUT_DEFAULT;
  }
}

/**
 * 尽力保存；没有存储时布局只在本次会话内有效。
 *
 * 写入的是带 `version: 1` 的对象：读出时靠它区分"本格式"与"别的什么"，
 * 版本字段不单独存一份、也不省略，避免布局对象与版本号两处各说各话。
 */
export function saveLayout(layout: Layout): void {
  try {
    globalThis.localStorage?.setItem(LAYOUT_KEY, JSON.stringify({ version: 1, ...layout }));
  } catch {
    /* 存储不可用（隐私模式、测试）：布局只保留在内存里 */
  }
}
