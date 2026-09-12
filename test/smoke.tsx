/**
 * 端到端冒烟测试：在 jsdom 中真实渲染 App，模拟用户点击/填写，
 * 覆盖：新增患者、不完整校验、重复患者、重复验配记录、筛选、查看详情、
 * Markdown 导出、角色权限；并对纯逻辑（校验/重复检测/摘要）做断言。
 */
import "./setup-dom";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import App from "../src/App";
import { store, newEncounterId } from "../src/store";
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

  const wrsBad = { ...validEnc, wrs: { left: 120, right: "" as "" } };
  check(!!validateEncounter(wrsBad, [dupPatient])["wrs.left"], "言语识别率超过 100 报错");

  const aidBad = { ...validEnc, aids: [{ model: "", side: "bilateral" as const, gainDb: "" as "", note: "" }] };
  const ab = validateEncounter(aidBad, [dupPatient]);
  check(!!ab["aids.0.model"] && !!ab["aids.0.gainDb"], "助听器型号/增益缺失报错");

  const existing: Encounter = {
    id: newEncounterId(),
    patientId: "P-1",
    date: "2026-09-10",
    category: "initial",
    audiogram: { air: validAg, bone: validBg },
    wrs: { left: 80, right: "" },
    aids: validEnc.aids,
    feedback: "",
    operatorName: "x",
    operatorRole: "audiologist",
    createdAt: Date.now(),
  };
  check(!!findDuplicateEncounter(validEnc, [existing]), "气导/骨导/WRS/助听器全部相同识别为重复记录");
  const changedAir = {
    ...validEnc,
    audiogram: { air: { ...validAg, left: ag([35, 41, 44, 48, 52, 58]) }, bone: validBg },
  };
  check(!findDuplicateEncounter(changedAir, [existing]), "仅气导不同不算重复、可保存");
  const changedBone = {
    ...validEnc,
    audiogram: {
      air: validAg,
      bone: { left: bg([30, 35, 40, 44]), right: validBg.right },
    },
  };
  check(!findDuplicateEncounter(changedBone, [existing]), "仅骨导不同不算重复、可保存");
  const changedWrs = { ...validEnc, wrs: { left: 80, right: 66 } };
  check(!findDuplicateEncounter(changedWrs, [existing]), "仅言语识别率不同不算重复、可保存");
  const changedAids = {
    ...validEnc,
    aids: [{ model: "Test Aid Pro 2", side: "left" as const, gainDb: 5, note: "" }],
  };
  check(!findDuplicateEncounter(changedAids, [existing]), "仅助听器（型号/增益/验配耳）不同不算重复、可保存");

  const ref = { fingerprint: "abc", at: Date.now() - 100 };
  check(isResubmit(ref, "abc"), "5 秒内相同内容识别为重复提交");
  check(!isResubmit(ref, "abd"), "内容变化不算重复提交");
  check(!isResubmit({ ...ref, at: Date.now() - 6000 }, "abc"), "超过 5 秒不拦截");

  // 导出：骨导表格列与表头对齐（7 列）
  const withAid = encounterSummary(existing, dupPatient);
  check(withAid.includes("Test Aid Pro") && withAid.includes("3 dB"), "摘要含助听器型号与增益");
  const emptyAidsSummary = encounterSummary({ ...existing, aids: [] }, dupPatient);
  check(!emptyAidsSummary.includes("Test Aid Pro"), "空助听器记录摘要不残留型号");
  const tableLines = withAid.split("\n").filter((l) => l.startsWith("|"));
  const colCount = (l: string) => l.split("|").length - 2;
  check(
    tableLines.every((l) => colCount(l) === 7),
    `单条摘要每只耳的测听表均为 7 列（实际：${[...new Set(tableLines.map(colCount))].join(",")}）`,
  );
  // 缺失 WRS 不出现 “—%”
  check(!withAid.includes("—%"), "单条摘要缺失言语识别率显示为 — 而非 —%");
  check(/言语识别率（WRS）：\*\*80%\*\*/.test(withAid) && /言语识别率（WRS）：\*\*—\*\*/.test(withAid), "单条摘要 WRS 有值带 %、缺失为 —");

  const batch = batchSummary([existing], new Map([["P-1", dupPatient]]), "近 14 天 / 全部");
  check(batch.includes("批量摘要") && batch.includes("测试人"), "批量摘要含筛选描述与患者");
  check(batch.includes("80%/—") && !batch.includes("—%"), "批量摘要缺失一侧 WRS 显示为 — 而非空值加百分号");

  // 两侧 WRS 都缺失的记录
  const noWrs = encounterSummary({ ...existing, wrs: { left: "", right: "" } }, dupPatient);
  check(!noWrs.includes("—%"), "双耳 WRS 均缺失时不出现 —%");
  const noWrsBatch = batchSummary(
    [{ ...existing, wrs: { left: "", right: "" } }],
    new Map([["P-1", dupPatient]]),
    "x",
  );
  check(noWrsBatch.includes("—/—"), "批量摘要双耳 WRS 缺失显示 —/—");
}


// ---------- DOM 集成测试（每个场景独立隔离） ----------
const SESSION_KEY = "hxwl-audiology-workbench:session";

const downloads: { name: string; blob: Blob }[] = [];
let capturedBlob: Blob | undefined;

async function lastDownloadText(): Promise<string> {
  const d = downloads[downloads.length - 1];
  return (await d.blob.text()).replace(/^﻿/, "");
}

/** 跟踪测试期间产生的定时器，场景结束时清掉，避免 toast 自动消失在场景外触发 setState */
function patchTimers() {
  const nativeSetTimeout = window.setTimeout as (handler: TimerHandler, timeout?: number) => number;
  const handles = new Set<number>();
  window.setTimeout = ((handler: TimerHandler, timeout?: number) => {
    const h = nativeSetTimeout(handler, timeout);
    handles.add(h);
    return h;
  }) as unknown as typeof window.setTimeout;
  return () => {
    handles.forEach((h) => clearTimeout(h));
    handles.clear();
    window.setTimeout = nativeSetTimeout as unknown as typeof window.setTimeout;
  };
}

interface Harness {
  container: HTMLElement;
  $: (sel: string, root?: ParentNode) => Element | null;
  $$: (sel: string, root?: ParentNode) => Element[];
  button: (text: string) => HTMLButtonElement;
  set: (el: Element, value: string) => void;
  thresholdInputs: (modal: Element) => { air: Element[]; bone: Element[] };
}

async function setupScenario(): Promise<{ harness: Harness; teardown: () => Promise<void> }> {
  // 数据与会话隔离：重置演示数据、清空登录态
  store.resetToSeed();
  window.localStorage.removeItem(SESSION_KEY);
  downloads.length = 0;
  capturedBlob = undefined;

  const container = document.createElement("div");
  document.body.innerHTML = "";
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(<App />);
  });

  const restoreTimers = patchTimers();

  const scoped$ = (sel: string, root: ParentNode = container) => root.querySelector(sel);
  const scoped$$ = (sel: string, root: ParentNode = container) => Array.from(root.querySelectorAll(sel));
  const harness: Harness = {
    container,
    $: scoped$,
    $$: scoped$$,
    button(text) {
      const btn = scoped$$("button").find((b) =>
        (b.textContent ?? "").replace(/\s+/g, "").includes(text.replace(/\s+/g, "")),
      );
      if (!btn) throw new Error(`找不到按钮：${text}`);
      return btn as HTMLButtonElement;
    },
    set(el, value) {
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
    },
    thresholdInputs(m) {
      const t = scoped$$(".threshold-table", m);
      return {
        air: scoped$$("tbody tr", t[0]).flatMap((tr) => Array.from(tr.querySelectorAll("input"))),
        bone: scoped$$("tbody tr", t[1]).flatMap((tr) => Array.from(tr.querySelectorAll("input"))),
      };
    },
  };

  const teardown = async () => {
    restoreTimers(); // 先清掉所有挂起的 toast 定时器
    await act(async () => {
      root.unmount();
    });
    container.remove();
  };

  return { harness, teardown };
}

// ----- 场景 1：患者档案的新增成功、不完整与重复拦截 -----
async function patientScenario() {
  const { harness: h, teardown } = await setupScenario();
  try {
    // 不完整提交
    h.button("新增患者档案").click();
    await act(async () => {});
    h.button("保存档案").click();
    await act(async () => {});
    let alertText = h.$$(".alert-error").pop()?.textContent ?? "";
    check(alertText.includes("姓名不能为空"), `空档案提交显示明确错误（实际：${alertText}）`);
    check((h.$$(".field-error")[0]?.textContent ?? "").includes("姓名不能为空"), "字段级提示「姓名不能为空」");

    // 姓名太短
    h.set(h.$$(".modal .field input")[0], "张");
    h.button("保存档案").click();
    await act(async () => {});
    check((h.$$(".field-error")[0]?.textContent ?? "").includes("至少 2 个字符"), "单字姓名给出长度错误");

    // 完整档案保存
    h.set(h.$$(".modal .field input")[0], "张三");
    h.set(h.$$(".modal .field select")[0], "female");
    h.set(h.$$(".modal .field input").find((i) => (i as HTMLInputElement).type === "date")!, "1990-03-03");
    h.button("保存档案").click();
    await act(async () => {});
    check(h.container.querySelector(".toast-ok")?.textContent?.includes("张三") ?? false, "患者张三保存成功");
    check(store.getState().patients.length === 4, "store 患者数量变为 4");

    // 同名同出生日期重复建档
    h.button("新增患者档案").click();
    await act(async () => {});
    h.set(h.$$(".modal .field input")[0], "张三");
    h.set(h.$$(".modal .field select")[0], "female");
    h.set(h.$$(".modal .field input").find((i) => (i as HTMLInputElement).type === "date")!, "1990-03-03");
    h.button("保存档案").click();
    await act(async () => {});
    alertText = h.$$(".alert-error").pop()?.textContent ?? "";
    check(alertText.includes("重复建档"), `重复患者被拦截（实际：${alertText}）`);
    check(store.getState().patients.length === 4, "重复患者未写入");
    h.button("取消").click();
    await act(async () => {});
  } finally {
    await teardown();
  }
}

// ----- 场景 2：验配记录判重（完全相同拦截；骨导/WRS/助听器变化放行） -----
async function duplicateScenario() {
  const { harness: h, teardown } = await setupScenario();
  try {
    h.set(h.$(".name-input")!, "王听力");

    // 不完整提交
    h.button("新增验配记录").click();
    await act(async () => {});
    h.button("保存验配记录").click();
    await act(async () => {});
    const alertEmpty = h.$$(".alert-error")[0]?.textContent ?? "";
    check(alertEmpty.includes("记录无法保存"), `空记录提交显示明确错误（实际：${alertEmpty}）`);
    check(h.$$(".threshold-input.invalid").length > 0, "未填必填阈值格标红");

    const fill = (variant: "base" | "bone" | "wrs" | "aid") => {
      const m = h.$$(".modal").pop()!;
      const sel = h.$$("select", m);
      h.set(sel[0], store.getState().patients[0].id);
      h.set(sel[1], "initial");
      const { air, bone } = h.thresholdInputs(m);
      [40, 42, 45, 50, 55, 60].forEach((v, i) => h.set(air[i], String(v)));
      [35, 40, 44, 48, 52, 58].forEach((v, i) => h.set(air[6 + i], String(v)));
      const boneR = variant === "bone" ? [30, 35, 40, 42] : [40, 45, 48, 50];
      const boneL = variant === "bone" ? [28, 33, 38, 42] : [35, 40, 44, 48];
      boneR.forEach((v, i) => h.set(bone[i], String(v)));
      boneL.forEach((v, i) => h.set(bone[4 + i], String(v)));
      h.set(h.$$(".wrs-row input", m)[0], variant === "wrs" ? "91" : "80");
      const ai = h.$$(".aids-list input", m);
      h.set(ai[0], variant === "aid" ? "Another Aid" : "Test Aid Pro");
      h.set(ai.find((i) => (i as HTMLInputElement).type === "number")!, variant === "aid" ? "1" : "3");
      return m;
    };
    const openForm = async () => {
      h.button("新增验配记录").click();
      await act(async () => {});
    };
    const submit = async () => {
      h.button("保存验配记录").click();
      await act(async () => {});
    };

    // 基础记录
    fill("base");
    await submit();
    check(store.getState().encounters.length === 4, "基础验配记录保存成功（4 条）");
    const saved = store.getState().encounters[0];
    check(
      saved.aids[0].model === "Test Aid Pro" && saved.aids[0].gainDb === 3 && saved.wrs.left === 80,
      "保存内容含型号/增益/WRS",
    );

    // 完全相同 → 拦截
    await openForm();
    fill("base");
    await submit();
    const dupAlert = h.$$(".alert-error")[0]?.textContent ?? "";
    check(dupAlert.includes("重复记录"), `完全相同记录被拦截（实际：${dupAlert}）`);
    check(store.getState().encounters.length === 4, "完全相同记录未写入");
    h.button("取消").click();
    await act(async () => {});

    // 三种变体 → 放行
    const variants: ["bone" | "wrs" | "aid", string][] = [
      ["bone", "骨导变化可保存"],
      ["wrs", "言语识别率变化可保存"],
      ["aid", "助听器变化可保存"],
    ];
    let count = 4;
    for (const [v, label] of variants) {
      await openForm();
      fill(v);
      await submit();
      count += 1;
      check(store.getState().encounters.length === count && !h.$$(".alert-error")[0], label);
    }
  } finally {
    await teardown();
  }
}

// ----- 场景 3：筛选、查看与导出（列对齐、缺失值） -----
async function filterExportScenario() {
  const { harness: h, teardown } = await setupScenario();
  try {
    const rows = () => h.$$(".record-table tbody tr");
    const chip = (label: string) =>
      h.$$(".chip-group button").find((b) => b.textContent?.trim() === label) as HTMLButtonElement;

    check(rows().length === 3, `近期记录默认 3 条（实际 ${rows().length}）`);
    chip("初配").click();
    await act(async () => {});
    check(rows().length === 1 && rows()[0].textContent?.includes("刘敏"), "分类筛选「初配」命中刘敏");
    chip("全部").click();
    await act(async () => {});

    h.set(h.$$(".toolbar select")[0], "followup");
    check(rows().length === 1 && rows()[0].textContent?.includes("赵兰英"), "角色筛选「复诊助理」命中赵兰英");
    h.set(h.$$(".toolbar select")[0], "");

    h.set(h.$(".filter-search input")!, "Phonak");
    check(rows().length === 1, "搜索 Phonak 命中 1 条");
    h.set(h.$(".filter-search input")!, "不存在的型号zzzz");
    h.button("导出筛选结果").click();
    await act(async () => {});
    check(h.$(".toast-err")?.textContent?.includes("为空") ?? false, "空结果导出给出错误提示");
    h.set(h.$(".filter-search input")!, "");

    // 批量导出：8 列对齐
    h.button("导出筛选结果").click();
    await act(async () => {});
    check(downloads.length === 1 && downloads[0].name.endsWith(".md"), "批量导出触发 .md 下载");
    const batchMd = await lastDownloadText();
    const batchLines = batchMd.split("\n").filter((l) => l.startsWith("|"));
    check(batchLines.every((l) => l.split("|").length - 2 === 8), "批量摘要表格全部 8 列对齐");
    check(batchMd.includes("96%/84%"), "批量摘要正常显示双耳 WRS 百分比");

    // 详情 + 单条导出：7 列对齐
    (rows()[0].querySelector(".link-btn") as HTMLButtonElement).click();
    await act(async () => {});
    const detail = h.$$(".modal").pop()!;
    check(!!h.$(".audiogram", detail), "详情显示听力图");
    check(h.$$(".metric-box", detail).length === 4, "详情显示 4 个指标");
    (h.$$("button", detail).find((b) => b.textContent?.includes("导出 Markdown 摘要")) as HTMLButtonElement).click();
    await act(async () => {});
    const oneMd = await lastDownloadText();
    const oneLines = oneMd.split("\n").filter((l) => l.startsWith("|"));
    check(oneLines.every((l) => l.split("|").length - 2 === 7), "单条摘要测听表全部 7 列对齐（含骨导行）");
    check(oneMd.includes("言语识别率"), "单条摘要含言语识别率段落");
  } finally {
    await teardown();
  }
}

// ----- 场景 4：复诊助理权限与未署名拦截 -----
async function roleScenario() {
  const { harness: h, teardown } = await setupScenario();
  try {
    // 未填记录人姓名 → 拦截
    h.button("新增验配记录").click();
    await act(async () => {});
    check(h.$(".toast-err")?.textContent?.includes("记录人姓名") ?? false, "未署名时新增被拦截");

    h.set(h.$(".name-input")!, "李助理");
    // 切换复诊助理
    (h.$$(".role-switch button")[1] as HTMLButtonElement).click();
    await act(async () => {});
    check(
      !h.$$("button").some((b) => b.textContent?.includes("新增患者档案")),
      "复诊助理视图无「新增患者档案」入口",
    );
    h.button("新增验配记录").click();
    await act(async () => {});
    const m = h.$$(".modal").pop()!;
    const cat = h.$$("select", m)[1] as HTMLSelectElement;
    check(cat.disabled && cat.value === "followup", "复诊助理分类锁定为「复诊」");

    const sel = h.$$("select", m);
    h.set(sel[0], store.getState().patients[2].id);
    const { air, bone } = h.thresholdInputs(m);
    [30, 32, 35, 40, 45, 50].forEach((v, i) => h.set(air[i], String(v)));
    [25, 30, 34, 38, 42, 48].forEach((v, i) => h.set(air[6 + i], String(v)));
    [30, 35, 38].forEach((v, i) => h.set(bone[i], String(v)));
    [25, 30, 34].forEach((v, i) => h.set(bone[4 + i], String(v)));
    h.set(h.$$(".wrs-row input", m)[0], "88");
    const ai = h.$$(".aids-list input", m);
    h.set(ai[0], "Followup Aid X");
    h.set(ai.find((i) => (i as HTMLInputElement).type === "number")!, "-1");
    h.button("保存验配记录").click();
    await act(async () => {});
    const rec = store.getState().encounters[0];
    check(
      rec.operatorRole === ("followup" as Role) && rec.category === "followup",
      "复诊记录标记为复诊角色与复诊分类",
    );
    check(rec.aids[0].gainDb === -1, "复诊记录保存负增益调整");
  } finally {
    await teardown();
  }
}

async function main() {
  // 捕获“下载”：记录 Blob，不触发真实导航
  window.HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement) {
    if (capturedBlob) downloads.push({ name: this.download, blob: capturedBlob });
  };
  window.URL.createObjectURL = ((blob: Blob) => {
    capturedBlob = blob;
    return "blob:mock";
  }) as typeof window.URL.createObjectURL;
  window.URL.revokeObjectURL = () => {};

  // 所有 DOM click 在 act 内执行，同步刷新 React 状态
  const nativeClick = window.HTMLElement.prototype.click;
  window.HTMLElement.prototype.click = function (this: HTMLElement) {
    act(() => {
      nativeClick.call(this);
    });
  };

  // 收集意外的 React act 警告，任一出现即判失败
  const actWarnings: string[] = [];
  const origConsoleError = console.error;
  console.error = (...args: unknown[]) => {
    const msg = args.map(String).join(" ");
    if (msg.includes("not wrapped in act")) actWarnings.push(msg);
    origConsoleError.apply(console, args);
  };

  console.log("== 纯逻辑单元测试 ==");
  unitTests();

  console.log("\n== jsdom 集成测试（场景隔离） ==");
  const scenarios: [string, () => Promise<void>][] = [
    ["患者档案", patientScenario],
    ["验配判重", duplicateScenario],
    ["筛选与导出", filterExportScenario],
    ["角色权限", roleScenario],
  ];
  for (const [name, fn] of scenarios) {
    console.log(`\n-- 场景：${name} --`);
    await fn();
    await new Promise((r) => setTimeout(r, 0));
  }

  console.error = origConsoleError;
  check(actWarnings.length === 0, `无状态更新脱离 act 的警告（实际 ${actWarnings.length} 条）`);
  console.log(`\n全部通过：${passed} 个断言`);
}

main().catch((err) => {
  console.error("\n测试失败：", err);
  process.exit(1);
});
