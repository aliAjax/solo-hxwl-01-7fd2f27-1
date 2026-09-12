/**
 * 真实浏览器测试的环境路径（由 setup 脚本与测试运行器共享）。
 * 浏览器与其系统依赖库一律装在用户目录，无需 root。
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";

const require = createRequire(import.meta.url);

/** 解析 playwright-core 包根目录（browsers.json 不在 exports 白名单，需直接按路径读） */
function playwrightCoreRoot(): string {
  let entry: string;
  try {
    entry = require.resolve("playwright-core/package.json");
    return path.dirname(entry);
  } catch {
    /* 继续用入口路径回溯 */
  }
  entry = require.resolve("playwright-core");
  let dir = path.dirname(entry);
  for (let i = 0; i < 6; i++) {
    if (existsSync(path.join(dir, "browsers.json"))) return dir;
    dir = path.dirname(dir);
  }
  throw new Error("无法定位 playwright-core 包根目录");
}

/** Playwright 当前锁定的 chromium 构建版本，如 "1243" */
export function chromiumRevision(): string {
  const file = path.join(playwrightCoreRoot(), "browsers.json");
  const browsers = JSON.parse(readFileSync(file, "utf8")) as {
    browsers: { name: string; revision: string }[];
  };
  const c = browsers.browsers.find((b) => b.name === "chromium");
  if (!c) throw new Error("无法从 playwright-core/browsers.json 解析 chromium 版本");
  return c.revision;
}

export const PLAYWRIGHT_BROWSERS = path.join(os.homedir(), ".cache/ms-playwright");
export const browserDir = (rev = chromiumRevision()) =>
  path.join(PLAYWRIGHT_BROWSERS, `chromium-${rev}`);
export const chromiumExecutable = (rev = chromiumRevision()) =>
  path.join(browserDir(rev), "chrome-linux", "chrome");

/** 无 root 时解包的系统依赖库根目录与 LD_LIBRARY_PATH 清单文件 */
export const LOCAL_LIB_ROOT = path.join(os.homedir(), "chrome-libs", "root");
export const LDPATH_FILE = path.join(os.homedir(), "chrome-libs", ".ldpath");

/** 递归收集所有含 .so 的目录 */
export function collectSoDirs(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    let hasSo = false;
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.name.includes(".so")) hasSo = true;
    }
    if (hasSo) out.push(dir);
  };
  walk(root);
  return out;
}

/** 供测试启动浏览器时使用的 LD_LIBRARY_PATH（本地库优先，其后保留原值） */
export function ldLibraryPath(): string {
  let local = "";
  if (existsSync(LDPATH_FILE)) {
    local = readFileSync(LDPATH_FILE, "utf8").trim();
  } else if (existsSync(LOCAL_LIB_ROOT)) {
    local = collectSoDirs(LOCAL_LIB_ROOT).join(":");
  }
  return [local, process.env.LD_LIBRARY_PATH].filter(Boolean).join(":");
}

export function browserReady(): boolean {
  return existsSync(chromiumExecutable());
}
