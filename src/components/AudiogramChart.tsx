import { AIR_FREQS, BONE_FREQS, type Audiogram } from "../types";

interface Props {
  audiogram: Audiogram;
  /** 小图用于列表/详情顶部，大图用于详情弹窗 */
  size?: "small" | "large";
}

const X_POS: Record<number, number> = { 250: 30, 500: 85, 1000: 140, 2000: 195, 4000: 250, 8000: 305 };
const Y_MIN = -10;
const Y_MAX = 120;
const STEP = 10;

function y(db: number): number {
  return 16 + ((db - Y_MIN) / (Y_MAX - Y_MIN)) * 270;
}

function pathFor(values: { freq: number; db: number }[]): string {
  return values.map((v, i) => `${i === 0 ? "M" : "L"} ${X_POS[freqToX(v.freq)]} ${y(v.db)}`).join(" ");
}

function freqToX(f: number): number {
  return f;
}

/**
 * 临床风格听力图：
 * 红 O — 右耳气导；蓝 X — 左耳气导；
 * 红 < — 右耳骨导；蓝 > — 左耳骨导。
 */
export default function AudiogramChart({ audiogram, size = "small" }: Props) {
  const width = size === "large" ? 380 : 340;
  const height = size === "large" ? 320 : 300;

  const series = (
    freqs: readonly number[],
    pick: (freq: number) => number | undefined,
  ): { freq: number; db: number }[] =>
    freqs
      .map((freq) => ({ freq, db: pick(freq) }))
      .filter((p): p is { freq: number; db: number } => typeof p.db === "number");

  const airR = series(AIR_FREQS, (f) => audiogram.air.right[f]);
  const airL = series(AIR_FREQS, (f) => audiogram.air.left[f]);
  const boneR = series(BONE_FREQS, (f) => audiogram.bone.right[f]);
  const boneL = series(BONE_FREQS, (f) => audiogram.bone.left[f]);

  return (
    <svg
      className="audiogram"
      viewBox="0 0 356 300"
      width={width}
      height={height}
      role="img"
      aria-label="听力图"
    >
      {/* 网格与纵坐标 */}
      {Array.from({ length: (Y_MAX - Y_MIN) / STEP + 1 }, (_, i) => Y_MIN + i * STEP).map((db) => (
        <g key={db}>
          <line x1="30" y1={y(db)} x2="322" y2={y(db)} stroke="#e2e8f0" strokeWidth={db % 20 === 0 ? 1 : 0.5} />
          <text x="6" y={y(db) + 3.5} fontSize="8" fill="#64748b">
            {db}
          </text>
        </g>
      ))}
      {AIR_FREQS.map((f) => (
        <g key={f}>
          <line x1={X_POS[f]} y1="16" x2={X_POS[f]} y2="286" stroke="#e2e8f0" strokeWidth={0.5} />
          <text x={X_POS[f] - 9} y="298" fontSize="8" fill="#475569">
            {f >= 1000 ? `${f / 1000}k` : f}
          </text>
        </g>
      ))}
      <text x="160" y="11" fontSize="8.5" fill="#334155">
        频率 Hz / 听阈 dB HL
      </text>

      {/* 连线 */}
      {airR.length > 1 && <path d={pathFor(airR)} stroke="#dc2626" strokeWidth="1.4" fill="none" />}
      {airL.length > 1 && <path d={pathFor(airL)} stroke="#2563eb" strokeWidth="1.4" fill="none" />}

      {/* 数据点 */}
      {airR.map((p) => (
        <circle key={`ar-${p.freq}`} cx={X_POS[p.freq]} cy={y(p.db)} r="4" fill="none" stroke="#dc2626" strokeWidth="1.6" />
      ))}
      {airL.map((p) => (
        <AirCross key={`al-${p.freq}`} cx={X_POS[p.freq]} cy={y(p.db)} />
      ))}
      {boneR.map((p) => (
        <BoneMark key={`br-${p.freq}`} cx={X_POS[p.freq]} cy={y(p.db)} color="#dc2626" point="left" />
      ))}
      {boneL.map((p) => (
        <BoneMark key={`bl-${p.freq}`} cx={X_POS[p.freq]} cy={y(p.db)} color="#2563eb" point="right" />
      ))}

      {/* 图例 */}
      <g transform="translate(238,22)">
        <rect x="-4" y="-9" width="86" height="46" rx="4" fill="white" opacity="0.9" stroke="#e2e8f0" />
        <circle cx="6" cy="0" r="3.4" fill="none" stroke="#dc2626" strokeWidth="1.4" />
        <text x="14" y="3" fontSize="8" fill="#334155">右耳气导</text>
        <AirCross cx={6} cy={14} />
        <text x="14" y="17" fontSize="8" fill="#334155">左耳气导</text>
        <BoneMark cx={30} cy={31} color="#94a3b8" point="right" />
        <text x="40" y="34" fontSize="8" fill="#334155">骨导</text>
      </g>
    </svg>
  );
}

function AirCross({ cx, cy }: { cx: number; cy: number }) {
  const s = 4;
  return (
    <path
      d={`M ${cx - s} ${cy - s} L ${cx + s} ${cy + s} M ${cx + s} ${cy - s} L ${cx - s} ${cy + s}`}
      stroke="#2563eb"
      strokeWidth="1.6"
    />
  );
}

function BoneMark({
  cx,
  cy,
  color,
  point,
}: {
  cx: number;
  cy: number;
  color: string;
  point: "left" | "right";
}) {
  const s = 4.5;
  const d =
    point === "left"
      ? `M ${cx + s} ${cy} L ${cx - s} ${cy - s} L ${cx - s} ${cy + s} Z`
      : `M ${cx - s} ${cy} L ${cx + s} ${cy - s} L ${cx + s} ${cy + s} Z`;
  return <path d={d} fill="none" stroke={color} strokeWidth="1.5" />;
}
