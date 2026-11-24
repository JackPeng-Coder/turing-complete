#!/usr/bin/env node
/**
 * 一条命令同时启动游戏与 Arduino 本地桥。
 *
 * 浏览器页面本身不能拉起本地进程，所以"随程序自动启动"只能由这个 Node
 * 启动器完成：桥用 `startBridge()` 在同一个进程里监听 127.0.0.1:8765，
 * 游戏则交给 Vite 的 dev server 或 preview server。关掉启动器（Ctrl+C 或
 * 关闭终端）时，桥和服务器一起退出。
 *
 *   node tools/launch.mjs dev     开发服务器（默认端口 5173）+ 桥
 *   node tools/launch.mjs start   构建 dist/，预览服务器（默认 4173）+ 桥
 *   --no-open                     不自动打开浏览器
 *
 * 如果 8765 上已经有一个健康的桥（例如另一个终端里的 `pnpm arduino`），
 * 启动器会复用它并且不负责关闭它；否则 8765 被其他程序占用会明确报错。
 */
import { spawn } from 'node:child_process';
import { get } from 'node:http';
import { startBridge } from './arduino-bridge.mjs';
import { build, createServer, preview } from 'vite';

const HOST = '127.0.0.1';
const BRIDGE_PORT = 8765;

const argv = process.argv.slice(2);
const mode = argv.includes('start') ? 'start' : 'dev';
const open = !argv.includes('--no-open');

/** 桥与 Vite 二选一，退出时只关自己启动的那一个。 */
let bridge = null;
let game = null;
let closing = false;

async function shutdown(code = 0) {
  if (closing) return;
  closing = true;
  if (game !== null) {
    try {
      await game.close();
    } catch {
      // 服务器可能已经自己停了；退出路径不再报错。
    }
  }
  if (bridge !== null) {
    try {
      await bridge.close();
    } catch {
      // 同上。
    }
  }
  process.exit(code);
}

process.on('SIGINT', () => void shutdown(0));
process.on('SIGTERM', () => void shutdown(0));

/**
 * 8765 上是否已经有一个桥？
 *
 * 带 `X-TC-Arduino` 与允许的 Origin 探测，避免把别的服务误认成桥。401/403
 * 说明桥在，只是需要令牌；这种情况也按"已存在"处理，否则启动会撞 EADDRINUSE。
 */
function probeBridge() {
  return new Promise((resolve) => {
    const req = get(
      {
        host: HOST,
        port: BRIDGE_PORT,
        path: '/health',
        headers: { 'X-TC-Arduino': '1', Origin: `http://${HOST}:5173` },
        // `/health` 会现场跑 arduino-cli（版本、core、串口），约 1–2 秒；
        // 1 秒的探测会把健康的桥误判成"没启动"。
        timeout: 10_000,
      },
      (response) => {
        let body = '';
        response.setEncoding('utf8');
        response.on('data', (chunk) => {
          body += chunk;
        });
        response.on('end', () => {
          if (response.statusCode === 401 || response.statusCode === 403) {
            resolve({ present: true, healthy: true, note: '需要令牌（TC_ARDUINO_TOKEN）' });
            return;
          }
          if (response.statusCode !== 200) {
            resolve({ present: false });
            return;
          }
          try {
            const health = JSON.parse(body);
            if (typeof health?.ok !== 'boolean') {
              resolve({ present: false });
              return;
            }
            resolve({
              present: true,
              healthy: health.ok === true,
              note:
                health.ok === true
                  ? '健康'
                  : (health.error ?? '桥在运行，但 arduino-cli 或 AVR core 未就绪'),
            });
          } catch {
            resolve({ present: false });
          }
        });
      },
    );
    req.on('timeout', () => {
      req.destroy();
      resolve({ present: false });
    });
    req.on('error', () => resolve({ present: false }));
  });
}

async function ensureBridge() {
  const existing = await probeBridge();
  if (existing.present) {
    console.log(`[bridge] 复用 ${HOST}:${BRIDGE_PORT} 上已有的桥（${existing.note}）`);
    return;
  }
  try {
    bridge = await startBridge({ host: HOST, port: BRIDGE_PORT });
  } catch (error) {
    if (error?.code === 'EADDRINUSE') {
      console.warn(
        `[bridge] ${HOST}:${BRIDGE_PORT} 被其他程序占用；游戏继续启动，但面板无法编译 / 烧录。`,
      );
      return;
    }
    throw error;
  }
  console.log(`[bridge] 已启动：${bridge.url}`);
  if (bridge.tokenRequired) {
    console.log('[bridge] 已设置 TC_ARDUINO_TOKEN：请在面板的「令牌」里填同一个值');
  }
}

function openBrowser(url) {
  if (!open || !url) return;
  const [command, args] =
    process.platform === 'win32'
      ? ['cmd.exe', ['/c', 'start', '', url]]
      : process.platform === 'darwin'
        ? ['open', [url]]
        : ['xdg-open', [url]];
  spawn(command, args, { detached: true, stdio: 'ignore' }).unref();
}

function localUrl(server) {
  const urls = server.resolvedUrls;
  return urls === null ? null : (urls.local[0] ?? null);
}

async function startGame() {
  if (mode === 'start') {
    console.log('[vite] 构建 dist/ …');
    await build();
    game = await preview({ preview: { host: HOST, port: 4173 } });
  } else {
    game = await createServer({ server: { host: HOST } });
    await game.listen();
  }
  game.printUrls();
  const url = localUrl(game);
  if (url !== null) {
    console.log(`[game] ${url}`);
    openBrowser(url);
  }
}

try {
  await ensureBridge();
  await startGame();
  // 服务器本身会保持事件循环；这个 await 只是让错误路径保持清晰。
  await new Promise(() => {});
} catch (error) {
  console.error(`[launch] 启动失败：${error?.message ?? error}`);
  await shutdown(1);
}
