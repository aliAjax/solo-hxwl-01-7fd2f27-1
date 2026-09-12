import {
  CATEGORY_LABEL,
  FIT_SIDE_LABEL,
  SIDE_LABEL,
  hearingLossLevel,
  pta,
  type Encounter,
  type Patient,
} from "./types";

function fmt(v: unknown): string {
  return v === undefined || v === "" || v === null ? "—" : String(v);
}

function genderLabel(g: Patient["gender"]): string {
  return g === "male" ? "男" : g === "female" ? "女" : "—";
}

function age(birthDate: string, onDate: string): string {
  const b = new Date(birthDate + "T00:00:00");
  const d = new Date(onDate + "T00:00:00");
  let age = d.getFullYear() - b.getFullYear();
  const m = d.getMonth() - b.getMonth();
  if (m < 0 || (m === 0 && d.getDate() < b.getDate())) age -= 1;
  return age >= 0 && age < 130 ? `${age} 岁` : "—";
}

/** 单条验配记录的 Markdown 摘要 */
export function encounterSummary(e: Encounter, patient: Patient): string {
  const lines: string[] = [];
  lines.push(`# 听力验配记录摘要`);
  lines.push("");
  lines.push(`- **记录编号**：${e.id}`);
  lines.push(`- **患者**：${patient.name}（${genderLabel(patient.gender)}，${age(patient.birthDate, e.date)}）`);
  lines.push(`- **档案编号**：${patient.id}`);
  if (patient.phone) lines.push(`- **联系电话**：${patient.phone}`);
  lines.push(`- **就诊日期**：${e.date}`);
  lines.push(`- **记录分类**：${CATEGORY_LABEL[e.category]}`);
  lines.push(`- **记录人**：${e.operatorName || "未署名"}（${e.operatorRole === "audiologist" ? "听力师" : "复诊助理"}）`);
  lines.push("");

  lines.push(`## 纯音测听（dB HL）`);
  lines.push("");
  for (const side of ["left", "right"] as const) {
    const p = pta(e.audiogram.air[side]);
    lines.push(`### ${SIDE_LABEL[side]}（PTA ${p ?? "—"} dB HL · ${hearingLossLevel(p)}）`);
    lines.push("");
    lines.push("| 项目 | 250 | 500 | 1k | 2k | 4k | 8k |");
    lines.push("| --- | --- | --- | --- | --- | --- | --- |");
    lines.push(
      `| 气导 | ${[250, 500, 1000, 2000, 4000, 8000].map((f) => fmt(e.audiogram.air[side][f])).join(" | ")} |`,
    );
    lines.push(
      `| 骨导 | ${"—"} | ${[500, 1000, 2000, 4000].map((f) => fmt(e.audiogram.bone[side][f])).join(" | ")} | ${"—"} | ${"—"} |`,
    );
    lines.push("");
    lines.push(`- 言语识别率（WRS）：**${fmt(e.wrs[side] === "" ? undefined : e.wrs[side])}%**`);
    lines.push("");
  }

  lines.push(`## 助听器与增益调整`);
  lines.push("");
  e.aids.forEach((a, i) => {
    lines.push(`${i + 1}. **${a.model}**（${FIT_SIDE_LABEL[a.side]}），增益调整 **${a.gainDb} dB**`);
    if (a.note.trim()) lines.push(`   - ${a.note.trim()}`);
  });
  lines.push("");

  if (e.feedback.trim()) {
    lines.push(`## 用户反馈`);
    lines.push("");
    lines.push(e.feedback.trim());
    lines.push("");
  }
  if (patient.note.trim()) {
    lines.push(`## 档案备注`);
    lines.push("");
    lines.push(patient.note.trim());
    lines.push("");
  }
  return lines.join("\n");
}

/** 多条记录的批量摘要（筛选结果导出） */
export function batchSummary(
  encounters: Encounter[],
  patientMap: Map<string, Patient>,
  filterDesc: string,
): string {
  const lines: string[] = [];
  lines.push("# 听力验配记录批量摘要");
  lines.push("");
  lines.push(`- 导出时间：${new Date().toLocaleString("zh-CN")}`);
  lines.push(`- 筛选条件：${filterDesc}`);
  lines.push(`- 记录数量：${encounters.length} 条`);
  lines.push("");
  lines.push("| 日期 | 患者 | 分类 | 左 PTA | 右 PTA | WRS(左/右) | 助听器型号 | 记录人 |");
  lines.push("| --- | --- | --- | --- | --- | --- | --- | --- |");
  for (const e of encounters) {
    const p = patientMap.get(e.patientId);
    lines.push(
      `| ${e.date} | ${p ? p.name : "（已删除档案）"} | ${CATEGORY_LABEL[e.category]} | ${
        fmt(pta(e.audiogram.air.left))
      } | ${fmt(pta(e.audiogram.air.right))} | ${fmt(e.wrs.left === "" ? undefined : e.wrs.left)}%/${
        fmt(e.wrs.right === "" ? undefined : e.wrs.right)
      }% | ${e.aids.map((a) => a.model).join("；") || "—"} | ${e.operatorName || "未署名"} |`,
    );
  }
  lines.push("");
  return lines.join("\n");
}

/** 触发浏览器下载（Markdown / CSV 均走这里） */
export function downloadText(filename: string, content: string, mime = "text/markdown;charset=utf-8"): void {
  const blob = new Blob(["﻿" + content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
