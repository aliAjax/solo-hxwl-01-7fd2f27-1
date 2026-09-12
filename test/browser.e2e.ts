/**
 * 真实浏览器端到端验证（Playwright + Chromium）。
 * 自动拉起 Vite dev server，覆盖：
 *  A. 判重：完全相同记录被拦截；骨导 / 言语识别率 / 助听器变化的记录可保存
 *  B. 单条 Markdown 摘要：测听表（含骨导行）与表头 7 列对齐
 *  C. 空言语识别率：单条显示 — 而非 —%；批量显示 80%/—
 */
import { spawn, execSync, type ChildProcess } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { chromium, type Browser, type Page } from "playwright";

const PORT = 5199;
const BASE = `http://localhost:${PORT}`;
let passed = 0;
function check(cond: boolean, msg: string) {
  if (!cond) throw new Error(`断言失败：${msg}`);
  passed += 1;
  console.log(`  ✓ ${msg}`);
}

// --- 本机无 root 安装的 Chromium 及其依赖库（如不存在则回退到 Playwright 默认查找） ---
const chromePath =
  process.env.PLAYWRIGHT_CHROME ||
  path.join(os.homedir(), ".cache/ms-playwright/chromium-1243/chrome-linux/chrome");
const localLibRoot = path.join(os.homedir(), "chrome-libs/root");

function collectLibPath(): string {
  const dirs = execSync(`find ${localLibRoot} -name '*.so*' -exec dirname {} \\; | sort -u`)
    .toString()
    .trim()
    .split("\n")
    .filter(Boolean);
  return dirs.join(":");
}

async function waitForServer(url: string, timeoutMs = 30000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      await new Promise((r) => setTimeout(r, 300));
    }
  }
  throw new Error(`dev server 未在 ${timeoutMs}ms 内就绪：${url}`);
}

function startServer(): ChildProcess {
  // detached：Vite 作为独立进程组，结束时按进程组整体回收，避免 npx 子进程残留
  const srv = spawn(
    "npx",
    ["vite", "--port", String(PORT), "--strictPort", "--host", "127.0.0.1"],
    { cwd: path.resolve(__dirname, ".."), stdio: "ignore", detached: true },
  );
  return srv;
}

function stopServer(srv: ChildProcess): void {
  try {
    if (srv.pid) process.kill(-srv.pid, "SIGTERM"); // 负号：杀整个进程组
  } catch {
    srv.kill();
  }
}

async function resetData(page: Page): Promise<void> {
  // 每次场景独立：清空 localStorage 后刷新，应用重新播种演示数据
  await page.evaluate(() => window.localStorage.clear());
  await page.reload({ waitUntil: "networkidle" });
}

type EncounterVariant = "base" | "bone" | "wrs" | "aid" | "missing";

async function fillEncounter(
  page: Page,
  variant: EncounterVariant,
): Promise<void> {
  const modal = page.locator(".modal").last();
  await modal.locator("select").nth(0).selectOption({ index: 1 }); // 第一个患者
  await modal.locator("select").nth(1).selectOption("initial"); // 分类：初配
  const airR = [40, 42, 45, 50, 55, 60];
  const airL = [35, 40, 44, 48, 52, 58];
  const boneR = variant === "bone" ? [30, 35, 40, 42] : [40, 45, 48, 50];
  const boneL = variant === "bone" ? [28, 33, 38, 42] : [35, 40, 44, 48];
  const airCells = modal.locator(".threshold-table").nth(0).locator("tbody input");
  const boneCells = modal.locator(".threshold-table").nth(1).locator("tbody input");
  for (let i = 0; i < 6; i++) await airCells.nth(i).fill(String(airR[i]));
  for (let i = 0; i < 6; i++) await airCells.nth(6 + i).fill(String(airL[i]));
  for (let i = 0; i < 4; i++) await boneCells.nth(i).fill(String(boneR[i]));
  for (let i = 0; i < 4; i++) await boneCells.nth(4 + i).fill(String(boneL[i]));
  await modal.locator(".wrs-row input").nth(0).fill(variant === "wrs" ? "91" : "80"); // 左耳
  await modal.locator(".wrs-row input").nth(1).fill(variant === "missing" ? "" : "72"); // 右耳
  const model = variant === "aid" ? "E2E Aid Two" : "E2E Aid One";
  const gain = variant === "aid" ? "1" : "3";
  await modal.locator(".aids-list input").nth(0).fill(model);
  await modal.locator(".aids-list input[type=number]").fill(gain);
}

async function readDownload(page: Page, trigger: () => Promise<void>) {
  const dlPromise = page.waitForEvent("download", { timeout: 10000 });
  await trigger();
  const dl = await dlPromise;
  const file = await dl.path();
  return {
    filename: dl.suggestedFilename(),
    text: readFileSync(file!, "utf8").replace(/^﻿/, ""),
  };
}

async function scenarioDuplicate(page: Page) {
  console.log("-- 场景 A：判重（相同拦截，骨导/WRS/助听器变化放行）--");
  await resetData(page);
  await page.fill(".name-input", "王听力");

  const rowCount = () => page.locator(".record-table tbody tr").count();
  const openForm = () => page.getByRole("button", { name: "+ 新增验配记录" }).click();
  const submit = () => page.getByRole("button", { name: "保存验配记录" }).click();

  // 基础记录
  await openForm();
  await fillEncounter(page, "base");
  await submit();
  await page.waitForSelector(".toast-ok", { timeout: 5000 });
  check((await rowCount()) === 4, "基础记录保存，列表 4 条");

  // 完全相同 → 拦截
  await openForm();
  await fillEncounter(page, "base");
  await submit();
  await page.waitForSelector(".modal .alert-error", { timeout: 5000 });
  const dupMsg = await page.locator(".modal .alert-error").innerText();
  check(dupMsg.includes("重复记录"), `完全相同记录被拦截（提示：${dupMsg.slice(0, 40)}…）`);
  check((await rowCount()) === 4, "被拦截后列表仍为 4 条");
  await page.getByRole("button", { name: "取消" }).click();

  // 三种变化 → 放行
  const variants: [Exclude<EncounterVariant, "base" | "missing">, string, number][] = [
    ["bone", "仅骨导变化", 5],
    ["wrs", "仅言语识别率变化", 6],
    ["aid", "仅助听器变化", 7],
  ];
  for (const [v, label, n] of variants) {
    await openForm();
    await fillEncounter(page, v);
    await submit();
    await page.waitForSelector(".toast-ok", { timeout: 5000 });
    check((await rowCount()) === n, `${label} → 保存成功，列表 ${n} 条`);
  }
}

async function scenarioExport(page: Page) {
  console.log("-- 场景 B/C：单条摘要列对齐 + 空言语识别率显示 --");
  await resetData(page);
  await page.fill(".name-input", "王听力");

  // 新增一条右耳 WRS 缺失的记录
  await page.getByRole("button", { name: "+ 新增验配记录" }).click();
  await fillEncounter(page, "missing");
  await page.getByRole("button", { name: "保存验配记录" }).click();
  await page.waitForSelector(".toast-ok", { timeout: 5000 });

  // 打开刚保存记录（列表第一行）的详情并导出
  await page.locator(".record-table tbody tr").first().getByRole("button", { name: "查看" }).click();
  await page.waitForSelector(".modal .audiogram", { timeout: 5000 });

  const one = await readDownload(page, () =>
    page.getByRole("button", { name: "⬇ 导出 Markdown 摘要" }).click(),
  );
  check(one.filename.endsWith(".md"), `单条摘要文件名为 .md（${one.filename}）`);

  const tableLines = one.text.split("\n").filter((l) => l.startsWith("|"));
  check(tableLines.length > 0, "单条摘要含测听表");
  const cols = tableLines.map((l) => l.split("|").length - 2);
  check(cols.every((c) => c === 7), `单条摘要表头/气导/骨导均 7 列对齐（实际列数：${[...new Set(cols)].join(",")}）`);

  // WRS：左耳 80%，右耳缺失显示 —（不出现 —%）
  check(!one.text.includes("—%"), "缺失言语识别率不出现 —%");
  const wrsLines = one.text.split("\n").filter((l) => l.includes("言语识别率（WRS）"));
  check(wrsLines.length === 2, `单条摘要含双耳 WRS 两行（实际 ${wrsLines.length} 行）`);
  check(wrsLines.some((l) => l.includes("**80%**")), "左耳 WRS 显示 80%");
  check(wrsLines.some((l) => l.includes("**—**")), "右耳 WRS 缺失显示 —");

  // 关闭详情，批量导出
  await page.locator(".modal-close").first().click();
  await page.waitForTimeout(200);
  const batch = await readDownload(page, () =>
    page.getByRole("button", { name: "⬇ 导出筛选结果（Markdown）" }).click(),
  );
  const batchLines = batch.text.split("\n").filter((l) => l.startsWith("|"));
  check(batchLines.every((l) => l.split("|").length - 2 === 8), "批量摘要表格全部 8 列对齐");
  const newRow = batchLines.find((l) => l.includes("E2E Aid One"));
  check(!!newRow && newRow.includes("80%/—"), `批量摘要缺失一侧 WRS 显示 80%/—（实际：${(newRow ?? "").split("|")[6]?.trim()}）`);
  check(!batch.text.includes("—%"), "批量摘要整体不出现 —%");
}

async function main() {
  if (existsSync(localLibRoot)) {
    process.env.LD_LIBRARY_PATH = [collectLibPath(), process.env.LD_LIBRARY_PATH].filter(Boolean).join(":");
  }
  const srv = startServer();
  let browser: Browser | undefined;
  try {
    await waitForServer(BASE);
    console.log("dev server 就绪\n");

    browser = await chromium.launch({
      headless: true,
      ...(existsSync(chromePath) ? { executablePath: chromePath } : {}),
      args: ["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage"],
    });
    const context = await browser.newContext({ acceptDownloads: true });
    const page = await context.newPage();
    page.on("console", (msg) => {
      if (msg.type() === "error") console.log("  [browser console.error]", msg.text());
    });
    page.on("pageerror", (err) => console.log("  [pageerror]", err.message));

    await page.goto(BASE, { waitUntil: "networkidle" });
    check((await page.title()).includes("听力验配记录"), "应用页面加载成功");

    await scenarioDuplicate(page);
    await scenarioExport(page);

    await context.close();
    console.log(`\n真实浏览器验证全部通过：${passed} 个断言`);
  } finally {
    await browser?.close().catch(() => {});
    stopServer(srv);
  }
}

main().catch((err) => {
  console.error("\n真实浏览器验证失败：", err);
  process.exit(1);
});
