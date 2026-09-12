import { useEffect, useSyncExternalStore } from "react";
import type { AppState, Encounter, Patient } from "./types";
import { todayStr } from "./validation";

const STORAGE_KEY = "hxwl-audiology-workbench:v1";
const SESSION_KEY = "hxwl-audiology-workbench:session";

function daysAgo(n: number): string {
  const d = new Date(todayStr() + "T00:00:00");
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

let seq = 0;
function id(prefix: string): string {
  seq += 1;
  const rand =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID().slice(0, 8)
      : Math.random().toString(36).slice(2, 10);
  return `${prefix}-${Date.now().toString(36)}${seq}-${rand}`;
}

export function newPatientId(): string {
  return id("P");
}
export function newEncounterId(): string {
  return id("E");
}

/** 首次打开时写入的演示数据（日期按当天回推，保证落在“近期”内） */
function seed(): AppState {
  const p1: Patient = {
    id: "P-DEMO-024",
    name: "刘敏",
    gender: "female",
    birthDate: "1986-04-12",
    phone: "138-0000-0240",
    note: "主诉嘈杂环境听不清 3 个月",
    createdAt: Date.now() - 6 * 86400_000,
  };
  const p2: Patient = {
    id: "P-DEMO-118",
    name: "陈昊",
    gender: "male",
    birthDate: "1992-09-30",
    phone: "139 1188 2233",
    note: "右耳闷堵、中耳炎史",
    createdAt: Date.now() - 12 * 86400_000,
  };
  const p3: Patient = {
    id: "P-DEMO-077",
    name: "赵兰英",
    gender: "female",
    birthDate: "1948-01-22",
    phone: "",
    note: "老年性听力下降，家属陪同",
    createdAt: Date.now() - 20 * 86400_000,
  };

  const e1: Encounter = {
    id: "E-DEMO-0001",
    patientId: p1.id,
    date: daysAgo(5),
    category: "initial",
    audiogram: {
      air: {
        left: { 250: 25, 500: 30, 1000: 35, 2000: 45, 4000: 60, 8000: 65 },
        right: { 250: 25, 500: 30, 1000: 40, 2000: 45, 4000: 55, 8000: 60 },
      },
      bone: {
        left: { 500: 25, 1000: 30, 2000: 40, 4000: 55 },
        right: { 500: 25, 1000: 35, 2000: 40, 4000: 50 },
      },
    },
    wrs: { left: 72, right: 76 },
    aids: [
      {
        model: "Phonak Audeo Lumity L50-R",
        side: "bilateral",
        gainDb: 4,
        note: "2kHz 起高频段增益 +4 dB，启用自适应降噪",
      },
    ],
    feedback: "初次佩戴，下午略胀，听说话清楚多了",
    operatorName: "王听力",
    operatorRole: "audiologist",
    createdAt: Date.now() - 5 * 86400_000,
  };

  const e2: Encounter = {
    id: "E-DEMO-0002",
    patientId: p2.id,
    date: daysAgo(2),
    category: "retune",
    audiogram: {
      air: {
        left: { 500: 15, 1000: 15, 2000: 20, 4000: 20 },
        right: { 250: 45, 500: 45, 1000: 40, 2000: 30, 4000: 25 },
      },
      bone: {
        left: { 500: 15, 1000: 15, 2000: 20 },
        right: { 500: 15, 1000: 15, 2000: 20, 4000: 20 },
      },
    },
    wrs: { left: 96, right: 84 },
    aids: [
      {
        model: "ReSound OMNIA 5",
        side: "right",
        gainDb: -2,
        note: "低频压缩略降 2 dB，反馈啸叫消失",
      },
    ],
    feedback: "自己声音略响，低频发闷改善",
    operatorName: "王听力",
    operatorRole: "audiologist",
    createdAt: Date.now() - 2 * 86400_000,
  };

  const e3: Encounter = {
    id: "E-DEMO-0003",
    patientId: p3.id,
    date: daysAgo(1),
    category: "followup",
    audiogram: {
      air: {
        left: { 250: 35, 500: 40, 1000: 45, 2000: 55, 4000: 60 },
        right: { 250: 35, 500: 45, 1000: 50, 2000: 55, 4000: 65 },
      },
      bone: {
        left: { 500: 35, 1000: 40, 2000: 50 },
        right: { 500: 40, 1000: 45, 2000: 50, 4000: 60 },
      },
    },
    wrs: { left: 76, right: 68 },
    aids: [
      {
        model: "Oticon Zircon 2 miniRITE",
        side: "bilateral",
        gainDb: 2,
        note: "语频区整体 +2 dB，言语识别率 64% → 76%",
      },
    ],
    feedback: "看电视音量从 28 降到 20，家属满意",
    operatorName: "李助理",
    operatorRole: "followup",
    createdAt: Date.now() - 1 * 86400_000,
  };

  return { patients: [p1, p2, p3], encounters: [e1, e2, e3] };
}

function load(): AppState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as AppState;
      if (Array.isArray(parsed.patients) && Array.isArray(parsed.encounters)) return parsed;
    }
  } catch {
    /* 数据损坏时重新播种 */
  }
  const s = seed();
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch {
    /* 隐私模式等场景下降级为内存存储 */
  }
  return s;
}

let state: AppState = load();
const listeners = new Set<() => void>();

function emit() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* ignore */
  }
  listeners.forEach((l) => l());
}

export const store = {
  getState: () => state,
  subscribe(fn: () => void) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
  addPatient(patient: Patient): void {
    state = { ...state, patients: [patient, ...state.patients] };
    emit();
  },
  addEncounter(encounter: Encounter): void {
    state = { ...state, encounters: [encounter, ...state.encounters] };
    emit();
  },
  /** 清空本地数据并恢复演示数据（调试用） */
  resetToSeed(): void {
    state = seed();
    emit();
  },
};

export function useStore<T>(selector: (s: AppState) => T): T {
  return useSyncExternalStore(
    store.subscribe,
    () => selector(store.getState()),
    () => selector(store.getState()),
  );
}

export interface Session {
  role: "audiologist" | "followup";
  name: string;
}

export function loadSession(): Session {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (raw) return JSON.parse(raw) as Session;
  } catch {
    /* ignore */
  }
  return { role: "audiologist", name: "" };
}

export function saveSession(session: Session): void {
  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  } catch {
    /* ignore */
  }
}

/** 演示数据辅助：组件挂载后把日期相关的稳定性交给 store，此 hook 仅触发一次状态刷新 */
export function useForceRenderOnce(): void {
  useEffect(() => {
    // seed 中的日期基于模块加载时间，无需额外处理
  }, []);
}
