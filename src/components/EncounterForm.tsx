import { useMemo, useRef, useState } from "react";
import { newEncounterId, store } from "../store";
import {
  AIR_FREQS,
  AIR_REQUIRED_FREQS,
  BONE_FREQS,
  BONE_REQUIRED_FREQS,
  CATEGORIES_BY_ROLE,
  CATEGORY_LABEL,
  FIT_SIDE_LABEL,
  type AidFit,
  type Category,
  type Encounter,
  type Patient,
  type Role,
  type Side,
} from "../types";
import {
  findDuplicateEncounter,
  isResubmit,
  todayStr,
  validateEncounter,
  type FieldErrors,
} from "../validation";
import { Modal } from "./PatientForm";

interface Props {
  role: Role;
  operatorName: string;
  patients: Patient[];
  presetPatientId?: string;
  onClose: () => void;
  onSaved: (encounter: Encounter) => void;
}

interface DraftAudiogram {
  air: Record<Side, Record<number, string>>;
  bone: Record<Side, Record<number, string>>;
}

function emptyThresholds(freqs: readonly number[]): Record<number, string> {
  return Object.fromEntries(freqs.map((f) => [f, ""]));
}

export default function EncounterForm({
  role,
  operatorName,
  patients,
  presetPatientId,
  onClose,
  onSaved,
}: Props) {
  const allowedCategories = CATEGORIES_BY_ROLE[role];

  const [patientId, setPatientId] = useState(presetPatientId ?? "");
  const [date, setDate] = useState(todayStr());
  const [category, setCategory] = useState<Category | "">(
    role === "followup" ? "followup" : "",
  );
  const [audiogram, setAudiogram] = useState<DraftAudiogram>({
    air: { left: emptyThresholds(AIR_FREQS), right: emptyThresholds(AIR_FREQS) },
    bone: { left: emptyThresholds(BONE_FREQS), right: emptyThresholds(BONE_FREQS) },
  });
  const [wrs, setWrs] = useState<Record<Side, string>>({ left: "", right: "" });
  const [aids, setAids] = useState<AidFit[]>([
    { model: "", side: role === "followup" ? "bilateral" : "bilateral", gainDb: "", note: "" },
  ]);
  const [feedback, setFeedback] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [globalError, setGlobalError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const lastSubmit = useRef<{ fingerprint: string; at: number } | null>(null);

  const selectedPatient = useMemo(() => patients.find((p) => p.id === patientId), [patients, patientId]);

  const setThreshold = (kind: "air" | "bone", side: Side, freq: number, value: string) => {
    setAudiogram((a) => ({
      ...a,
      [kind]: { ...a[kind], [side]: { ...a[kind][side], [freq]: value } },
    }));
    setErrors((e) => {
      const next = { ...e };
      delete next[`${kind}.${side}.${freq}`];
      return next;
    });
    setGlobalError("");
  };

  const updateAid = (i: number, patch: Partial<AidFit>) => {
    setAids((list) => list.map((a, idx) => (idx === i ? { ...a, ...patch } : a)));
    setErrors((e) => {
      const next = { ...e };
      delete next[`aids.${i}.model`];
      delete next[`aids.${i}.gainDb`];
      return next;
    });
  };

  const submit = () => {
    if (submitting) return; // 防双击重复提交

    if (!operatorName.trim()) {
      setGlobalError("请先在顶部填写记录人姓名再提交。");
      return;
    }

    const normalized = {
      air: {
        left: normalizeMap(audiogram.air.left),
        right: normalizeMap(audiogram.air.right),
      },
      bone: {
        left: normalizeMap(audiogram.bone.left),
        right: normalizeMap(audiogram.bone.right),
      },
    };
    const wrsNum: Record<Side, number | ""> = {
      left: wrs.left === "" ? "" : Number(wrs.left),
      right: wrs.right === "" ? "" : Number(wrs.right),
    };
    const payload = {
      patientId,
      date,
      category,
      audiogram: normalized,
      wrs: wrsNum,
      aids: aids.map((a) => ({ ...a, model: a.model.trim(), note: a.note.trim() })),
    };

    const errs = validateEncounter(payload, store.getState().patients);
    if (Object.keys(errs).length > 0) {
      setErrors(errs);
      setGlobalError(`记录无法保存：${Object.values(errs)[0]}（必填项带 *，请对照红色提示逐项核对）`);
      return;
    }

    const fingerprint = JSON.stringify(payload);
    if (isResubmit(lastSubmit.current, fingerprint)) {
      setGlobalError("检测到重复提交：内容与上一次完全相同且间隔过短，请勿连续点击或重复提交。");
      return;
    }

    const dup = findDuplicateEncounter(
      {
        patientId: payload.patientId,
        date: payload.date,
        category: payload.category as Category,
        audiogram: normalized,
        wrs: wrsNum,
        aids: payload.aids,
      },
      store.getState().encounters,
    );
    if (dup) {
      setGlobalError(
        `重复记录：该患者 ${payload.date} 的「${CATEGORY_LABEL[payload.category as Category]}」已存在气导/骨导/言语识别率/助听器完全相同的记录（${dup.id}）。`,
      );
      return;
    }

    setSubmitting(true);
    lastSubmit.current = { fingerprint, at: Date.now() };
    const encounter: Encounter = {
      id: newEncounterId(),
      ...payload,
      category: payload.category as Category,
      feedback: feedback.trim(),
      operatorName: operatorName.trim(),
      operatorRole: role,
      createdAt: Date.now(),
    };
    store.addEncounter(encounter);
    setSubmitting(false);
    onSaved(encounter);
  };

  return (
    <Modal title="新增听力验配记录" onClose={onClose} width="960px">
      {globalError && <div className="alert alert-error">{globalError}</div>}

      <section className="form-section">
        <h3>基本信息</h3>
        <div className="form-grid">
          <label className="field">
            <span>患者 <i>*</i></span>
            <select
              className={errors.patientId ? "invalid" : ""}
              value={patientId}
              disabled={!!presetPatientId}
              onChange={(e) => {
                setPatientId(e.target.value);
                setErrors((x) => ({ ...x, patientId: "" }));
              }}
            >
              <option value="">请选择患者</option>
              {patients.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}（{p.id}）
                </option>
              ))}
            </select>
            {errors.patientId && <em className="field-error">{errors.patientId}</em>}
          </label>
          <label className="field">
            <span>就诊日期 <i>*</i></span>
            <input
              type="date"
              max={todayStr()}
              className={errors.date ? "invalid" : ""}
              value={date}
              onChange={(e) => {
                setDate(e.target.value);
                setErrors((x) => ({ ...x, date: "" }));
              }}
            />
            {errors.date && <em className="field-error">{errors.date}</em>}
          </label>
          <label className="field">
            <span>分类 <i>*</i></span>
            <select
              className={errors.category ? "invalid" : ""}
              value={category}
              disabled={role === "followup"}
              onChange={(e) => {
                setCategory(e.target.value as Category);
                setErrors((x) => ({ ...x, category: "" }));
              }}
            >
              <option value="">请选择</option>
              {allowedCategories.map((c) => (
                <option key={c} value={c}>
                  {CATEGORY_LABEL[c]}
                </option>
              ))}
            </select>
            {errors.category && <em className="field-error">{errors.category}</em>}
            {role === "followup" && <small className="field-hint">复诊助理仅可录入「复诊」记录</small>}
          </label>
        </div>
        {selectedPatient && (
          <p className="patient-inline-hint">
            当前患者：{selectedPatient.name}
            {selectedPatient.phone ? ` · ${selectedPatient.phone}` : ""}
            {selectedPatient.note ? ` · ${selectedPatient.note}` : ""}
          </p>
        )}
      </section>

      <section className="form-section">
        <h3>纯音测听（dB HL）<em className="section-hint">500/1k/2k/4k 气导与 500/1k/2k 骨导为必填</em></h3>
        <div className="audiogram-input">
          <ThresholdTable
            title="气导"
            freqs={AIR_FREQS}
            requiredFreqs={AIR_REQUIRED_FREQS}
            values={audiogram.air}
            errors={errors}
            kind="air"
            onChange={setThreshold}
          />
          <ThresholdTable
            title="骨导"
            freqs={BONE_FREQS}
            requiredFreqs={BONE_REQUIRED_FREQS}
            values={audiogram.bone}
            errors={errors}
            kind="bone"
            onChange={setThreshold}
          />
        </div>
        <div className="wrs-row">
          {(["left", "right"] as Side[]).map((side) => (
            <label className="field" key={side} style={{ maxWidth: 220 }}>
              <span>
                {side === "left" ? "左耳" : "右耳"}言语识别率 WRS（%）
                {side === "left" && <i> *</i>}
              </span>
              <input
                inputMode="numeric"
                className={errors[`wrs.${side}`] ? "invalid" : ""}
                value={wrs[side]}
                placeholder="0-100，至少填一侧"
                onChange={(e) => {
                  setWrs((w) => ({ ...w, [side]: e.target.value }));
                  setErrors((x) => {
                    const n = { ...x };
                    delete n["wrs.left"];
                    delete n["wrs.right"];
                    return n;
                  });
                }}
              />
              {errors[`wrs.${side}`] && <em className="field-error">{errors[`wrs.${side}`]}</em>}
            </label>
          ))}
        </div>
      </section>

      <section className="form-section">
        <h3>助听器型号与增益调整</h3>
        {errors.aids && <div className="alert alert-error">{errors.aids}</div>}
        <div className="aids-list">
          {aids.map((aid, i) => (
            <div className="aid-row" key={i}>
              <label className="field">
                <span>型号 <i>*</i></span>
                <input
                  className={errors[`aids.${i}.model`] ? "invalid" : ""}
                  value={aid.model}
                  placeholder="如：Phonak Audeo Lumity L50-R"
                  onChange={(e) => updateAid(i, { model: e.target.value })}
                />
                {errors[`aids.${i}.model`] && <em className="field-error">{errors[`aids.${i}.model`]}</em>}
              </label>
              <label className="field field-narrow">
                <span>验配耳</span>
                <select value={aid.side} onChange={(e) => updateAid(i, { side: e.target.value as AidFit["side"] })}>
                  {(["bilateral", "left", "right"] as const).map((s) => (
                    <option key={s} value={s}>{FIT_SIDE_LABEL[s]}</option>
                  ))}
                </select>
              </label>
              <label className="field field-narrow">
                <span>增益 dB <i>*</i></span>
                <input
                  type="number"
                  className={errors[`aids.${i}.gainDb`] ? "invalid" : ""}
                  value={aid.gainDb}
                  placeholder="-20~40"
                  onChange={(e) =>
                    updateAid(i, { gainDb: e.target.value === "" ? "" : Number(e.target.value) })
                  }
                />
                {errors[`aids.${i}.gainDb`] && (
                  <em className="field-error">{errors[`aids.${i}.gainDb`]}</em>
                )}
              </label>
              <label className="field field-grow">
                <span>调整说明</span>
                <input
                  value={aid.note}
                  placeholder="如：2kHz 起高频 +4 dB"
                  onChange={(e) => updateAid(i, { note: e.target.value })}
                />
              </label>
              <button
                type="button"
                className="btn btn-ghost aid-remove"
                disabled={aids.length === 1}
                onClick={() => setAids((list) => list.filter((_, idx) => idx !== i))}
              >
                删除
              </button>
            </div>
          ))}
        </div>
        <button type="button" className="btn btn-ghost" onClick={() =>
          setAids((list) => [...list, { model: "", side: "bilateral", gainDb: "", note: "" }])
        }>
          + 添加一台助听器
        </button>
      </section>

      <section className="form-section">
        <h3>用户反馈</h3>
        <textarea
          rows={2}
          value={feedback}
          placeholder="佩戴感受、啸叫/闷堵、家属观察等（选填）"
          onChange={(e) => setFeedback(e.target.value)}
        />
      </section>

      <div className="modal-actions">
        <button className="btn" onClick={onClose} disabled={submitting}>取消</button>
        <button className="btn btn-primary" onClick={submit} disabled={submitting}>
          {submitting ? "提交中…" : "保存验配记录"}
        </button>
      </div>
    </Modal>
  );
}

function normalizeMap(src: Record<number, string>): Partial<Record<number, number>> {
  const out: Partial<Record<number, number>> = {};
  for (const [k, v] of Object.entries(src)) {
    if (v !== "") out[Number(k)] = Number(v);
  }
  return out;
}

function ThresholdTable({
  title,
  freqs,
  requiredFreqs,
  values,
  errors,
  kind,
  onChange,
}: {
  title: string;
  freqs: readonly number[];
  requiredFreqs: readonly number[];
  values: Record<Side, Record<number, string>>;
  errors: FieldErrors;
  kind: "air" | "bone";
  onChange: (kind: "air" | "bone", side: Side, freq: number, value: string) => void;
}) {
  return (
    <div className="threshold-table-wrap">
      <table className="threshold-table">
        <thead>
          <tr>
            <th>{title}</th>
            {freqs.map((f) => (
              <th key={f}>
                {f >= 1000 ? `${f / 1000}k` : f}Hz
                {requiredFreqs.includes(f as never) && <i> *</i>}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {(["right", "left"] as Side[]).map((side) => (
            <tr key={side}>
              <th>{side === "left" ? "左耳" : "右耳"}</th>
              {freqs.map((f) => {
                const key = `${kind}.${side}.${f}`;
                return (
                  <td key={f}>
                    <input
                      inputMode="numeric"
                      className={`threshold-input ${errors[key] ? "invalid" : ""}`}
                      value={values[side][f]}
                      onChange={(e) => onChange(kind, side, f, e.target.value.replace(/[^\d-]/g, ""))}
                    />
                    {errors[key] && (
                      <em className="field-error threshold-error" title={errors[key]}>!</em>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
