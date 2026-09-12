import {
  AIR_REQUIRED_FREQS,
  AIR_FREQS,
  BONE_FREQS,
  BONE_REQUIRED_FREQS,
  type AidFit,
  type Audiogram,
  type Category,
  type Encounter,
  type Patient,
  type Side,
} from "./types";

export type FieldErrors = Record<string, string>;

const PHONE_RE = /^[\d\s+-]{6,20}$/;

export function todayStr(): string {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

/** 患者档案校验 */
export function validatePatient(
  input: Omit<Patient, "id" | "createdAt">,
  patients: Patient[],
  selfId?: string,
): FieldErrors {
  const errors: FieldErrors = {};
  const name = input.name.trim();
  if (!name) {
    errors.name = "姓名不能为空";
  } else if (name.length < 2) {
    errors.name = "姓名至少 2 个字符";
  } else {
    const dup = patients.find(
      (p) => p.id !== selfId && p.name.trim() === name && p.birthDate === input.birthDate,
    );
    if (dup) errors.name = `已存在同名且出生日期相同的档案（${dup.id}），请勿重复建档`;
  }

  if (!input.gender) errors.gender = "请选择性别";

  if (!input.birthDate) {
    errors.birthDate = "请填写出生日期";
  } else if (!/^\d{4}-\d{2}-\d{2}$/.test(input.birthDate) || Number.isNaN(Date.parse(input.birthDate))) {
    errors.birthDate = "出生日期格式无效";
  } else {
    const birth = new Date(input.birthDate + "T00:00:00");
    const now = new Date(todayStr() + "T00:00:00");
    if (birth > now) errors.birthDate = "出生日期不能晚于今天";
    else if (now.getFullYear() - birth.getFullYear() > 120) errors.birthDate = "出生日期超出合理范围";
  }

  if (input.phone.trim() && !PHONE_RE.test(input.phone.trim())) {
    errors.phone = "电话格式无效（6-20 位数字，可含空格 + -）";
  }

  return errors;
}

function parseThreshold(raw: unknown): number | undefined {
  if (raw === "" || raw === null || raw === undefined) return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n)) return undefined;
  return n;
}

/**
 * 验配记录校验。
 * 规则：
 *  - 患者、日期、分类必选，日期不能晚于今天
 *  - 双耳 500/1000/2000/4000 气导必填；骨导 500/1000/2000 必填
 *  - 阈值必须为 -10~120 的整数（dB HL）
 *  - 骨导阈值不得显著高于同频率气导（气骨差 < -10 dB 视为录入错误）
 *  - 言语识别率至少一只耳填写，0-100 整数
 *  - 助听器至少 1 台：型号非空、增益为数值
 */
export function validateEncounter(
  input: {
    patientId: string;
    date: string;
    category: Category | "";
    audiogram: Audiogram;
    wrs: Record<Side, number | "">;
    aids: AidFit[];
  },
  patients: Patient[],
): FieldErrors {
  const errors: FieldErrors = {};

  if (!input.patientId) errors.patientId = "请选择患者";
  else if (!patients.some((p) => p.id === input.patientId)) errors.patientId = "所选患者不存在";

  if (!input.date) {
    errors.date = "请选择就诊日期";
  } else if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date) || Number.isNaN(Date.parse(input.date))) {
    errors.date = "日期格式无效";
  } else if (input.date > todayStr()) {
    errors.date = "就诊日期不能晚于今天";
  }

  if (!input.category) errors.category = "请选择记录分类";

  for (const side of ["left", "right"] as Side[]) {
    const sideLabel = side === "left" ? "左耳" : "右耳";

    for (const freq of AIR_FREQS) {
      const key = `air.${side}.${freq}`;
      const raw = input.audiogram.air[side][freq];
      const val = parseThreshold(raw);
      const required = (AIR_REQUIRED_FREQS as readonly number[]).includes(freq);
      if (val === undefined) {
        if (required) errors[key] = `${sideLabel} ${freq}Hz 气导必填`;
        continue;
      }
      if (!Number.isInteger(val) || val < -10 || val > 120) {
        errors[key] = `${sideLabel} ${freq}Hz 气导需为 -10~120 的整数`;
        continue;
      }
      const bone = parseThreshold(input.audiogram.bone[side][freq]);
      if (bone !== undefined && bone - val > 10) {
        errors[key] = `${sideLabel} ${freq}Hz：骨导(${bone})明显高于气导(${val})，请核对`;
      }
    }

    for (const freq of BONE_FREQS) {
      const key = `bone.${side}.${freq}`;
      const val = parseThreshold(input.audiogram.bone[side][freq]);
      const required = (BONE_REQUIRED_FREQS as readonly number[]).includes(freq);
      if (val === undefined) {
        if (required) errors[key] = `${sideLabel} ${freq}Hz 骨导必填`;
        continue;
      }
      if (!Number.isInteger(val) || val < -10 || val > 120) {
        errors[key] = `${sideLabel} ${freq}Hz 骨导需为 -10~120 的整数`;
      }
    }

    const wrsKey = `wrs.${side}`;
    const wrs = input.wrs[side];
    if (wrs !== "") {
      const n = Number(wrs);
      if (!Number.isInteger(n) || n < 0 || n > 100) {
        errors[wrsKey] = `${sideLabel}言语识别率需为 0-100 的整数`;
      }
    }
  }

  if (input.wrs.left === "" && input.wrs.right === "") {
    errors["wrs.left"] = "至少填写一只耳的言语识别率";
    errors["wrs.right"] = "至少填写一只耳的言语识别率";
  }

  if (input.aids.length === 0) {
    errors.aids = "请至少添加一台助听器";
  } else {
    input.aids.forEach((aid, i) => {
      if (!aid.model.trim()) errors[`aids.${i}.model`] = "请填写助听器型号";
      if (aid.gainDb === "" || !Number.isFinite(Number(aid.gainDb))) {
        errors[`aids.${i}.gainDb`] = "增益需为数值（dB）";
      } else {
        const g = Number(aid.gainDb);
        if (g < -20 || g > 40) errors[`aids.${i}.gainDb`] = "增益调整范围应在 -20~40 dB";
      }
    });
  }

  return errors;
}

/**
 * 重复提交检测：
 * 同一患者、同一天、同一分类，且气导核心频率阈值完全相同 → 视为重复记录。
 */
export function findDuplicateEncounter(
  input: Pick<Encounter, "patientId" | "date" | "category" | "audiogram">,
  encounters: Encounter[],
): Encounter | undefined {
  const signature = (a: Audiogram) =>
    JSON.stringify([
      ["left", "right"].map((s) => [500, 1000, 2000, 4000].map((f) => a.air[s as Side][f] ?? "")),
    ]);
  const sig = signature(input.audiogram);
  return encounters.find(
    (e) =>
      e.patientId === input.patientId &&
      e.date === input.date &&
      e.category === input.category &&
      signature(e.audiogram) === sig,
  );
}

/** 提交间隔内完全相同内容的二次提交拦截（防双击/重放） */
export function isResubmit(prev: { fingerprint: string; at: number } | null, fingerprint: string): boolean {
  return !!prev && prev.fingerprint === fingerprint && Date.now() - prev.at < 5000;
}
