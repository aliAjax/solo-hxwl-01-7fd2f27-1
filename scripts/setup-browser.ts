/**
 * 一键准备真实浏览器测试环境（无需 root）：
 *   1. 从 playwright-core 解析 chromium 版本，下载完整 Chromium 解压到 ~/.cache/ms-playwright
 *      （官方源失败时自动回退国内镜像）；
 *   2. 用 ldd 检测缺失的系统库，按 Debian bookworm 软件包索引下载对应 arm64/amd64
 *      .deb 并解包到 ~/chrome-libs，循环到依赖闭环；
 *   3. 写出 ~/chrome-libs/.ldpath 供测试运行器设置 LD_LIBRARY_PATH。
 *
 * 幂等：已就绪的步骤自动跳过。可用环境变量：
 *   PLAYWRIGHT_DOWNLOAD_HOST（多个源用逗号分隔）/ DEBIAN_MIRROR / PLAYWRIGHT_CHROME_REV
 *
 * 运行：npx tsx scripts/setup-browser.ts
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync, readdirSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import os from "node:os";
import path from "node:path";
import {
  PLAYWRIGHT_BROWSERS,
  LOCAL_LIB_ROOT,
  LDPATH_FILE,
  browserDir,
  browserReady,
  chromiumExecutable,
  chromiumRevision,
  collectSoDirs,
} from "../test/browser-env";

const log = (msg: string) => console.log(`[setup-browser] ${msg}`);
const DPKG_ARCH = process.arch === "arm64" ? "arm64" : "amd64";
const CHROME_ZIP = process.arch === "arm64" ? "chromium-linux-arm64.zip" : "chromium-linux.zip";
const DEB_DIR = path.join(os.homedir(), "chrome-libs", "debs");
const INDEX_DIR = path.join(os.homedir(), "chrome-libs", "index");
const DEB_MIRROR = process.env.DEBIAN_MIRROR || "https://deb.debian.org/debian";

// ldd 报缺失时的 soname → Debian 包名（Chromium 在最小化 Debian 上的常见依赖）
const CURATED_SONAME_PKG: Record<string, string> = {
  "libnspr4.so": "libnspr4",
  "libnss3.so": "libnss3",
  "libnssutil3.so": "libnss3",
  "libsmime3.so": "libnss3",
  "libatk-1.0.so.0": "libatk1.0-0",
  "libatk-bridge-2.0.so.0": "libatk-bridge2.0-0",
  "libatspi.so.0": "libatspi2.0-0",
  "libcups.so.2": "libcups2",
  "libdbus-1.so.3": "libdbus-1-3",
  "libgbm.so.1": "libgbm1",
  "libxkbcommon.so.0": "libxkbcommon0",
  "libXcomposite.so.1": "libxcomposite1",
  "libXdamage.so.1": "libxdamage1",
  "libXfixes.so.3": "libxfixes3",
  "libXrandr.so.2": "libxrandr2",
  "libasound.so.2": "libasound2",
  "libXi.so.6": "libxi6",
  "libavahi-client.so.3": "libavahi-client3",
  "libavahi-common.so.3": "libavahi-common3",
  "libdrm.so.2": "libdrm2",
  "libwayland-server.so.0": "libwayland-server0",
};

function curlBuffer(url: string): Buffer {
  return execFileSync(
    "curl",
    ["-fsSL", "--retry", "3", "--connect-timeout", "20", url],
    { maxBuffer: 1024 * 1024 * 400 },
  );
}

function downloadWithFallback(urls: string[], dest?: string): Buffer {
  let lastErr: unknown;
  for (const url of urls) {
    try {
      log(`下载 ${url}`);
      const buf = curlBuffer(url);
      if (dest) writeFileSync(dest, buf);
      return buf;
    } catch (e) {
      lastErr = e;
      log(`  该源失败，尝试下一源`);
    }
  }
  throw new Error(`所有下载源均失败：${urls.join(" , ")}\n${String((lastErr as Error)?.message ?? lastErr)}`);
}

// ---------- 第一步：Chromium ----------
function installChromium(rev: string): void {
  if (browserReady()) {
    log(`Chromium ${rev} 已存在，跳过下载`);
    return;
  }
  const dir = browserDir(rev);
  mkdirSync(dir, { recursive: true });
  mkdirSync(INDEX_DIR, { recursive: true });
  const zipPath = path.join(INDEX_DIR, CHROME_ZIP);

  const hosts = (process.env.PLAYWRIGHT_DOWNLOAD_HOST || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const mirrors = [
    ...hosts,
    "https://cdn.npmmirror.com/binaries/playwright",
    "https://registry.npmmirror.com/-/binary/playwright",
    "https://cdn.playwright.dev/dbazure/download/playwright",
  ];
  const urls = mirrors.map((h) => `${h.replace(/\/$/, "")}/builds/chromium/${rev}/${CHROME_ZIP}`);
  downloadWithFallback(urls, zipPath);

  log("解压 Chromium …");
  execFileSync("unzip", ["-q", "-o", zipPath, "-d", dir]);
  writeFileSync(path.join(dir, "INSTALLATION_COMPLETE"), "");
  rmSync(zipPath, { force: true });
  log(`Chromium 安装到 ${dir}`);
}

// ---------- 第二步：系统依赖库 ----------
function readPackagesIndex(): Map<string, string> {
  const idxPath = path.join(INDEX_DIR, `Packages-${DPKG_ARCH}.gz`);
  if (!existsSync(idxPath)) {
    mkdirSync(INDEX_DIR, { recursive: true });
    downloadWithFallback(
      [
        `${DEB_MIRROR}/dists/bookworm/main/binary-${DPKG_ARCH}/Packages.gz`,
        `https://mirrors.tuna.tsinghua.edu.cn/debian/dists/bookworm/main/binary-${DPKG_ARCH}/Packages.gz`,
      ],
      idxPath,
    );
  }
  const text = gunzipSync(readFileSync(idxPath)).toString("utf8");
  const map = new Map<string, string>();
  for (const block of text.split("\n\n")) {
    const name = /^Package: (.+)$/m.exec(block)?.[1];
    const file = /^Filename: (.+)$/m.exec(block)?.[1];
    if (name && file) map.set(name, file);
  }
  return map;
}

function missingLibs(libPath: string): string[] {
  let out = "";
  try {
    out = execFileSync("ldd", [chromiumExecutable()], {
      env: { ...process.env, LD_LIBRARY_PATH: libPath },
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (e) {
    out = `${(e as { stdout?: string }).stdout ?? ""}${(e as { stderr?: string }).stderr ?? ""}`;
  }
  return [...new Set([...out.matchAll(/^\s*([\w.+-]+\.so[\w.]*)\s+=>\s*not found/gm)].map((m) => m[1]))];
}

function installDebs(packageNames: string[], pkgIndex: Map<string, string>): void {
  mkdirSync(DEB_DIR, { recursive: true });
  mkdirSync(LOCAL_LIB_ROOT, { recursive: true });
  for (const pkg of packageNames) {
    const rel = pkgIndex.get(pkg);
    if (!rel) throw new Error(`Debian 索引中找不到包：${pkg}（${DPKG_ARCH}）`);
    const file = path.join(DEB_DIR, path.basename(rel));
    if (!existsSync(file)) {
      downloadWithFallback(
        [`${DEB_MIRROR}/${rel}`, `https://mirrors.tuna.tsinghua.edu.cn/debian/${rel}`],
        file,
      );
      log(`  解包 ${pkg}`);
      execFileSync("dpkg-deb", ["-x", file, LOCAL_LIB_ROOT]);
    }
  }
}

function installSystemLibs(): void {
  let libPath = collectSoDirs(LOCAL_LIB_ROOT).join(":");
  let missing = missingLibs(libPath);
  if (missing.length === 0) {
    log("系统依赖库齐全，无需补装");
    mkdirSync(path.dirname(LDPATH_FILE), { recursive: true });
    writeFileSync(LDPATH_FILE, libPath || "");
    return;
  }
  log(`首次检测到缺失库：${missing.join(", ")}`);
  const pkgIndex = readPackagesIndex();
  const installed = new Set<string>();

  for (let round = 1; round <= 6 && missing.length > 0; round++) {
    const wanted: string[] = [];
    for (const soname of missing) {
      const pkg = CURATED_SONAME_PKG[soname];
      if (!pkg) {
        throw new Error(
          `缺少未知依赖 ${soname}：请在 scripts/setup-browser.ts 的 CURATED_SONAME_PKG 中补充其 Debian 包名`,
        );
      }
      if (!installed.has(pkg)) wanted.push(pkg);
    }
    if (wanted.length === 0) break;
    log(`第 ${round} 轮补装：${wanted.join(", ")}`);
    installDebs(wanted, pkgIndex);
    wanted.forEach((p) => installed.add(p));
    libPath = collectSoDirs(LOCAL_LIB_ROOT).join(":");
    missing = missingLibs(libPath);
  }

  if (missing.length > 0) throw new Error(`依赖闭环失败，仍缺失：${missing.join(", ")}`);
  mkdirSync(path.dirname(LDPATH_FILE), { recursive: true });
  writeFileSync(LDPATH_FILE, libPath || "");
  log(`系统依赖就绪，LD 路径写入 ${LDPATH_FILE}`);
}

function main(): void {
  mkdirSync(PLAYWRIGHT_BROWSERS, { recursive: true });
  const rev = process.env.PLAYWRIGHT_CHROME_REV || chromiumRevision();
  installChromium(rev);
  installSystemLibs();
  execFileSync("chmod", ["+x", chromiumExecutable()]);
  // 收尾自检：依赖必须已闭环
  const left = missingLibs(collectSoDirs(LOCAL_LIB_ROOT).join(":"));
  if (left.length > 0) throw new Error(`自检失败，仍缺失：${left.join(", ")}`);
  log(`完成。浏览器：${chromiumExecutable()}`);
}

main();
