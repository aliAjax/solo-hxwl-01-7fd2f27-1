/**
 * 一键准备真实浏览器测试环境（默认无需 root），并支持离线复用：
 *
 *   1. Chromium：按 playwright-core 锁定版本下载到 ~/.cache/ms-playwright，
 *      安装包缓存在 HXWL_BROWSER_CACHE（默认 ~/chrome-libs/cache），不删除；
 *   2. 系统依赖：Linux 下用 ldd 检测，按 Debian bookworm 索引下载对应架构
 *      的 .deb 解包到用户目录，循环到依赖闭环；Packages 索引与 .deb 同样入缓存；
 *   3. 结束前真实 headless 启动一次浏览器自检。
 *
 * 环境变量：
 *   OFFLINE=1                 纯离线模式：只使用缓存，绝不联网
 *   PLAYWRIGHT_CHROME=<path>  直接使用系统浏览器，跳过下载与依赖处理（非 Linux 推荐）
 *   HXWL_FORCE_DEB=1          非 Debian 系 Linux 也强制用 .deb 解包方式装库
 *   PLAYWRIGHT_DOWNLOAD_HOST 逗号分隔的额外/优先 Chromium 下载源
 *   DEBIAN_MIRROR             Debian 源镜像（默认 deb.debian.org）
 *   HXWL_BROWSER_CACHE        离线缓存目录
 *   HXWL_CHROME_LIB_ROOT      解包库根目录
 *   PLAYWRIGHT_CHROME_REV     覆盖浏览器版本（一般不需要）
 *
 * 运行：npm run setup:browser
 */
import { execFileSync, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { gunzipSync } from "node:zlib";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright";
import {
  PLAYWRIGHT_BROWSERS,
  CACHE_DIR,
  LOCAL_LIB_ROOT,
  LDPATH_FILE,
  browserDir,
  browserReady,
  chromiumExecutable,
  chromiumRevision,
  collectSoDirs,
  isCustomChrome,
} from "../test/browser-env";

const log = (msg: string) => console.log(`[setup-browser] ${msg}`);

class SetupError extends Error {}

const DPKG_ARCH = process.arch === "arm64" ? "arm64" : "amd64";
const CHROME_ZIP = process.arch === "arm64" ? "chromium-linux-arm64.zip" : "chromium-linux.zip";
const DEB_DIR = path.join(CACHE_DIR, "debs");
const INDEX_DIR = path.join(CACHE_DIR, "debian", `bookworm-${DPKG_ARCH}`);
const DEB_MIRROR = process.env.DEBIAN_MIRROR || "https://deb.debian.org/debian";
const OFFLINE = process.env.OFFLINE === "1" || process.env.OFFLINE === "true";

// ldd 报缺失时的 soname → Debian 包名（bookworm）
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

// ---------- 通用：带离线缓存的下载 ----------
/**
 * 优先使用本地缓存；缓存缺失时联网下载并写入缓存；
 * OFFLINE 模式或全部下载源失败且无缓存时，抛出带操作指引的错误。
 */
function fetchCached(urls: string[], cachePath: string, label: string): string {
  if (existsSync(cachePath)) {
    log(`使用缓存：${path.relative(os.homedir(), cachePath) || cachePath}`);
    return cachePath;
  }
  if (OFFLINE) {
    throw new SetupError(
      `离线模式缺少 ${label} 的缓存（${cachePath}）。\n` +
        `  请在有网环境先执行一次：npm run setup:browser\n` +
        `  或手动把 ${label} 放到上述缓存路径后重试。`,
    );
  }
  mkdirSync(path.dirname(cachePath), { recursive: true });
  let lastErr: unknown;
  for (const url of urls) {
    try {
      log(`下载 ${url}`);
      execFileSync(
        "curl",
        ["-fsSL", "--retry", "3", "--connect-timeout", "20", "--max-time", "300", "-o", cachePath, url],
        { maxBuffer: 1024 * 1024 * 400 },
      );
      log(`已缓存 ${label}`);
      return cachePath;
    } catch (e) {
      lastErr = e;
      rmSync(cachePath, { force: true });
      log("  该源失败，尝试下一源");
    }
  }
  throw new SetupError(
    `无法下载 ${label}，所有来源均失败。\n` +
      `  尝试过：\n${urls.map((u) => `    - ${u}`).join("\n")}\n` +
      `  原因：${String((lastErr as Error)?.message ?? lastErr).split("\n")[0]}\n` +
      `  可选处理：\n` +
      `    1) 配置可访问的镜像后重试：DEBIAN_MIRROR=<镜像> 或 PLAYWRIGHT_DOWNLOAD_HOST=<镜像> npm run setup:browser\n` +
      `    2) 在有网机器执行 setup 后，拷贝 ${CACHE_DIR} 与 ${PLAYWRIGHT_BROWSERS} 到本机\n` +
      `    3) 设置 PLAYWRIGHT_CHROME=/path/to/chrome 使用系统自带浏览器`,
  );
}

// ---------- 环境检测 ----------
function requireTools(): void {
  const needed = ["curl", "unzip", "dpkg-deb", "ldd"];
  const missing = needed.filter((t) => spawnSync("sh", ["-c", `command -v ${t}`]).status !== 0);
  if (missing.length === 0) return;
  throw new SetupError(
    `缺少必需的系统命令：${missing.join(", ")}。\n` +
      `  Debian/Ubuntu 可执行：sudo apt-get install -y curl unzip dpkg libc-bin\n` +
      `  Fedora/RHEL：sudo dnf install -y curl unzip dpkg\n` +
      `  Alpine：apk add curl unzip dpkg（Alpine 为 musl 体系，建议改用 PLAYWRIGHT_CHROME 指定系统 Chromium）`,
  );
}

interface OsRelease {
  id: string;
  idLike: string;
  pretty: string;
}
function readOsRelease(): OsRelease {
  try {
    // HXWL_OS_RELEASE 仅供测试覆盖发行版识别（正常环境读 /etc/os-release）
    const file = process.env.HXWL_OS_RELEASE || "/etc/os-release";
    const text = readFileSync(file, "utf8");
    const get = (k: string) => new RegExp(`^${k}=["']?(.+?)["']?$`, "m").exec(text)?.[1] ?? "";
    return { id: get("ID"), idLike: get("ID_LIKE"), pretty: get("PRETTY_NAME") || "未知 Linux" };
  } catch {
    return { id: "", idLike: "", pretty: "未知 Linux" };
  }
}

function debianLike(rel: OsRelease): boolean {
  const ids = [rel.id, ...rel.idLike.split(/\s+/)].filter(Boolean);
  return ids.some((i) => ["debian", "ubuntu", "linuxmint", "pop", "elementary", "kali", "raspbian"].includes(i));
}

function nonDebianHint(rel: OsRelease, missing: string[]): string {
  const ids = [rel.id, ...rel.idLike.split(/\s+/)].filter(Boolean);
  const isFedora = ids.some((i) => ["fedora", "rhel", "centos", "rocky", "alma"].includes(i));
  const isArch = ids.some((i) => ["arch", "manjaro"].includes(i));
  const isAlpine = rel.id === "alpine";
  const aptPkgs = [
    "libnss3", "libnspr4", "libatk1.0-0", "libatk-bridge2.0-0", "libcups2", "libdrm2",
    "libxkbcommon0", "libxcomposite1", "libxdamage1", "libxrandr2", "libxfixes3",
    "libasound2", "libatspi2.0-0", "libdbus-1-3", "libgbm1", "libxi6",
  ].join(" ");
  const lines = [
    `当前系统「${rel.pretty}」不是 Debian 系，缺失 ${missing.length} 个 Chromium 运行库：${missing.join(", ")}。`,
    "请选择一种方式：",
  ];
  if (isAlpine) {
    lines.push("  1) Alpine（musl）安装系统浏览器：apk add chromium nss freetype harfbuzz ca-certificates ttf-freefont");
    lines.push("     然后：PLAYWRIGHT_CHROME=$(command -v chromium) npm run setup:browser");
  } else if (isFedora) {
    lines.push(
      "  1) 安装系统依赖：sudo dnf install -y nss nspr atk at-spi2-atk cups-libs libdrm libxkbcommon " +
        "libXcomposite libXdamage libXrandr libXfixes alsa-lib at-spi2-core dbus-libs mesa-libgbm libXi avahi-libs",
    );
  } else if (isArch) {
    lines.push("  1) 安装系统依赖：sudo pacman -S --needed nss nspr atk at-spi2-atk libcups libdrm libxkbcommon libxcomposite libxdamage libxrandr libxfixes alsa-lib dbus mesa libxi avahi");
  } else {
    lines.push(`  1) Debian/Ubuntu 可执行：sudo apt-get install -y ${aptPkgs}`);
  }
  lines.push("  2) 或直接使用系统浏览器：PLAYWRIGHT_CHROME=/path/to/chrome（或 chromium）npm run setup:browser");
  lines.push("  3) 若确认当前系统兼容 bookworm 的 .deb，可加 HXWL_FORCE_DEB=1 强制走解包安装");
  return lines.join("\n");
}

// ---------- Chromium ----------
function installChromium(rev: string): void {
  if (!isCustomChrome() && browserReady()) {
    log(`Chromium ${rev} 已存在，跳过下载`);
    return;
  }
  if (isCustomChrome()) {
    const exe = chromiumExecutable();
    if (!existsSync(exe)) {
      throw new SetupError(`PLAYWRIGHT_CHROME 指向的浏览器不存在：${exe}`);
    }
    log(`使用 PLAYWRIGHT_CHROME 指定的浏览器：${exe}`);
    return;
  }
  const dir = browserDir(rev);
  mkdirSync(dir, { recursive: true });
  const zipCache = path.join(CACHE_DIR, "chromium", rev, CHROME_ZIP);
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
  const zipPath = fetchCached(urls, zipCache, `Chromium ${rev}（${CHROME_ZIP}）`);
  log("解压 Chromium …");
  execFileSync("unzip", ["-q", "-o", zipPath, "-d", dir]);
  writeFileSync(path.join(dir, "INSTALLATION_COMPLETE"), "");
  log(`Chromium 安装到 ${dir}`);
}

// ---------- 系统依赖库 ----------
function readPackagesIndex(): Map<string, string> {
  const idxPath = path.join(INDEX_DIR, "Packages.gz");
  const urls = [
    `${DEB_MIRROR}/dists/bookworm/main/binary-${DPKG_ARCH}/Packages.gz`,
    `https://mirrors.tuna.tsinghua.edu.cn/debian/dists/bookworm/main/binary-${DPKG_ARCH}/Packages.gz`,
  ];
  const cached = fetchCached(urls, idxPath, `Debian bookworm 软件包索引（${DPKG_ARCH}）`);
  const text = gunzipSync(readFileSync(cached)).toString("utf8");
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
  return [
    ...new Set(
      [...out.matchAll(/^\s*([\w.+-]+\.so[\w.]*)\s+=>\s*not found/gm)].map((m) => m[1]),
    ),
  ];
}

function installDebs(packageNames: string[], pkgIndex: Map<string, string>): void {
  mkdirSync(DEB_DIR, { recursive: true });
  mkdirSync(LOCAL_LIB_ROOT, { recursive: true });
  for (const pkg of packageNames) {
    const rel = pkgIndex.get(pkg);
    if (!rel) throw new SetupError(`Debian 索引中找不到包：${pkg}（${DPKG_ARCH}）`);
    const debPath = path.join(DEB_DIR, path.basename(rel));
    const urls = [
      `${DEB_MIRROR}/${rel}`,
      `https://mirrors.tuna.tsinghua.edu.cn/debian/${rel}`,
    ];
    // .deb 入缓存，可离线复用；已存在则直接解包
    const cached = fetchCached(urls, debPath, `依赖包 ${pkg}`);
    log(`  解包 ${pkg}`);
    execFileSync("dpkg-deb", ["-x", cached, LOCAL_LIB_ROOT]);
  }
}

function installSystemLibs(): void {
  // 自定义系统浏览器：由系统保证依赖，直接交给启动自检判断
  if (isCustomChrome()) return;
  if (os.platform() !== "linux") return;

  let libPath = collectSoDirs(LOCAL_LIB_ROOT).join(":");
  let missing = missingLibs(libPath);
  if (missing.length === 0) {
    log("系统依赖库齐全，无需补装");
    mkdirSync(path.dirname(LDPATH_FILE), { recursive: true });
    writeFileSync(LDPATH_FILE, libPath || "");
    return;
  }
  log(`检测到缺失库：${missing.join(", ")}`);

  const rel = readOsRelease();
  if (!debianLike(rel) && process.env.HXWL_FORCE_DEB !== "1") {
    throw new SetupError(nonDebianHint(rel, missing));
  }
  if (!debianLike(rel)) log(`非 Debian 系，按 HXWL_FORCE_DEB=1 强制使用 bookworm .deb`);

  const pkgIndex = readPackagesIndex();
  const installed = new Set<string>();
  for (let round = 1; round <= 6; round++) {
    const wanted: string[] = [];
    for (const soname of missing) {
      const pkg = CURATED_SONAME_PKG[soname];
      if (!pkg) {
        throw new SetupError(
          `缺少未收录的依赖 ${soname}。\n` +
            `  请在 scripts/setup-browser.ts 的 CURATED_SONAME_PKG 中补充其 Debian 包名，` +
            `或用 PLAYWRIGHT_CHROME 指定已装好依赖的系统浏览器。`,
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
    if (missing.length === 0) break;
  }

  if (missing.length > 0) {
    throw new SetupError(
      `依赖闭环失败，仍缺失：${missing.join(", ")}。\n` +
        `  可尝试：sudo apt-get install -y libnss3 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 libxkbcommon0 libxcomposite1 libxdamage1 libxrandr2 libasound2 libatspi2.0-0 libgbm1 libxi6\n` +
        `  或设置 PLAYWRIGHT_CHROME 使用系统浏览器。`,
    );
  }
  mkdirSync(path.dirname(LDPATH_FILE), { recursive: true });
  writeFileSync(LDPATH_FILE, libPath || "");
  log(`系统依赖就绪，LD 路径写入 ${LDPATH_FILE}`);
}

// ---------- 真实启动自检 ----------
async function smokeLaunch(): Promise<void> {
  const exe = chromiumExecutable();
  if (!existsSync(exe)) {
    throw new SetupError(
      `浏览器可执行文件不存在：${exe}。\n` +
        `  请运行 npm run setup:browser，或设置 PLAYWRIGHT_CHROME 指向系统浏览器。`,
    );
  }
  const ld = collectSoDirs(LOCAL_LIB_ROOT).join(":");
  try {
    const browser = await chromium.launch({
      headless: true,
      executablePath: exe,
      args: ["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage"],
      env: ld ? { ...process.env, LD_LIBRARY_PATH: [ld, process.env.LD_LIBRARY_PATH].filter(Boolean).join(":") } : process.env,
      timeout: 30000,
    });
    const page = await browser.newPage();
    await page.setContent("<h1>ok</h1>");
    const text = await page.textContent("h1");
    await browser.close();
    if (text !== "ok") throw new Error("自检页面返回异常");
    log(`浏览器启动自检通过（${exe}）`);
  } catch (e) {
    throw new SetupError(
      `浏览器下载完成但无法启动：${String((e as Error)?.message ?? e).split("\n")[0]}\n` +
        `  常见原因：仍有系统库缺失（本脚本在非 Debian 系不会自动装库）、无显示环境或沙箱限制。\n` +
        `  处理建议：\n` +
        `    - Debian/Ubuntu：sudo apt-get install -y libnss3 libatk-bridge2.0-0 libcups2 libdrm2 libxkbcommon0 libxcomposite1 libxdamage1 libxrandr2 libasound2 libatspi2.0-0 libgbm1 libxi6\n` +
        `    - 其他系统：安装等价运行库，或设置 PLAYWRIGHT_CHROME=/path/to/chrome 使用系统浏览器\n` +
        `    - 容器内可加 --no-sandbox（测试已默认添加）`,
    );
  }
}

async function main(): Promise<void> {
  // 非 Linux：只支持系统浏览器方式（项目的 .deb 解包方案面向 Linux）
  if (!isCustomChrome() && os.platform() !== "linux") {
    throw new SetupError(
      `当前平台 ${os.platform()} 不支持自动下载配套系统库。请改用系统浏览器：\n` +
        `  macOS：brew install --cask chromium，然后 PLAYWRIGHT_CHROME=/path/to/chromium npm run setup:browser\n` +
        `  Windows：安装 Chrome/Edge 后设置 PLAYWRIGHT_CHROME 指向 chrome.exe\n` +
        `  或在常规桌面环境执行：npx playwright install chromium`,
    );
  }
  if (os.platform() === "linux") requireTools();

  mkdirSync(PLAYWRIGHT_BROWSERS, { recursive: true });
  mkdirSync(CACHE_DIR, { recursive: true });
  const rev = process.env.PLAYWRIGHT_CHROME_REV || chromiumRevision();
  installChromium(rev);
  installSystemLibs();
  await smokeLaunch();
  log(`完成。浏览器：${chromiumExecutable()}${OFFLINE ? "（离线模式）" : ""}`);
}

main().catch((err: unknown) => {
  const msg = err instanceof SetupError ? err.message : `内部错误：${String(err)}`;
  console.error(`\n[setup-browser] ✗ ${msg}\n`);
  process.exit(1);
});
