import {
  CATEGORY_LABEL,
  FIT_SIDE_LABEL,
  SIDE_LABEL,
  hearingLossLevel,
  pta,
  type Encounter,
  type Patient,
} from "../types";
import { downloadText, encounterSummary } from "../export";
import { Modal } from "./PatientForm";
import AudiogramChart from "./AudiogramChart";

interface Props {
  encounter: Encounter;
  patient: Patient | undefined;
  onClose: () => void;
}

function age(birthDate: string, onDate: string): string {
  const b = new Date(birthDate + "T00:00:00");
  const d = new Date(onDate + "T00:00:00");
  let a = d.getFullYear() - b.getFullYear();
  const m = d.getMonth() - b.getMonth();
  if (m < 0 || (m === 0 && d.getDate() < b.getDate())) a -= 1;
  return a >= 0 ? `${a}` : "—";
}

export default function EncounterDetail({ encounter: e, patient, onClose }: Props) {
  const exportOne = () => {
    if (!patient) return;
    downloadText(`验配摘要_${patient.name}_${e.date}.md`, encounterSummary(e, patient));
  };

  const ptaL = pta(e.audiogram.air.left);
  const ptaR = pta(e.audiogram.air.right);

  return (
    <Modal title="验配记录详情" onClose={onClose} width="860px">
      {!patient ? (
        <div className="alert alert-error">该记录关联的患者档案已不存在。</div>
      ) : (
        <>
          <div className="detail-head">
            <div>
              <h3>
                {patient.name}
                <span className="chip">{patient.gender === "male" ? "男" : "女"} · {age(patient.birthDate, e.date)} 岁</span>
                <span className="chip chip-category">{CATEGORY_LABEL[e.category]}</span>
              </h3>
              <p className="detail-meta">
                {e.date} · 档案 {patient.id}
                {patient.phone ? ` · ${patient.phone}` : ""} · 记录人：{e.operatorName}（
                {e.operatorRole === "audiologist" ? "听力师" : "复诊助理"}）
              </p>
            </div>
            <button className="btn btn-primary" onClick={exportOne}>
              ⬇ 导出 Markdown 摘要
            </button>
          </div>

          <div className="detail-grid">
            <div className="detail-chart">
              <AudiogramChart audiogram={e.audiogram} size="large" />
            </div>
            <div className="detail-metrics">
              <Metric label="左耳 PTA" value={ptaL === null ? "—" : `${ptaL} dB`} hint={hearingLossLevel(ptaL)} tone="blue" />
              <Metric label="右耳 PTA" value={ptaR === null ? "—" : `${ptaR} dB`} hint={hearingLossLevel(ptaR)} tone="red" />
              <Metric label="言语识别率 左" value={e.wrs.left === "" ? "—" : `${e.wrs.left}%`} tone="blue" />
              <Metric label="言语识别率 右" value={e.wrs.right === "" ? "—" : `${e.wrs.right}%`} tone="red" />
            </div>
          </div>

          <section className="detail-section">
            <h4>助听器与增益调整</h4>
            {e.aids.map((a, i) => (
              <div className="aid-card" key={i}>
                <div className="aid-card-head">
                  <strong>{a.model}</strong>
                  <span className="chip">{FIT_SIDE_LABEL[a.side]}</span>
                  <span className={`chip chip-gain ${Number(a.gainDb) > 0 ? "up" : Number(a.gainDb) < 0 ? "down" : ""}`}>
                    增益 {Number(a.gainDb) > 0 ? "+" : ""}{a.gainDb} dB
                  </span>
                </div>
                {a.note && <p>{a.note}</p>}
              </div>
            ))}
          </section>

          {e.feedback && (
            <section className="detail-section">
              <h4>用户反馈</h4>
              <p className="detail-feedback">{e.feedback}</p>
            </section>
          )}
          {patient.note && (
            <section className="detail-section">
              <h4>档案备注</h4>
              <p className="detail-feedback">{patient.note}</p>
            </section>
          )}
          <p className="detail-record-no">记录编号：{e.id} · {SIDE_LABEL.left} / {SIDE_LABEL.right}</p>
        </>
      )}
    </Modal>
  );
}

function Metric({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "blue" | "red";
}) {
  return (
    <div className={`metric-box ${tone ?? ""}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      {hint && <em>{hint}</em>}
    </div>
  );
}
