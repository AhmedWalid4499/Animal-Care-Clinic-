// Dental tab (change request, 19 Nov 2026): an occlusal view of the pet's mouth — upper jaw on top, lower jaw below,
// the pet's right on the viewer's left (as on a veterinary dental chart). Teeth come from the pet's age.
import { useId, useMemo, useState, type ReactNode } from 'react';
import { useApp } from '../lib/app';
import type { PetRow } from '../db/repo';
import { ageParts } from '../lib/dates';
import {
  SOFT_CONDITIONS, SOFT_PARTS, SOFT_SHADES, TOOTH_CONDITIONS, TOOTH_EXCLUSIVE, TOOTH_SHADES, ageMonths, conditionShade,
  defaultToothShade, deciduousCount, dentition, mixHex, permanentCount, shadeHex, softShade, toothById,
  type Animal, type DentalView, type Slot, type ToothDef,
} from '../lib/dental';
import { FindingsList, HoverCard, Inspector, useChart, useHover, type Look, type PartInfo } from './ChartKit';

type Pt = [number, number];
const W = 336;
const H = 600;
const CX = W / 2;
const BITE = 30; // half the space between the jaws
const ARCH: Record<Animal, Record<'upper' | 'lower', Pt[]>> = {
  DOG: { upper: [[0, 0], [46, 0], [80, 26], [112, 222]], lower: [[0, 0], [40, 0], [70, 26], [100, 222]] },
  CAT: { upper: [[0, 0], [44, 0], [88, 16], [116, 150]], lower: [[0, 0], [38, 0], [76, 16], [100, 150]] },
};
const BASE = { palate: '#e9a5ac', gum: '#ee9ea6', tongue: '#e3838e' };

function sampler(c: Pt[]) {
  const N = 240;
  const pts: Pt[] = [];
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const u = 1 - t;
    const f = (k: 0 | 1) => u * u * u * c[0][k] + 3 * u * u * t * c[1][k] + 3 * u * t * t * c[2][k] + t * t * t * c[3][k];
    pts.push([f(0), f(1)]);
  }
  const len = [0];
  for (let i = 1; i <= N; i++) len.push(len[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  const L = len[N];
  const at = (s: number) => {
    const x = Math.max(0, Math.min(L, s));
    let i = 1;
    while (i < N && len[i] < x) i++;
    const k = (x - len[i - 1]) / Math.max(1e-6, len[i] - len[i - 1]);
    const p: Pt = [pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * k, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * k];
    const dx = pts[i][0] - pts[i - 1][0];
    const dy = pts[i][1] - pts[i - 1][1];
    const m = Math.hypot(dx, dy) || 1;
    return { p, tan: [dx / m, dy / m] as Pt };
  };
  /** Half-width of the arch at a given depth. */
  const halfAt = (dy: number) => {
    for (let i = 1; i <= N; i++) if (pts[i][1] >= dy) return pts[i][0];
    return pts[N][0];
  };
  return { L, at, pts, halfAt, depth: c[3][1] };
}

function gapAfter(a: Animal, jaw: 'upper' | 'lower', pos: number) {
  if (pos <= 2) return 1.2;
  if (pos === 3) return 3;
  if (pos === 4) return a === 'DOG' ? 11 : jaw === 'upper' ? 9 : 12;
  if (a === 'DOG' && pos <= 7) return 6;
  return 2;
}

interface Placed { slot: Slot; m: [number, number, number, number, number, number]; label: Pt; s: number }

function layoutMouth(a: Animal, slots: Slot[]) {
  const upper = sampler(ARCH[a].upper);
  const lower = sampler(ARCH[a].lower);
  const top = H / 2 - BITE - upper.depth;
  const bottom = H / 2 + BITE + lower.depth;
  const jaws = { upper, lower };
  const byQ = (q: number) => slots.filter((s) => s.quadrant === q).sort((x, y) => x.pos - y.pos);
  const fit = (q: number) => {
    const list = byQ(q);
    const jaw = q <= 2 ? 'upper' : 'lower';
    const gaps = list.slice(0, -1).reduce((n, s) => n + gapAfter(a, jaw, s.pos), 1);
    const widths = list.reduce((n, s) => n + s.layout.w, 0);
    return (jaws[jaw].L * 0.94 - gaps) / Math.max(1, widths);
  };
  const s = Math.min(2, fit(1), fit(4));
  const placed: Placed[] = [];
  for (const q of [1, 2, 3, 4]) {
    const isUpper = q <= 2;
    const jaw = isUpper ? 'upper' : 'lower';
    const smp = jaws[jaw];
    const sx = q === 1 || q === 4 ? -1 : 1; // the pet's right on the viewer's left
    const sy = isUpper ? 1 : -1;
    const oy = isUpper ? top : bottom;
    let cur = 1;
    for (const slot of byQ(q)) {
      const w = slot.layout.w * s;
      const { p, tan } = smp.at(cur + w / 2);
      cur += w + gapAfter(a, jaw, slot.pos);
      const P: Pt = [CX + sx * p[0], oy + sy * p[1]];
      const T: Pt = [sx * tan[0], sy * tan[1]];
      const N: Pt = [sx * tan[1], sy * -tan[0]]; // outward (cheek / lip side)
      const off = (slot.layout.d * Math.min(s * 1.15, 2.1)) / 2 + (slot.pos <= 3 ? 12 : 9);
      placed.push({ slot, s, m: [T[0], T[1], N[0], N[1], P[0], P[1]], label: [P[0] + N[0] * off, P[1] + N[1] * off] });
    }
  }
  const map = (isUpper: boolean, sx: number, [x, y]: Pt): Pt => [CX + sx * x, isUpper ? top + y : bottom - y];
  const archPath = (isUpper: boolean) => {
    const smp = isUpper ? upper : lower;
    const right = smp.pts.map((p) => map(isUpper, -1, p)).reverse();
    const left = smp.pts.map((p) => map(isUpper, 1, p));
    return `M ${[...right, ...left].map((p) => `${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' L ')}`;
  };
  const palate = () => {
    const back = top + upper.depth;
    return `${archPath(true)} Q ${CX} ${back + 26} ${(CX - upper.pts[upper.pts.length - 1][0]).toFixed(1)} ${back.toFixed(1)} Z`;
  };
  const rugae = () => {
    const out: string[] = [];
    for (let k = 0; k < 7; k++) {
      const dy = upper.depth * (0.16 + k * 0.105);
      const hw = upper.halfAt(dy) * 0.8;
      const y = top + dy;
      out.push(`M ${CX - hw} ${y + 4} Q ${CX - hw / 2} ${y - 9} ${CX} ${y - 2} Q ${CX + hw / 2} ${y - 9} ${CX + hw} ${y + 4}`);
    }
    return out;
  };
  const tongue = () => {
    const tip = 30;
    const end = lower.depth + 16;
    const right: Pt[] = [];
    for (let dy = tip; dy <= end; dy += 4) {
      const round = Math.sqrt(Math.min(1, (dy - tip) / 46));
      const hw = lower.halfAt(Math.min(dy, lower.depth)) * 0.66 * round;
      right.push([CX - hw, bottom - dy]);
    }
    const left = right.map(([x, y]) => [2 * CX - x, y] as Pt).reverse();
    return `M ${[...right, ...left].map((p) => `${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' L ')} Z`;
  };
  return { placed, top, bottom, upper, lower, archPath, palate: palate(), rugae: rugae(), tongue: tongue(), tongueTip: bottom - 30, tongueBack: bottom - lower.depth - 16 };
}

// ---------------------------------------------------------------- tooth drawing (local: x along the arch, y outward)
function toothShape(t: ToothDef, a: Animal, w: number, d: number): string {
  const x = w / 2;
  const y = d / 2;
  if (t.type === 'I') {
    const r = Math.min(x, y) * 0.8;
    return `M ${-x + r} ${-y} H ${x - r} Q ${x} ${-y} ${x} ${-y + r} V ${y - r} Q ${x} ${y} ${x - r} ${y} H ${-x + r} Q ${-x} ${y} ${-x} ${y - r} V ${-y + r} Q ${-x} ${-y} ${-x + r} ${-y} Z`;
  }
  if (t.type === 'C' || (a === 'CAT' && t.type === 'M' && t.jaw === 'upper') || (t.type === 'P' && t.pos <= 5 && !t.deciduous)) {
    return `M ${-x} 0 A ${x} ${y} 0 1 0 ${x} 0 A ${x} ${y} 0 1 0 ${-x} 0 Z`;
  }
  if (t.carnassial && t.jaw === 'upper') {
    return `M ${-x} ${y * 0.1} C ${-x * 0.5} ${y * 1.15}, ${x * 0.5} ${y * 1.05}, ${x} ${y * 0.2} C ${x * 0.6} ${-y * 0.45}, ${x * 0.05} ${-y * 0.3}, ${-x * 0.25} ${-y * 0.35} C ${-x * 0.35} ${-y * 1.25}, ${-x * 0.95} ${-y * 1.15}, ${-x} ${y * 0.1} Z`;
  }
  if (a === 'DOG' && t.type === 'M' && t.jaw === 'upper') {
    return `M ${-x} ${y * 0.55} C ${-x * 0.9} ${y * 1.05}, ${x * 0.9} ${y * 1.05}, ${x} ${y * 0.5} C ${x * 1.05} ${-y * 0.2}, ${x * 0.45} ${-y * 1.05}, 0 ${-y} C ${-x * 0.45} ${-y * 1.05}, ${-x * 1.05} ${-y * 0.2}, ${-x} ${y * 0.55} Z`;
  }
  return `M ${-x} 0 C ${-x * 0.55} ${-y * 1.3}, ${x * 0.55} ${-y * 1.3}, ${x} 0 C ${x * 0.55} ${y * 1.3}, ${-x * 0.55} ${y * 1.3}, ${-x} 0 Z`;
}

function ToothGlyph({ p, a, look, natural, uid, sel, hov }: { p: Placed; a: Animal; look: Look; natural: string; uid: string; sel: boolean; hov: boolean }) {
  const t = p.slot.tooth;
  const k = p.slot.grown > 0 ? 0.45 + 0.55 * p.slot.grown : 1;
  const w = t.w * p.s * k;
  const d = t.d * Math.min(p.s * 1.15, 2.1) * k;
  const x = w / 2;
  const y = d / 2;
  const shape = toothShape(t, a, w, d);
  const c = look.conditions;
  const f = 0.6 + 0.2 * (look.severity ?? 2);
  const gone = c.includes('MISSING') || c.includes('EXTRACTED');
  const ghost = p.slot.grown === 0;
  const fill = TOOTH_SHADES[look.shade ?? ''] ?? TOOTH_SHADES[conditionShade(c) ?? ''] ?? natural;
  const clip = `${uid}-c${t.id}`;
  // No color-mix() here: the Windows 7 / 32-bit build (Chromium 108) would drop the stroke. Opacity does the same.
  const outline = sel || hov ? 'var(--accent)' : undefined;
  return (
    <g transform={`matrix(${p.m.map((v) => v.toFixed(4)).join(' ')})`}>
      <clipPath id={clip}><path d={shape} /></clipPath>
      {c.includes('GINGIVITIS') && !ghost && <ellipse rx={x + 5} ry={y + 5} fill="#dc3c4b" opacity={0.5 * f} filter={`url(#${uid}-blur)`} />}
      {gone || ghost ? (
        <>
          {c.includes('EXTRACTED') && <ellipse rx={x * 0.75} ry={y * 0.6} fill="#e98d97" opacity={0.7} />}
          <path d={shape} fill={ghost && !gone ? 'rgba(255,255,255,.18)' : 'none'} stroke="var(--ink-3)" strokeWidth={1} strokeDasharray="2.5 2" opacity={0.85} />
          {c.includes('EXTRACTED') && <path d={`M ${-x * 0.35} ${-y * 0.35} L ${x * 0.35} ${y * 0.35} M ${x * 0.35} ${-y * 0.35} L ${-x * 0.35} ${y * 0.35}`} stroke="var(--ink-2)" strokeWidth={1.1} />}
        </>
      ) : (
        <>
          <path d={shape} fill={fill} stroke={shadeHex(fill, -0.28)} strokeWidth={0.9} />
          <g clipPath={`url(#${clip})`}>
            {c.includes('PLAQUE') && <path d={shape} fill="#e3cd7c" opacity={0.42 * f} />}
            {c.includes('TARTAR') && (
              <>
                <ellipse cy={y * 0.75} rx={x * 1.05 * f} ry={y * 0.62 * f} fill="#9f6c33" opacity={0.82} />
                <ellipse cx={-x * 0.25} cy={y * 0.85} rx={x * 0.45 * f} ry={y * 0.32 * f} fill="#c8975a" opacity={0.75} />
              </>
            )}
            {c.includes('WORN') && <ellipse rx={x * 0.55} ry={y * 0.38} fill="#d8b267" stroke="#b28a45" strokeWidth={0.5} opacity={0.9} />}
            {c.includes('RESORPTION') && <ellipse cy={y * 0.85} rx={x * 0.42 * f} ry={y * 0.45 * f} fill="#df6a80" />}
            {c.includes('CARIES') && (
              <>
                <circle cx={x * 0.15} cy={-y * 0.1} r={Math.min(x, y) * 0.5 * f} fill="#7a5638" opacity={0.55} />
                <circle cx={x * 0.15} cy={-y * 0.1} r={Math.min(x, y) * 0.32 * f} fill="#33241a" />
              </>
            )}
            {c.includes('FRACTURED') && (
              <>
                <path d={`M ${x * 0.15} ${-y * 1.2} L ${x * 1.2} ${-y * 1.2} L ${x * 1.2} ${y * 0.1} L ${x * 0.55} ${-y * 0.05} L ${x * 0.4} ${-y * 0.45} Z`} fill="#d3a35d" />
                <path d={`M ${x * 0.15} ${-y} L ${x * 0.4} ${-y * 0.45} L ${x * 0.2} ${y * 0.1} L ${x * 0.45} ${y * 0.9}`} stroke="#3d2b1e" strokeWidth={1.1} fill="none" />
                {(look.severity ?? 0) >= 3 && <circle cx={x * 0.62} cy={-y * 0.42} r={Math.min(x, y) * 0.28} fill="#c22f3c" />}
              </>
            )}
            {c.includes('TREATED') && <rect x={-x * 0.45} y={-y * 0.35} width={x * 0.9} height={y * 0.7} rx={2} fill="#a9bacb" stroke="#768ba1" strokeWidth={0.6} />}
            {/* enamel gloss and the cusp ridge make it read as a real tooth */}
            <path d={shape} fill={`url(#${uid}-gloss)`} />
            {(t.type === 'P' || t.type === 'M') && w > 9 && <path d={`M ${-x * 0.62} 0 L ${x * 0.62} 0`} stroke={shadeHex(fill, -0.3)} strokeWidth={0.8} opacity={0.5} strokeLinecap="round" />}
            {t.type === 'C' && <ellipse cx={-x * 0.1} cy={-y * 0.12} rx={x * 0.28} ry={y * 0.24} fill="#fff" opacity={0.55} />}
          </g>
          {c.includes('MOBILE') && (
            <path d={`M ${-x - 3} ${-y * 0.6} Q ${-x - 6} 0 ${-x - 3} ${y * 0.6} M ${x + 3} ${-y * 0.6} Q ${x + 6} 0 ${x + 3} ${y * 0.6}`} stroke="#c47a12" strokeWidth={1.2} fill="none" strokeLinecap="round" />
          )}
          {c.includes('RETAINED') && <path d={shape} transform="scale(1.3)" fill="none" stroke="#d98b1f" strokeWidth={1} strokeDasharray="2 1.6" />}
        </>
      )}
      {outline && <path d={shape} transform={sel ? 'scale(1.18)' : 'scale(1.1)'} fill="none" stroke={outline} strokeOpacity={sel ? 1 : 0.7} strokeWidth={sel ? 2.2 : 1.6} />}
      {/* generous invisible hit area so small teeth are easy to point at */}
      <ellipse rx={Math.max(x, 6) + 2} ry={Math.max(y, 6) + 2} fill="transparent" />
    </g>
  );
}

// ---------------------------------------------------------------- the tab
export function DentalTab({ pet }: { pet: PetRow }) {
  const { t, fmt, locale } = useApp();
  const a = pet.species as Animal;
  const uid = useId().replace(/:/g, '');
  const months = ageMonths(pet.date_of_birth);
  const [view, setView] = useState<DentalView>('auto');
  const { stage, slots } = useMemo(() => dentition(a, months, view), [a, months, view]);
  const geo = useMemo(() => layoutMouth(a, slots), [a, slots]);
  const state = useChart(pet.id, 'DENTAL');
  const hover = useHover();
  const natural = TOOTH_SHADES[defaultToothShade(stage, months)];
  const age = pet.date_of_birth ? ageParts(pet.date_of_birth) : null;
  const n = stage === 'DECIDUOUS' ? deciduousCount(a) : permanentCount(a);

  const sevLabel = (k: number) => t(`charts.sev${k}`);
  const isSoft = (part: string) => (SOFT_PARTS as readonly string[]).includes(part);
  const eruptText = (r: [number, number]) =>
    r[1] < 3 ? t('dental.eruptWeeks', { a: Math.round(r[0] * 4.345), b: Math.round(r[1] * 4.345) }) : t('dental.eruptMonths', { a: fmt.num(r[0], 1), b: fmt.num(r[1], 1) });
  const toothName = (td: ToothDef) =>
    t(td.deciduous ? 'dental.toothNameBaby' : 'dental.toothName', { where: t(`dental.where.${td.jaw}_${td.side}`), kind: t(`dental.kind.${td.type}${td.ordinal}`) });
  const nameOf = (part: string): string | null => {
    if (part === 'MOUTH') return t('dental.general');
    if (isSoft(part)) return t(`dental.soft.${part}.name`);
    const td = toothById(a, part);
    return td ? `${toothName(td)} (${td.id})` : null;
  };
  const condLabel = (part: string, c: string) => t(isSoft(part) ? `softCond.${c}` : `toothCond.${c}`);

  const info = (part: string | null): PartInfo | null => {
    if (!part) return null;
    if (part === 'MOUTH') return { title: t('dental.general'), about: t('dental.generalHint') };
    if (isSoft(part)) return { title: t(`dental.soft.${part}.name`), about: t(`dental.soft.${part}.about`) };
    const td = toothById(a, part);
    if (!td) return null;
    const slot = slots.find((s) => s.tooth.id === part);
    const facts: [string, ReactNode][] = [
      [t('dental.roots'), td.roots],
      [t('dental.erupts'), eruptText(td.erupt)],
    ];
    if (td.deciduous) {
      const adult = toothById(a, `${Number(td.id[0]) - 4}${td.id.slice(1)}`);
      if (adult) facts.push([t('dental.replaced'), eruptText(adult.erupt)]);
    }
    let status: string | undefined;
    if (slot && slot.grown === 0) status = t('dental.unerupted');
    else if (slot && slot.grown < 1) status = t('dental.erupting', { p: Math.round(slot.grown * 100) });
    else if (!slot) status = t(td.deciduous ? 'dental.notNowBaby' : 'dental.notNowAdult');
    return {
      title: toothName(td),
      subtitle: `${t('dental.triadan')} ${td.id} · ${t(`dental.typeName.${td.type}`)}`,
      status,
      facts,
      about: td.carnassial ? t('dental.fn.CARN') : a === 'CAT' && td.type === 'M' ? t('dental.fn.CAT_M') : t(`dental.fn.${td.type}`),
    };
  };

  const toothOptions = (part: string | null) => {
    const td = part ? toothById(a, part) : undefined;
    return TOOTH_CONDITIONS.filter((k) => k !== 'RETAINED' || td?.deciduous).map((k) => ({ key: k, label: t(`toothCond.${k}`) }));
  };
  const sel = state.selected;
  const soft = sel ? isSoft(sel) : false;
  const softFill = (part: string, base: string) => {
    const l = state.look(part);
    return softShade(l.shade, l.conditions, base);
  };
  const part = (id: string, label: string) => ({
    role: 'button',
    tabIndex: 0,
    'aria-label': label,
    className: `part ${sel === id ? 'sel' : ''}`,
    onClick: () => state.select(id),
    onKeyDown: (e: React.KeyboardEvent) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), state.select(id)),
    ...hover.bind(id),
  });
  const softFx = (id: string) => {
    const c = state.look(id).conditions;
    return { ulcer: c.includes('ULCER'), mass: c.includes('MASS'), bleed: c.includes('BLEEDING') };
  };
  const gumW = Math.max(...geo.placed.map((p) => p.slot.layout.d * Math.min(p.s * 1.15, 2.1))) + 10;
  const palateFill = softFill('PALATE', BASE.palate);
  const tongueFill = softFill('TONGUE', BASE.tongue);
  const hoverInfo = hover.hover ? info(hover.hover.part) : null;
  const ageLabel = age ? t('pets.ageValue', { y: age.years, m: age.months }) : null;

  return (
    <div className="clin-chart">
      <div className="row clin-head">
        <p className={`note ${stage === 'SENIOR' || stage === 'UNKNOWN' ? 'warn' : ''}`} style={{ margin: 0, flex: 1, minWidth: 220 }}>
          {ageLabel && <b>{t('dental.age', { age: ageLabel })} · </b>}
          {t(`dental.stage.${stage}`, { n })}
        </p>
        <div className="field" style={{ gap: 2 }}>
          <span>{t('dental.view')}</span>
          <div className="seg">
            {(['auto', 'deciduous', 'permanent'] as DentalView[]).map((v) => (
              <button key={v} type="button" className={view === v ? 'on' : ''} onClick={() => setView(v)}>{t(`dental.view_${v}`)}</button>
            ))}
          </div>
        </div>
      </div>
      <p className="faint small" style={{ margin: '8px 0 0' }}>{t(state.canEdit ? 'charts.hoverHint' : 'charts.hoverHintRO')}</p>

      <div className="clin-grid">
        <div className="clin-stage" ref={hover.wrap} onPointerLeave={hover.clear}>
          <svg viewBox={`0 ${geo.top - 44} ${W} ${geo.bottom - geo.top + 92}`} style={{ direction: 'ltr' }} className="mouth" role="img" aria-label={t('petRecord.dental')}>
            <defs>
              <radialGradient id={`${uid}-gloss`} cx="34%" cy="30%" r="80%">
                <stop offset="0" stopColor="#fff" stopOpacity={0.85} />
                <stop offset="0.35" stopColor="#fff" stopOpacity={0.18} />
                <stop offset="0.75" stopColor="#000" stopOpacity={0} />
                <stop offset="1" stopColor="#000" stopOpacity={0.22} />
              </radialGradient>
              <radialGradient id={`${uid}-tongue`} cx="50%" cy="85%" r="75%">
                <stop offset="0" stopColor={shadeHex(tongueFill, 0.18)} />
                <stop offset="1" stopColor={shadeHex(tongueFill, -0.12)} />
              </radialGradient>
              <radialGradient id={`${uid}-palate`} cx="50%" cy="40%" r="70%">
                <stop offset="0" stopColor={shadeHex(palateFill, 0.08)} />
                <stop offset="1" stopColor={shadeHex(palateFill, -0.14)} />
              </radialGradient>
              <filter id={`${uid}-blur`} x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="2" /></filter>
              <clipPath id={`${uid}-pal`}><path d={geo.palate} /></clipPath>
            </defs>

            <text x={14} y={H / 2 + 4} className="svg-lbl">{t('charts.right')}</text>
            <text x={W - 14} y={H / 2 + 4} className="svg-lbl" textAnchor="end">{t('charts.left')}</text>
            <text x={CX} y={geo.top - 24} className="svg-lbl" textAnchor="middle">{t('dental.upper')}</text>
            <text x={CX} y={geo.bottom + 34} className="svg-lbl" textAnchor="middle">{t('dental.lower')}</text>
            <line x1={40} x2={W - 40} y1={H / 2} y2={H / 2} stroke="var(--rule-2)" strokeDasharray="3 5" />

            {/* upper jaw: palate with its ridges, then the gum, then the teeth */}
            <g {...part('PALATE', t('dental.soft.PALATE.name'))}>
              <path d={geo.palate} fill={`url(#${uid}-palate)`} />
              <g clipPath={`url(#${uid}-pal)`} stroke={shadeHex(palateFill, -0.16)} strokeWidth={3.4} fill="none" strokeLinecap="round" opacity={0.6}>
                {geo.rugae.map((d, i) => <path key={i} d={d} />)}
                <path d={`M ${CX} ${geo.top + 24} L ${CX} ${geo.top + geo.upper.depth}`} strokeWidth={1.2} opacity={0.6} />
              </g>
              <ellipse cx={CX} cy={geo.top + 20} rx={6} ry={4.5} fill={shadeHex(palateFill, -0.08)} />
              <SoftMarks fx={softFx('PALATE')} x={CX} y={geo.top + geo.upper.depth * 0.55} />
            </g>
            <g {...part('GUM_UPPER', t('dental.soft.GUM_UPPER.name'))}>
              <path d={geo.archPath(true)} fill="none" stroke={shadeHex(softFill('GUM_UPPER', BASE.gum), -0.2)} strokeWidth={gumW + 3} strokeLinecap="round" strokeLinejoin="round" />
              <path d={geo.archPath(true)} fill="none" stroke={softFill('GUM_UPPER', BASE.gum)} strokeWidth={gumW} strokeLinecap="round" strokeLinejoin="round" />
              <path d={geo.archPath(true)} fill="none" stroke="#fff" strokeOpacity={0.18} strokeWidth={gumW * 0.35} strokeLinecap="round" />
              <SoftMarks fx={softFx('GUM_UPPER')} x={CX - 60} y={geo.top + 30} />
            </g>

            {/* lower jaw: tongue inside, gum, teeth */}
            <g {...part('TONGUE', t('dental.soft.TONGUE.name'))}>
              <path d={geo.tongue} fill={`url(#${uid}-tongue)`} stroke={shadeHex(tongueFill, -0.2)} strokeWidth={1} />
              <path d={`M ${CX} ${geo.tongueTip - 16} L ${CX} ${geo.tongueBack + 8}`} stroke={shadeHex(tongueFill, -0.22)} strokeWidth={1.6} opacity={0.6} strokeLinecap="round" />
              <SoftMarks fx={softFx('TONGUE')} x={CX + 14} y={(geo.tongueTip + geo.tongueBack) / 2} />
            </g>
            <g {...part('GUM_LOWER', t('dental.soft.GUM_LOWER.name'))}>
              <path d={geo.archPath(false)} fill="none" stroke={shadeHex(softFill('GUM_LOWER', BASE.gum), -0.2)} strokeWidth={gumW + 3} strokeLinecap="round" strokeLinejoin="round" />
              <path d={geo.archPath(false)} fill="none" stroke={softFill('GUM_LOWER', BASE.gum)} strokeWidth={gumW} strokeLinecap="round" strokeLinejoin="round" />
              <path d={geo.archPath(false)} fill="none" stroke="#fff" strokeOpacity={0.18} strokeWidth={gumW * 0.35} strokeLinecap="round" />
              <SoftMarks fx={softFx('GUM_LOWER')} x={CX + 60} y={geo.bottom - 30} />
            </g>

            {geo.placed.map((p) => {
              const id = p.slot.tooth.id;
              return (
                <g key={id} {...part(id, nameOf(id) ?? id)}>
                  <ToothGlyph p={p} a={a} look={state.look(id)} natural={natural} uid={uid} sel={sel === id} hov={hover.hover?.part === id} />
                </g>
              );
            })}
            {geo.placed.map((p) => (
              <text key={`l${p.slot.tooth.id}`} x={p.label[0]} y={p.label[1] + 3} textAnchor="middle" className={`svg-num ${sel === p.slot.tooth.id ? 'on' : ''}`}>
                {p.slot.tooth.id}
              </text>
            ))}
          </svg>
          {hover.hover && hoverInfo && (
            <HoverCard
              x={hover.hover.x} y={hover.hover.y} width={hover.wrap.current?.clientWidth ?? 600} info={hoverInfo} look={state.look(hover.hover.part)}
              labelOf={(c) => condLabel(hover.hover!.part, c)} sevLabel={sevLabel} hint={t(state.canEdit ? 'charts.clickEdit' : 'charts.clickView')}
            />
          )}
        </div>

        <div className="insp-col">
          <Inspector
            key={sel ?? ''}
            state={state}
            info={info(sel)}
            notesOnly={sel === 'MOUTH'}
            options={soft ? SOFT_CONDITIONS.map((k) => ({ key: k, label: t(`softCond.${k}`) })) : toothOptions(sel)}
            exclusive={soft ? [] : TOOTH_EXCLUSIVE}
            normalKey={soft ? 'NORMAL' : 'HEALTHY'}
            shades={soft ? SOFT_SHADES : TOOTH_SHADES}
            shadeLabel={(k) => t(soft ? `softShade.${k}` : `toothShade.${k}`)}
            naturalHex={soft ? BASE.gum : natural}
            empty={t('dental.pick')}
          />
          <button type="button" className={`btn ghost sm ${sel === 'MOUTH' ? 'on' : ''}`} style={{ marginTop: 8 }} onClick={() => state.select('MOUTH')}>
            ✎ {t('dental.general')}
          </button>
        </div>
      </div>
      <FindingsList state={state} nameOf={nameOf} labelOf={condLabel} empty={t('dental.noFindings')} />
      <p className="faint small" lang={locale}>{t('dental.legend')}</p>
    </div>
  );
}

/** Ulcer / lump / bleeding marks on soft tissue. */
function SoftMarks({ fx, x, y }: { fx: { ulcer: boolean; mass: boolean; bleed: boolean }; x: number; y: number }) {
  return (
    <>
      {fx.ulcer && <ellipse cx={x} cy={y} rx={7} ry={5} fill="#f4e9c8" stroke="#c9504e" strokeWidth={1.6} />}
      {fx.mass && <circle cx={x + 16} cy={y + 4} r={8} fill={mixHex('#d98c8c', '#b5656a', 0.4)} stroke="#8f4a4f" strokeWidth={0.8} />}
      {fx.bleed && <path d={`M ${x - 12} ${y - 6} q 3 6 0 10 q -3 -4 0 -10`} fill="#b3121f" />}
    </>
  );
}
