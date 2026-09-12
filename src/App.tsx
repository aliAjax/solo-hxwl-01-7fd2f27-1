import { useMemo, useState } from "react";
import {
  loadSession,
  saveSession,
  store,
  useStore,
} from "./store";
import {
  CATEGORY_LABEL,
  ROLE_LABEL,
  hearingLossLevel,
  pta,
  type Category,
  type Encounter,
  type Patient,
  type Role,
} from "./types";
import { batchSummary, downloadText } from "./export";
import { todayStr } from "./validation";
import PatientForm from "./components/PatientForm";
import EncounterForm from "./components/EncounterForm";
import EncounterDetail from "./components/EncounterDetail";
import "./styles.css";

type ViewTab = "recent" | "all" | "patients";

const CATEGORY_FILTERS: (Category | "")[] = ["", "initial", "retune", "followup", "pediatric", "elderly"];

function daysBetween(a: string, b: string): number {
  return Math.round((new Date(b + "T00:00:00").getTime() - new Date(a + "T00:00:00").getTime()) / 86400_000);
}

export default function App() {
  const patients = useStore((s) => s.patients);
  const encounters = useStore((s) => s.encounters);

  const [session, setSession] = useState(loadSession);
  const [tab, setTab] = useState<ViewTab>("recent");
  const [categoryFilter, setCategoryFilter] = useState<Category | "">("");
  const [roleFilter, setRoleFilter] = useState<Role | "">("");
  const [query, setQuery] = useState("");
  const [showPatientForm, setShowPatientForm] = useState(false);
  const [showEncounterForm, setShowEncounterForm] = useState(false);
  const [presetPatientId, setPresetPatientId] = useState<string | undefined>(undefined);
  const [openEncounter, setOpenEncounter] = useState<Encounter | null>(null);
  const [toast, setToast] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  const patientMap = useMemo(() => new Map(patients.map((p) => [p.id, p])), [patients]);

  const showToast = (kind: "ok" | "err", text: string) => {
    setToast({ kind, text });
    window.setTimeout(() => setToast(null), 4000);
  };

  const switchRole = (role: Role) => {
    const next = { ...session, role };
    setSession(next);
    saveSession(next);
  };
  const updateName = (name: string) => {
    const next = { ...session, name };
    setSession(next);
    saveSession(next);
  };

  const filtered = useMemo(() => {
    const q = query.trim();
    return encounters
      .filter((e) => {
        if (tab === "recent" && daysBetween(e.date, todayStr()) > 14) return false;
        if (categoryFilter && e.category !== categoryFilter) return false;
        if (roleFilter && e.operatorRole !== roleFilter) return false;
        if (q) {
          const p = patientMap.get(e.patientId);
          const hay = `${p?.name ?? ""} ${p?.id ?? ""} ${e.aids.map((a) => a.model).join(" ")} ${e.operatorName}`;
          return hay.toLowerCase().includes(q.toLowerCase());
        }
        return true;
      })
      .sort((a, b) => (a.date === b.date ? b.createdAt - a.createdAt : a.date < b.date ? 1 : -1));
  }, [encounters, tab, categoryFilter, roleFilter, query, patientMap]);

  const filterDescParts = [
    tab === "recent" ? "近 14 天" : "全部记录",
    categoryFilter ? CATEGORY_LABEL[categoryFilter] : "全部分类",
    roleFilter ? ROLE_LABEL[roleFilter] : "全部角色",
    query.trim() ? `搜索「${query.trim()}」` : null,
  ].filter(Boolean);

  const exportFiltered = () => {
    if (filtered.length === 0) {
      showToast("err", "当前筛选结果为空，没有可导出的记录。");
      return;
    }
    downloadText(
      `验配记录摘要_${todayStr()}.md`,
      batchSummary(filtered, patientMap, filterDescParts.join(" / ")),
    );
    showToast("ok", `已导出 ${filtered.length} 条记录摘要。`);
  };

  const openNewEncounter = (pid?: string) => {
    if (!session.name.trim()) {
      showToast("err", "请先在顶部填写记录人姓名，再新增记录。");
      return;
    }
    setPresetPatientId(pid);
    setShowEncounterForm(true);
  };

  const encountersByPatient = useMemo(() => {
    const map = new Map<string, Encounter[]>();
    for (const e of [...encounters].sort((a, b) => (a.date < b.date ? 1 : -1))) {
      const list = map.get(e.patientId) ?? [];
      list.push(e);
      map.set(e.patientId, list);
    }
    return map;
  }, [encounters]);

  const isFollowup = session.role === "followup";

  return (
    <div className="app">
      <header className="topbar">
        <div className="topbar-brand">
          <span className="logo">◐</span>
          <div>
            <h1>听力验配记录工作台</h1>
            <p>门店听力师与复诊助理 · 档案 / 测听 / 增益调整 / 复诊摘要</p>
          </div>
        </div>
        <div className="topbar-session">
          <div className="role-switch" role="group" aria-label="角色切换">
            {(Object.keys(ROLE_LABEL) as Role[]).map((r) => (
              <button
                key={r}
                className={session.role === r ? "active" : ""}
                onClick={() => switchRole(r)}
              >
                {ROLE_LABEL[r]}
              </button>
            ))}
          </div>
          <input
            className="name-input"
            value={session.name}
            placeholder={isFollowup ? "复诊助理姓名" : "听力师姓名"}
            onChange={(e) => updateName(e.target.value)}
          />
        </div>
      </header>

      <div className="notice-bar">
        {isFollowup ? (
          <>当前为 <b>复诊助理</b> 视图：可查看、筛选、导出与录入「复诊」记录；新增患者档案、其他分类录入由听力师完成。</>
        ) : (
          <>当前为 <b>听力师</b> 视图：拥有档案与全部验配记录的录入、查看和导出权限。</>
        )}
      </div>

      <nav className="tabs">
        <button className={tab === "recent" ? "active" : ""} onClick={() => setTab("recent")}>
          近期记录{" "}
          <span className="tab-count">
            {encounters.filter((e) => daysBetween(e.date, todayStr()) <= 14).length}
          </span>
        </button>
        <button className={tab === "all" ? "active" : ""} onClick={() => setTab("all")}>
          全部记录
        </button>
        <button className={tab === "patients" ? "active" : ""} onClick={() => setTab("patients")}>
          患者档案 <span className="tab-count">{patients.length}</span>
        </button>
      </nav>

      {tab !== "patients" && (
        <div className="toolbar">
          <div className="filter-group">
            <label className="filter-label">分类</label>
            <div className="chip-group">
              {CATEGORY_FILTERS.map((c) => (
                <button
                  key={c || "all"}
                  className={`chip-toggle ${categoryFilter === c ? "active" : ""}`}
                  onClick={() => setCategoryFilter(c)}
                >
                  {c ? CATEGORY_LABEL[c] : "全部"}
                </button>
              ))}
            </div>
          </div>
          <div className="filter-group">
            <label className="filter-label">记录人角色</label>
            <select value={roleFilter} onChange={(e) => setRoleFilter(e.target.value as Role | "")}>
              <option value="">全部角色</option>
              <option value="audiologist">听力师</option>
              <option value="followup">复诊助理</option>
            </select>
          </div>
          <div className="filter-group filter-search">
            <input
              value={query}
              placeholder="搜索患者姓名 / 助听器型号 / 记录人"
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <div className="toolbar-actions">
            <button className="btn" onClick={exportFiltered}>⬇ 导出筛选结果（Markdown）</button>
            <button
              className="btn btn-primary"
              onClick={() => openNewEncounter()}
              title={!session.name.trim() ? "请先填写记录人姓名" : ""}
            >
              + 新增验配记录
            </button>
            {!isFollowup && (
              <button className="btn btn-secondary" onClick={() => setShowPatientForm(true)}>
                + 新增患者档案
              </button>
            )}
          </div>
        </div>
      )}

      {tab === "patients" ? (
        <PatientPanel
          patients={patients}
          encountersByPatient={encountersByPatient}
          canAddPatient={!isFollowup}
          canAddEncounter={!!session.name.trim()}
          onAddPatient={() => setShowPatientForm(true)}
          onAddEncounter={(pid) => openNewEncounter(pid)}
          onOpenEncounter={setOpenEncounter}
        />
      ) : (
        <section className="record-section">
          <div className="section-head">
            <h2>{tab === "recent" ? "近 14 天记录" : "全部验配记录"}</h2>
            <span className="result-count">共 {filtered.length} 条</span>
          </div>
          {filtered.length === 0 ? (
            <div className="empty-state">
              <p>没有符合条件的记录。</p>
              <p className="empty-hint">
                可调整筛选条件，或{isFollowup ? "录入一条复诊记录" : "新增一条验配记录"}。
              </p>
            </div>
          ) : (
            <div className="table-scroll">
              <table className="record-table">
                <thead>
                  <tr>
                    <th>日期</th>
                    <th>患者</th>
                    <th>分类</th>
                    <th>左 PTA</th>
                    <th>右 PTA</th>
                    <th>WRS 左/右</th>
                    <th>助听器型号 / 增益</th>
                    <th>记录人</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((e) => {
                    const p = patientMap.get(e.patientId);
                    const l = pta(e.audiogram.air.left);
                    const r = pta(e.audiogram.air.right);
                    return (
                      <tr key={e.id}>
                        <td className="nowrap">{e.date}</td>
                        <td className="nowrap">
                          {p ? p.name : <span className="muted">档案缺失</span>}
                        </td>
                        <td><span className="chip chip-category">{CATEGORY_LABEL[e.category]}</span></td>
                        <td>{l === null ? "—" : <span title={hearingLossLevel(l)}>{l} dB</span>}</td>
                        <td>{r === null ? "—" : <span title={hearingLossLevel(r)}>{r} dB</span>}</td>
                        <td className="nowrap">
                          {e.wrs.left === "" ? "—" : `${e.wrs.left}%`} /{" "}
                          {e.wrs.right === "" ? "—" : `${e.wrs.right}%`}
                        </td>
                        <td className="aid-cell">
                          {e.aids.map((a, i) => (
                            <div key={i}>
                              {a.model}
                              <span
                                className={`gain-tag ${
                                  Number(a.gainDb) > 0 ? "up" : Number(a.gainDb) < 0 ? "down" : ""
                                }`}
                              >
                                {Number(a.gainDb) > 0 ? "+" : ""}
                                {a.gainDb} dB
                              </span>
                            </div>
                          ))}
                        </td>
                        <td className="nowrap">
                          {e.operatorName || "未署名"}
                          <span className="role-tag">{ROLE_LABEL[e.operatorRole]}</span>
                        </td>
                        <td className="nowrap">
                          <button className="link-btn" onClick={() => setOpenEncounter(e)}>
                            查看
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {showPatientForm && (
        <PatientForm
          onClose={() => setShowPatientForm(false)}
          onSaved={(p) => {
            setShowPatientForm(false);
            showToast("ok", `患者档案「${p.name}」已保存（编号 ${p.id}）。`);
          }}
        />
      )}

      {showEncounterForm && (
        <EncounterForm
          role={session.role}
          operatorName={session.name}
          patients={patients}
          presetPatientId={presetPatientId}
          onClose={() => {
            setShowEncounterForm(false);
            setPresetPatientId(undefined);
          }}
          onSaved={(e) => {
            setShowEncounterForm(false);
            setPresetPatientId(undefined);
            setCategoryFilter("");
            setTab("recent");
            const p = patientMap.get(e.patientId);
            showToast(
              "ok",
              `验配记录已保存：${p?.name ?? ""} · ${e.date} · ${CATEGORY_LABEL[e.category]}（${e.id}）`,
            );
          }}
        />
      )}

      {openEncounter && (
        <EncounterDetail
          encounter={openEncounter}
          patient={patientMap.get(openEncounter.patientId)}
          onClose={() => setOpenEncounter(null)}
        />
      )}

      {toast && <div className={`toast toast-${toast.kind}`}>{toast.text}</div>}

      <footer className="footer">
        数据保存在本机浏览器 localStorage · 刷新与重启不丢失 ·{" "}
        <button
          className="link-btn"
          onClick={() => {
            if (window.confirm("确定清空当前数据并恢复演示数据？此操作不可撤销。")) {
              store.resetToSeed();
              showToast("ok", "已恢复演示数据。");
            }
          }}
        >
          恢复演示数据
        </button>
      </footer>
    </div>
  );
}

function PatientPanel({
  patients,
  encountersByPatient,
  canAddPatient,
  canAddEncounter,
  onAddPatient,
  onAddEncounter,
  onOpenEncounter,
}: {
  patients: Patient[];
  encountersByPatient: Map<string, Encounter[]>;
  canAddPatient: boolean;
  canAddEncounter: boolean;
  onAddPatient: () => void;
  onAddEncounter: (patientId: string) => void;
  onOpenEncounter: (e: Encounter) => void;
}) {
  return (
    <section className="record-section">
      <div className="section-head">
        <h2>患者档案</h2>
        <div>
          <span className="result-count">共 {patients.length} 人</span>
          {canAddPatient && (
            <button className="btn btn-secondary btn-sm" style={{ marginLeft: 12 }} onClick={onAddPatient}>
              + 新增患者档案
            </button>
          )}
        </div>
      </div>
      {patients.length === 0 ? (
        <div className="empty-state"><p>暂无患者档案。</p></div>
      ) : (
        <div className="patient-grid">
          {patients.map((p) => {
            const list = encountersByPatient.get(p.id) ?? [];
            const latest = list[0];
            return (
              <article className="patient-card" key={p.id}>
                <header>
                  <h3>{p.name}</h3>
                  <span className="chip">{p.gender === "male" ? "男" : "女"}</span>
                </header>
                <dl>
                  <div><dt>编号</dt><dd>{p.id}</dd></div>
                  <div><dt>出生日期</dt><dd>{p.birthDate}</dd></div>
                  <div><dt>电话</dt><dd>{p.phone || "—"}</dd></div>
                  <div><dt>验配记录</dt><dd>{list.length} 次</dd></div>
                </dl>
                {p.note && <p className="patient-note">{p.note}</p>}
                {latest && (
                  <button className="patient-latest" onClick={() => onOpenEncounter(latest)}>
                    最近：{latest.date} · {CATEGORY_LABEL[latest.category]} · 右{" "}
                    {pta(latest.audiogram.air.right) ?? "—"} dB / 左{" "}
                    {pta(latest.audiogram.air.left) ?? "—"} dB
                  </button>
                )}
                <div className="patient-actions">
                  <button
                    className="btn btn-primary btn-sm"
                    disabled={!canAddEncounter}
                    title={canAddEncounter ? "" : "请先在顶部填写记录人姓名"}
                    onClick={() => onAddEncounter(p.id)}
                  >
                    + 录入记录
                  </button>
                  {list.length > 0 && (
                    <details className="history-details">
                      <summary>历史记录（{list.length}）</summary>
                      <ul>
                        {list.map((e) => (
                          <li key={e.id}>
                            <button className="link-btn" onClick={() => onOpenEncounter(e)}>
                              {e.date} · {CATEGORY_LABEL[e.category]} ·{" "}
                              {e.aids.map((a) => a.model).join("、") || "—"}
                            </button>
                          </li>
                        ))}
                      </ul>
                    </details>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
