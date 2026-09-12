// 听力验配记录工作台 —— 领域类型定义

export type Role = "audiologist" | "followup";

export const ROLE_LABEL: Record<Role, string> = {
  audiologist: "听力师",
  followup: "复诊助理",
};

export type Category = "initial" | "retune" | "followup" | "pediatric" | "elderly";

export const CATEGORY_LABEL: Record<Category, string> = {
  initial: "初配",
  retune: "复调",
  followup: "复诊",
  pediatric: "儿童",
  elderly: "老人",
};

// 分类与角色权限：听力师可录全部；复诊助理只能处理复诊相关记录
export const CATEGORIES_BY_ROLE: Record<Role, Category[]> = {
  audiologist: ["initial", "retune", "followup", "pediatric", "elderly"],
  followup: ["followup"],
};

export type Side = "left" | "right";

export const SIDE_LABEL: Record<Side, string> = {
  left: "左耳",
  right: "右耳",
};

// 气导频率：250 选填，500/1000/2000/4000 必填
export const AIR_FREQS = [250, 500, 1000, 2000, 4000, 8000] as const;
// 骨导频率：500/1000/2000 必填，4000 选填
export const BONE_FREQS = [500, 1000, 2000, 4000] as const;
export const AIR_REQUIRED_FREQS = [500, 1000, 2000, 4000] as const;
export const BONE_REQUIRED_FREQS = [500, 1000, 2000] as const;

export type ThresholdMap = Partial<Record<number, number>>;

export interface Audiogram {
  air: Record<Side, ThresholdMap>;
  bone: Record<Side, ThresholdMap>;
}

export interface AidFit {
  /** 助听器型号，如 "Phonak Audeo Lumity L50-R" */
  model: string;
  /** 验配耳 */
  side: Side | "bilateral";
  /** 增益调整（dB），可正可负 */
  gainDb: number | "";
  /** 增益调整频段/通道，如 "2kHz 起高频 +4" */
  note: string;
}

export const FIT_SIDE_LABEL: Record<AidFit["side"], string> = {
  left: "左耳",
  right: "右耳",
  bilateral: "双耳",
};

export interface Encounter {
  id: string;
  patientId: string;
  date: string; // YYYY-MM-DD
  category: Category;
  audiogram: Audiogram;
  /** 言语识别率（%），0-100 整数，至少一只耳必填 */
  wrs: Record<Side, number | "">;
  aids: AidFit[];
  /** 用户反馈 */
  feedback: string;
  /** 记录人姓名 */
  operatorName: string;
  /** 记录人角色 */
  operatorRole: Role;
  createdAt: number;
}

export interface Patient {
  id: string;
  name: string;
  gender: "male" | "female" | "";
  birthDate: string; // YYYY-MM-DD
  phone: string;
  note: string;
  createdAt: number;
}

export interface AppState {
  patients: Patient[];
  encounters: Encounter[];
}

/** 纯音平均听阈 PTA = 500/1000/2000 Hz 气导均值 */
export function pta(thresholds: ThresholdMap): number | null {
  const vals = [500, 1000, 2000].map((f) => thresholds[f]).filter((v): v is number => typeof v === "number");
  if (vals.length !== 3) return null;
  return Math.round(vals.reduce((a, b) => a + b, 0) / 3);
}

export function hearingLossLevel(db: number | null): string {
  if (db === null) return "—";
  if (db <= 25) return "正常";
  if (db <= 40) return "轻度";
  if (db <= 55) return "中度";
  if (db <= 70) return "中重度";
  if (db <= 90) return "重度";
  return "极重度";
}
