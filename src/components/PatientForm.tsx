import { useState } from "react";
import { newPatientId, store } from "../store";
import type { Patient } from "../types";
import { validatePatient } from "../validation";

interface Props {
  onClose: () => void;
  onSaved: (patient: Patient) => void;
}

const empty = { name: "", gender: "" as Patient["gender"], birthDate: "", phone: "", note: "" };

export default function PatientForm({ onClose, onSaved }: Props) {
  const [form, setForm] = useState(empty);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [globalError, setGlobalError] = useState("");

  const set = (key: keyof typeof empty, value: string) => {
    setForm((f) => ({ ...f, [key]: value }));
    setErrors((e) => ({ ...e, [key]: "" }));
    setGlobalError("");
  };

  const submit = () => {
    if (submitting) return; // 防重复提交
    const errs = validatePatient(form, store.getState().patients);
    if (Object.keys(errs).length > 0) {
      setErrors(errs);
      setGlobalError(`档案无法保存：${Object.values(errs)[0]}`);
      return;
    }
    setSubmitting(true);
    const patient: Patient = {
      ...form,
      name: form.name.trim(),
      phone: form.phone.trim(),
      note: form.note.trim(),
      id: newPatientId(),
      createdAt: Date.now(),
    };
    store.addPatient(patient);
    setSubmitting(false);
    onSaved(patient);
  };

  return (
    <Modal title="新增患者档案" onClose={onClose} width="520px">
      {globalError && <div className="alert alert-error">{globalError}</div>}
      <div className="form-grid">
        <label className="field">
          <span>姓名 <i>*</i></span>
          <input
            className={errors.name ? "invalid" : ""}
            value={form.name}
            placeholder="如：刘敏"
            onChange={(e) => set("name", e.target.value)}
          />
          {errors.name && <em className="field-error">{errors.name}</em>}
        </label>
        <label className="field">
          <span>性别 <i>*</i></span>
          <select
            className={errors.gender ? "invalid" : ""}
            value={form.gender}
            onChange={(e) => set("gender", e.target.value)}
          >
            <option value="">请选择</option>
            <option value="female">女</option>
            <option value="male">男</option>
          </select>
          {errors.gender && <em className="field-error">{errors.gender}</em>}
        </label>
        <label className="field">
          <span>出生日期 <i>*</i></span>
          <input
            type="date"
            className={errors.birthDate ? "invalid" : ""}
            value={form.birthDate}
            onChange={(e) => set("birthDate", e.target.value)}
          />
          {errors.birthDate && <em className="field-error">{errors.birthDate}</em>}
        </label>
        <label className="field">
          <span>联系电话</span>
          <input
            className={errors.phone ? "invalid" : ""}
            value={form.phone}
            placeholder="选填"
            onChange={(e) => set("phone", e.target.value)}
          />
          {errors.phone && <em className="field-error">{errors.phone}</em>}
        </label>
        <label className="field field-full">
          <span>备注</span>
          <textarea
            rows={2}
            value={form.note}
            placeholder="主诉、病史等（选填）"
            onChange={(e) => set("note", e.target.value)}
          />
        </label>
      </div>
      <div className="modal-actions">
        <button className="btn" onClick={onClose} disabled={submitting}>取消</button>
        <button className="btn btn-primary" onClick={submit} disabled={submitting}>
          {submitting ? "保存中…" : "保存档案"}
        </button>
      </div>
    </Modal>
  );
}

export function Modal({
  title,
  children,
  onClose,
  width = "640px",
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
  width?: string;
}) {
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ width }} role="dialog" aria-modal="true" aria-label={title}>
        <header className="modal-header">
          <h2>{title}</h2>
          <button className="modal-close" onClick={onClose} aria-label="关闭">
            ×
          </button>
        </header>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}
