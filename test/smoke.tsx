/**
 * 端到端冒烟测试：在 jsdom 中真实渲染 App，模拟用户点击/填写，
 * 覆盖：新增患者、不完整校验、重复患者、重复验配记录、筛选、查看详情、
 * Markdown 导出、角色权限；并对纯逻辑（校验/重复检测/摘要）做断言。
 */
import "./setup-dom";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import App from "../src/App";
import { store, newPatientId, newEncounterId } from "../src/store";
import {
  validatePatient,
  validateEncounter,
  findDuplicateEncounter,
  isResubmit,
} from "../src/validation";
import { encounterSummary, batchSummary } from "../src/export";
import type { Patient, Encounter, Role } from "../src/types";

let passed = 0;
function check(cond: boolean, msg: string) {
  if (!cond) throw new Error(`断言失败：${msg}`);
  passed += 1;
  console.log(`  ✓ ${msg}`);
}

// ---------- 纯逻辑单元测试 ----------
function unitTests() {
  const goodPatient = { name: "测试人", gender: "female" as const, birthDate: "1990-01-01", phone: "", note: "" };
  check(Object.keys(validatePatient(goodPatient, [])).length === 0, "合法患者档案通过校验");

  const errs = validatePatient({ ...goodPatient, name: "", gender: "" as const, birthDate: "bad" }, []);
  check(!!errs.name && !!errs.gender && !!errs.birthDate, "不完整患者档案给出字段级错误");

  const dupPatient: Patient = { id: "P-1", ...goodPatient, createdAt: 1 };
  const dupErrs = validatePatient(goodPatient, [dupPatient]);
  check(dupErrs.name?.includes("重复建档") ?? false, "同名同出生日期的患者被识别为重复档案");

  const future = validatePatient({ ...goodPatient, birthDate: "2099-01-01" }, []);
  check(!!future.birthDate, "出生日期晚于今天报错");

  const emptyEncounter = {
    patientId: "",
    date: "",
    category: "" as const,
    audiogram: {
      air: { left: {}, right: {} },
      bone: { left: {}, right: {} },
    },
    wrs: { left: "" as const, right: "" as const },
    aids: [],
  };
  const ee = validateEncounter(emptyEncounter, [dupPatient]);
  check(
    !!ee.patientId && !!ee.date && !!ee.category && !!ee.aids && !!ee["wrs.left"],
    "空验配记录返回必填错误（患者/日期/分类/助听器/WRS）",
  );

  const ag = (vals: number[]) =>
    Object.fromEntries([250, 500, 1000, 2000, 4000, 8000].map((f, i) => [f, vals[i] ?? undefined]).filter(([, v]) => v !== undefined));
  const bg = (vals: number[]) =>
    Object.fromEntries([500, 1000, 2000, 4000].map((f, i) => [f, vals[i] ?? undefined]).filter(([, v]) => v !== undefined));

  const validAg = {
    left: ag([35, 40, 44, 48, 52, 58]),
    right: ag([40, 42, 45, 50, 55, 60]),
  };
  const validBg = {
    left: bg([35, 40, 44, 48]),
    right: bg([40, 45, 48, 50]),
  };
  const validEnc = {
    patientId: "P-1",
    date: "2026-09-10",
    category: "initial" as const,
    audiogram: { air: validAg, bone: validBg },
    wrs: { left: 80 as const, right: "" as const },
    aids: [{ model: "Test Aid Pro", side: "bilateral" as const, gainDb: 3, note: "" }],
  };
  check(Object.keys(validateEncounter(validEnc, [dupPatient])).length === 0, "合法验配记录通过校验");

  // 缺一个必填气导点
  const missingOne = {
    ...validEnc,
    audiogram: {
      air: { ...validAg, left: ag([35, 40, 44, undefined as unknown as number, 52, 58]) },
      bone: validBg,
    },
  };
  check(!!validateEncounter(missingOne, [dupPatient])["air.left.2000"], "缺少左耳 2k 气导时报错");

  // 骨导明显高于气导
  const gap = {
    ...validEnc,
    audiogram: {
      air: { left: ag([35, 40, 44, 48, 52, 58]), right: ag([40, 42, 45, 50, 55, 60]) },
      bone: { left: bg([35, 80, 44, 48]), right: bg([40, 45, 48, 50]) },
    },
  };
  check(!!validateEncounter(gap, [dupPatient])["air.left.1000"], "骨导显著高于气导（气骨差异常）时报错");

  // 阈值超范围
  const outOfRange = {
    ...validEnc,
    audiogram: { air: { left: ag([35, 200, 44, 48, 52, 58]), right: validAg.right }, bone: validBg },
  };
  check(!!validateEncounter(outOfRange, [dupPatient])["air.left.500"], "阈值超出 -10~120 范围报错");

  const wrsBad = { ...validEnc, wrs: { left: 120, right: "" } };
  check(!!validateEncounter(wrsBad, [dupPatient])["wrs.left"], "言语识别率超过 100 报错");

  const aidBad = { ...validEnc, aids: [{ model: "", side: "bilateral" as const, gainDb: "", note: "" }] };
  const ab = validateEncounter(aidBad, [dupPatient]);
  check(!!ab["aids.0.model"] && !!ab["aids.0.gainDb"], "助听器型号/增益缺失报错");

  const existing: Encounter = {
    id: newEncounterId(),
    patientId: "P-1",
    date: "2026-09-10",
    category: "initial",
    audiogram: { air: validAg, bone: validBg },
    wrs: { left: 80, right: "" },
    aids: [],
    feedback: "",
    operatorName: "x",
    operatorRole: "audiologist",
    createdAt: Date.now(),
  };
  check(!!findDuplicateEncounter(validEnc, [existing]), "同患者同日同分类同气导结果识别为重复记录");
  const changed = { ...validEnc, audiogram: { air: { ...validAg, left: ag([35, 41, 44, 48, 52, 58]) }, bone: validBg } };
  check(!findDuplicateEncounter(changed, [existing]), "气导结果不同不算重复");

  const ref = { fingerprint: "abc", at: Date.now() - 100 };
  check(isResubmit(ref, "abc"), "5 秒内相同内容识别为重复提交");
  check(!isResubmit(ref, "abd"), "内容变化不算重复提交");
  check(!isResubmit({ ...ref, at: Date.now() - 6000 }, "abc"), "超过 5 秒不拦截");

  const summary = encounterSummary(existing, dupPatient);
  check(summary.startsWith("# 听力验配记录摘要"), "单条摘要为 Markdown 标题开头");
  check(summary.includes("Test Aid Pro") === false, "空助听器记录摘要不残留型号");
  const withAid = encounterSummary({ ...existing, aids: validEnc.aids }, dupPatient);
  check(withAid.includes("Test Aid Pro") && withAid.includes("+3") === false && withAid.includes("3 dB"), "摘要含助听器型号与增益");
  const batch = batchSummary([existing], new Map([["P-1", dupPatient]]), "近 14 天 / 全部");
  check(batch.includes("批量摘要") && batch.includes("测试人"), "批量摘要含筛选描述与患者");
}

// ---------- DOM 集成测试 ----------
const $ = (sel: string, root: ParentNode = document) => root.querySelector(sel);
const $$ = (sel: string, root: ParentNode = document) => Array.from(root.querySelectorAll(sel));

function findButton(text: string): HTMLButtonElement {
  const btn = $$("button").find((b) => (b.textContent ?? "").replace(/\s+/g, "").includes(text.replace(/\s+/g, "")));
  if (!btn) throw new Error(`找不到按钮：${text}`);
  return btn as HTMLButtonElement;
}

function setValue(el: Element, value: string) {
  const input = el as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
  const proto =
    input instanceof HTMLSelectElement
      ? HTMLSelectElement.prototype
      : input instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, "value")!.set!;
  act(() => {
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

const downloads: { name: string; blob: Blob }[] = [];

async function lastDownloadText(): Promise<string> {
  const d = downloads[downloads.length - 1];
  return (await d.blob.text()).replace(/^﻿/, "");
}

async function renderApp() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(<App />);
  });
  return { root, container };
}

async function integrationTests() {
  store.resetToSeed();
  const { container } = await renderApp();

  // 记录人姓名
  setValue($(".name-input")!, "王听力");

  // ---- 新增患者：不完整提交 ----
  let alertText: string;
  findButton("新增患者档案").click();
  await act(async () => {});
  check(!!$(".modal [role='dialog'], .modal"), "患者档案弹窗打开");
  findButton("保存档案").click();
  await act(async () => {});
  alertText = $(".alert-error")?.textContent ?? "";
  check(alertText.includes("姓名不能为空"), `空表单提交显示明确全局错误（实际：${alertText}）`);
  check(($$(".field-error")[0]?.textContent ?? "").includes("姓名不能为空"), "显示「姓名不能为空」字段错误");

  // 姓名太短
  setValue($$(".field input")[0], "张");
  findButton("保存档案").click();
  await act(async () => {});
  check(($$(".field-error")[0]?.textContent ?? "").includes("至少 2 个字符"), "单字姓名给出长度错误");

  // 填完整后保存
  setValue($$(".field input")[0], "张三");
  setValue($(".field select")!, "female");
  const fieldInputs = $$(".field input");
  setValue(fieldInputs.find((i) => (i as HTMLInputElement).type === "date")!, "1990-03-03");
  findButton("保存档案").click();
  await act(async () => {});
  check($(".toast-ok")?.textContent?.includes("张三") ?? false, "患者张三保存成功并出现成功提示");
  check(store.getState().patients.length === 4, "store 中患者数量变为 4");

  // ---- 重复患者 ----
  findButton("新增患者档案").click();
  await act(async () => {});
  setValue($$(".modal .field input")[0], "张三");
  setValue($(".modal .field select")!, "female");
  setValue($$(".modal .field input").find((i) => (i as HTMLInputElement).type === "date")!, "1990-03-03");
  findButton("保存档案").click();
  await act(async () => {});
  alertText = $$(".alert-error").pop()?.textContent ?? "";
  check(alertText.includes("重复"), `重复患者给出明确错误（实际：${alertText}）`);
  findButton("取消").click();
  await act(async () => {});

  // ---- 新增验配记录：不完整提交 ----
  findButton("新增验配记录").click();
  await act(async () => {});
  findButton("保存验配记录").click();
  await act(async () => {});
  alertText = $$(".alert-error")[0]?.textContent ?? "";
  check(alertText.includes("记录无法保存") && alertText.includes("必填"), `空验配记录提交显示明确全局错误（实际：${alertText}）`);
  check($$(".threshold-input.invalid").length > 0, "未填的必填阈值格标红");

  // 填写完整记录
  const modal = $$(".modal").pop()!;
  const selects = $$("select", modal);
  setValue(selects[0], store.getState().patients[0].id); // 患者（最新 = 张三）
  check(store.getState().patients[0].name === "张三", "下拉首位患者为刚新增的张三");
  setValue(selects[1], "initial"); // 分类（selects[2] 是助听器验配耳）
  const tables = $$(".threshold-table", modal);
  const airInputs = (table: Element) => $$("tbody tr", table).flatMap((tr) => $$("input", tr));
  const air = airInputs(tables[0]);
  // 行顺序：右耳、左耳；列顺序：250,500,1k,2k,4k,8k
  [40, 42, 45, 50, 55, 60].forEach((v, i) => setValue(air[i], String(v)));
  [35, 40, 44, 48, 52, 58].forEach((v, i) => setValue(air[6 + i], String(v)));
  const bone = airInputs(tables[1]);
  [40, 45, 48, 50].forEach((v, i) => setValue(bone[i], String(v)));
  [35, 40, 44, 48].forEach((v, i) => setValue(bone[4 + i], String(v)));
  const wrsInputs = $$(".wrs-row input", modal);
  setValue(wrsInputs[0], "80");
  const aidInputs = $$(".aids-list input", modal);
  setValue(aidInputs[0], "Test Aid Pro"); // 型号
  setValue(aidInputs.find((i) => (i as HTMLInputElement).type === "number")!, "3"); // 增益
  findButton("保存验配记录").click();
  await act(async () => {});
  check($(".toast-ok")?.textContent?.includes("已保存") ?? false, "验配记录保存成功");
  check(store.getState().encounters.length === 4, "store 中验配记录数量变为 4");
  const saved = store.getState().encounters[0];
  check(
    saved.aids[0].model === "Test Aid Pro" && saved.aids[0].gainDb === 3 && saved.wrs.left === 80,
    "保存的记录含型号/增益/言语识别率",
  );

  // ---- 重复验配记录（同患者同日同分类同结果）----
  findButton("新增验配记录").click();
  await act(async () => {});
  const m2 = $$(".modal").pop()!;
  const s2 = $$("select", m2);
  setValue(s2[0], saved.patientId);
  setValue(s2[1], "initial");
  const a2 = airInputs($$(".threshold-table", m2)[0]);
  [40, 42, 45, 50, 55, 60].forEach((v, i) => setValue(a2[i], String(v)));
  [35, 40, 44, 48, 52, 58].forEach((v, i) => setValue(a2[6 + i], String(v)));
  const b2 = airInputs($$(".threshold-table", m2)[1]);
  [40, 45, 48, 50].forEach((v, i) => setValue(b2[i], String(v)));
  [35, 40, 44, 48].forEach((v, i) => setValue(b2[4 + i], String(v)));
  setValue($$(".wrs-row input", m2)[0], "80");
  const ai2 = $$(".aids-list input", m2);
  setValue(ai2[0], "Another Aid");
  setValue(ai2.find((i) => (i as HTMLInputElement).type === "number")!, "1");
  findButton("保存验配记录").click();
  await act(async () => {});
  alertText = $$(".alert-error")[0]?.textContent ?? "";
  check(alertText.includes("重复记录"), `重复验配记录给出明确错误（实际：${alertText}）`);
  check(store.getState().encounters.length === 4, "重复记录未写入 store");
  findButton("取消").click();
  await act(async () => {});

  // ---- 筛选：分类 ----
  const rows = () => $$(".record-table tbody tr");
  const categoryChip = (label: string) =>
    $$(".chip-group button").find((b) => b.textContent?.trim() === label) as HTMLButtonElement;
  categoryChip("初配").click();
  await act(async () => {});
  check(rows().length === 2, `分类筛选「初配」得到 2 条（实际 ${rows().length}）`);
  check(rows().every((r) => r.textContent?.includes("初配")), "筛选结果全部为初配");

  // 先清除分类筛选
  categoryChip("全部").click();
  await act(async () => {});
  check(rows().length === 4, "清除分类筛选后恢复 4 条");

  // ---- 筛选：记录人角色 ----
  const roleSel = $$(".toolbar select")[0] as HTMLSelectElement;
  setValue(roleSel, "followup");
  check(rows().length === 1 && rows()[0].textContent?.includes("赵兰英"), "角色筛选「复诊助理」得到赵兰英 1 条");
  setValue(roleSel, "");

  // ---- 搜索 ----
  const search = $(".filter-search input")!;
  setValue(search, "Phonak");
  check(rows().length === 1 && rows()[0].textContent?.includes("刘敏"), "搜索 Phonak 命中刘敏 1 条");
  // 空结果导出 → 错误提示
  setValue(search, "不存在的型号zzzz");
  findButton("导出筛选结果").click();
  await act(async () => {});
  check($(".toast-err")?.textContent?.includes("为空") ?? false, "空筛选结果导出给出错误提示");
  setValue(search, "");
  check(rows().length === 4, "清除搜索后恢复 4 条");

  // ---- 批量导出 ----
  downloads.length = 0;
  findButton("导出筛选结果").click();
  await act(async () => {});
  check(downloads.length === 1 && downloads[0].name.endsWith(".md"), "批量导出触发 .md 文件下载");
  const batchMd = await lastDownloadText();
  check(batchMd.startsWith("# 听力验配记录批量摘要") && batchMd.includes("张三"), "批量摘要内容含标题与新增患者");

  // ---- 查看详情 ----
  (rows()[0].querySelector(".link-btn") as HTMLButtonElement).click();
  await act(async () => {});
  const detail = $$(".modal").pop()!;
  check(!!$(".audiogram", detail), "详情显示听力图 SVG");
  check(($$(".metric-box", detail).length) === 4, "详情显示 PTA 与 WRS 四个指标");
  check($$(".aid-card", detail).length >= 1, "详情显示助听器与增益卡片");
  downloads.length = 0;
  ($$("button", detail).find((b) => b.textContent?.includes("导出 Markdown 摘要")) as HTMLButtonElement).click();
  await act(async () => {});
  const oneMd = await lastDownloadText();
  check(oneMd.startsWith("# 听力验配记录摘要") && oneMd.includes("言语识别率"), "详情导出为单条 Markdown 摘要");
  ($$(".modal-close", detail)[0] as HTMLButtonElement).click();
  await act(async () => {});

  // 全部记录标签
  findButton("全部记录").click();
  await act(async () => {});
  check(rows().length === 4, "全部记录页显示 4 条");

  // 患者档案页
  findButton("患者档案").click();
  await act(async () => {});
  check($$(".patient-card").length === 4, "患者档案页显示 4 张卡片");

  // ---- 切换复诊助理：权限与录入 ----
  findButton("近期记录").click();
  await act(async () => {});
  ( $$(".role-switch button")[1] as HTMLButtonElement).click();
  await act(async () => {});
  check(!$$("button").some((b) => b.textContent?.includes("新增患者档案")), "复诊助理视图不显示「新增患者档案」");
  findButton("新增验配记录").click();
  await act(async () => {});
  const m3 = $$(".modal").pop()!;
  const catSelect = $$("select", m3)[1] as HTMLSelectElement;
  check(catSelect.disabled && catSelect.value === "followup", "复诊助理的分类锁定为「复诊」");
  const s3 = $$("select", m3);
  setValue(s3[0], saved.patientId);
  const a3 = airInputs($$(".threshold-table", m3)[0]);
  [30, 32, 35, 40, 45, 50].forEach((v, i) => setValue(a3[i], String(v)));
  [25, 30, 34, 38, 42, 48].forEach((v, i) => setValue(a3[6 + i], String(v)));
  const b3 = airInputs($$(".threshold-table", m3)[1]);
  [30, 35, 38].forEach((v, i) => setValue(b3[i], String(v)));
  [25, 30, 34].forEach((v, i) => setValue(b3[4 + i], String(v)));
  setValue($$(".wrs-row input", m3)[0], "88");
  const ai3 = $$(".aids-list input", m3);
  setValue(ai3[0], "Followup Aid X");
  setValue(ai3.find((i) => (i as HTMLInputElement).type === "number")!, "-1");
  findButton("保存验配记录").click();
  await act(async () => {});
  const followupRec = store.getState().encounters[0];
  check(
    followupRec.operatorRole === ("followup" as Role) && followupRec.category === "followup",
    "复诊助理保存的记录标记为复诊角色与复诊分类",
  );
  check(
    followupRec.aids[0].model === "Followup Aid X" && followupRec.aids[0].gainDb === -1,
    "复诊记录保存了型号与负增益调整",
  );

  // 未填记录人姓名时拦截
  ($$(".role-switch button")[0] as HTMLButtonElement).click();
  await act(async () => {});
  setValue($(".name-input")!, "");
  findButton("新增验配记录").click();
  await act(async () => {});
  check($(".toast-err")?.textContent?.includes("记录人姓名") ?? false, "未填记录人时新增被拦截并提示");

  console.log(`\n集成环境渲染容器节点数：${container.childNodes.length}`);
}

async function main() {
  // 捕获应用的“下载”：拦截 <a>.click 并记录 Blob
  window.HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement) {
    downloads.push({ name: this.download, blob: capturedBlob! });
  };
  let capturedBlob: Blob | undefined;
  window.URL.createObjectURL = ((blob: Blob) => {
    capturedBlob = blob;
    return "blob:mock";
  }) as typeof window.URL.createObjectURL;
  window.URL.revokeObjectURL = () => {};

  // 让所有 DOM click 在 React act 内执行，同步刷新状态（下载锚点已在上面单独接管）
  const nativeClick = window.HTMLElement.prototype.click;
  window.HTMLElement.prototype.click = function (this: HTMLElement) {
    act(() => {
      nativeClick.call(this);
    });
  };

  console.log("== 纯逻辑单元测试 ==");
  unitTests();
  console.log("\n== jsdom 集成测试 ==");
  await integrationTests();
  // 等待 Blob.text() Promise 落盘
  await new Promise((r) => setTimeout(r, 50));
  console.log(`\n全部通过：${passed} 个断言`);
}

main().catch((err) => {
  console.error("\n测试失败：", err);
  process.exit(1);
});
