// Body tab (change request, 20 Nov 2026): the whole animal from the side — dog, cat, hamster, turtle or bird — with
// every part hoverable and clickable like the Dental and Vision tabs. Coat colour from the pet's "Colour" text, eye
// colour from the pet. Findings tint the part and are drawn on it; parts with findings are highlighted.
import { Fragment, useId, useMemo, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp, useQuery } from '../lib/app';
import { lastWeight, type PetRow } from '../db/repo';
import { ageParts } from '../lib/dates';
import { shadeHex } from '../lib/dental';
import { eyeHex } from '../lib/vision';
import {
  BODY_EXCLUSIVE, BODY_MODELS, BODY_SHADES, bodyConditions, bodyPalette, bodyPartName, bodyParts, resolvePart, splitPart,
  type BodyAnimal, type BodySide, type Shape,
} from '../lib/body';
import { FindingsList, HoverCard, Inspector, useChart, useHover, type PartInfo } from './ChartKit';
import { Badge } from './ui';

const FUR_ROLES = new Set(['coat', 'belly', 'face']);

export function BodyTab({ pet }: { pet: PetRow }) {
  const { t, fmt, locale } = useApp();
  const nav = useNavigate();
  const a = pet.species as BodyAnimal;
  const m = BODY_MODELS[a];
  const uid = useId().replace(/:/g, '');
  const [side, setSide] = useState<BodySide>('R');
  const state = useChart(pet.id, 'BODY');
  const hover = useHover();
  const weight = useQuery(() => lastWeight(pet.id), [pet.id]);
  const iris = a === 'DOG' || a === 'CAT' ? eyeHex(pet.eye_color ?? (a === 'CAT' ? 'AMBER' : 'BROWN'), 'OD') : a === 'TURTLE' ? '#4a3418' : '#151012';
  const pal = useMemo(() => bodyPalette(a, pet.color, iris), [a, pet.color, iris]);
  const age = pet.date_of_birth ? ageParts(pet.date_of_birth) : null;
  const sel = state.selected;

  // ---- names and descriptions (species-specific text first, then the general one)
  const tx = (key: string, fallback: string) => {
    const s = t(key);
    return s === key ? t(fallback) : s;
  };
  const nameOf = (part: string) => bodyPartName(t, a, part);
  const condLabel = (_p: string, c: string) => t(`bodyCond.${c}`);
  const roleOf = (part: string) => m.shapes.find((s) => resolvePart(s.part, side) === part || resolvePart(s.part, side === 'R' ? 'L' : 'R') === part)?.role;
  const info = (part: string | null): PartInfo | null => {
    if (!part) return null;
    if (part === 'NOTES') return { title: t('body.general'), about: t('body.generalHint') };
    const { base, side: s } = splitPart(part);
    const facts: [string, ReactNode][] = [];
    if (s) facts.push([t('body.sideLabel'), t(s === 'R' ? 'body.petRight' : 'body.petLeft')]);
    if (m.listOnly.includes(base)) facts.push([t('body.where'), t('body.wholeBody')]);
    return {
      title: nameOf(part) ?? part,
      subtitle: t(`species.${a}`),
      facts,
      about: tx(`body.about.${a}_${base}`, `body.about.${base}`),
    };
  };
  const sevLabel = (n: number) => t(`charts.sev${n}`);

  const partProps = (id: string, label: string) => ({
    role: 'button',
    tabIndex: 0,
    'aria-label': label,
    className: `part ${sel === id ? 'sel' : ''}`,
    onClick: (e: React.MouseEvent) => { e.stopPropagation(); state.select(id); },
    onKeyDown: (e: React.KeyboardEvent) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), state.select(id)),
    ...hover.bind(id),
  });

  const renderShape = (s: Shape, i: number) => {
    const id = resolvePart(s.part, side);
    const look = state.look(id);
    const base = pal[s.role] ?? '#999';
    const fill = s.far ? shadeHex(base, -0.22) : base;
    const anchor = m.anchors[s.part];
    const clipId = `${uid}-p${i}`;
    const on = sel === id;
    const hov = hover.hover?.part === id;
    const found = look.conditions.length > 0 || !!look.shade;
    const body = (
      <g {...partProps(id, nameOf(id) ?? id)}>
        <clipPath id={clipId}><path d={s.d} /></clipPath>
        {s.clip ? (
          // trunk regions are painted once underneath (soft belly fade); here they are only the click area
          <path d={s.d} fill="transparent" />
        ) : (
          <>
            <path d={s.d} fill={fill} stroke={shadeHex(fill, -0.35)} strokeWidth={1} />
            {FUR_ROLES.has(s.role) && <path d={s.d} fill={`url(#${uid}-tex)`} />}
            {(s.role === 'scale' || s.role === 'scale2') && <path d={s.d} fill={`url(#${uid}-scl)`} />}
            <path d={s.d} fill={`url(#${uid}-shade)`} />
          </>
        )}
        {look.shade && BODY_SHADES[look.shade] && <path d={s.d} fill={BODY_SHADES[look.shade]} opacity={0.5} />}
        {found && <path d={s.d} fill="#f0a020" opacity={on ? 0 : 0.16} />}
        {anchor && look.conditions.length > 0 && (
          <g clipPath={`url(#${clipId})`} pointerEvents="none">
            {look.conditions.map((c, k) => <Glyph key={c} c={c} at={anchor} k={k} sev={look.severity ?? 2} fill={fill} />)}
          </g>
        )}
        {(on || hov) && <path d={s.d} fill="var(--accent)" fillOpacity={on ? 0.22 : 0.12} stroke="var(--accent)" strokeWidth={on ? 2.4 : 1.6} />}
      </g>
    );
    // The trunk is painted once before its first region (coat, belly fade, throat, fur) and shaded after the last.
    const prev = m.shapes[i - 1];
    const next = m.shapes[i + 1];
    return (
      <Fragment key={`${s.part}-${i}`}>
        {s.clip && !prev?.clip && (
          <g pointerEvents="none">
            <path d={m.torso} fill={pal.coat} />
            <path d={m.torso} fill={`url(#${uid}-belly)`} />
            {a === 'BIRD' && <path d={m.torso} fill={`url(#${uid}-throat)`} />}
            <path d={m.torso} fill={`url(#${uid}-tex)`} />
          </g>
        )}
        {s.clip ? <g clipPath={`url(#${uid}-torso)`}>{body}</g> : body}
        {s.clip && !next?.clip && (
          <g pointerEvents="none">
            <path d={m.torso} fill={`url(#${uid}-shade)`} />
            <path d={m.torso} fill="none" stroke={shadeHex(pal.coat, -0.4)} strokeWidth={1.2} />
          </g>
        )}
      </Fragment>
    );
  };

  const hoverInfo = hover.hover ? info(hover.hover.part) : null;
  const parts = bodyParts(a);
  const opts = (part: string | null) => (part ? bodyConditions(a, part) : []).map((k) => ({ key: k, label: t(`bodyCond.${k}`) }));
  const selRole = sel ? roleOf(sel) : undefined;
  const linkTab = (a === 'DOG' || a === 'CAT') && sel ? (splitPart(sel).base === 'EYES' ? 'vision' : splitPart(sel).base === 'MOUTH' ? 'dental' : null) : null;
  const mirror = side === 'L' ? `translate(${m.w} 0) scale(-1 1)` : undefined;

  return (
    <div className="clin-chart">
      <div className="row clin-head">
        <p className="note" style={{ margin: 0, flex: 1, minWidth: 220 }}>
          {age && <b>{t('dental.age', { age: t('pets.ageValue', { y: age.years, m: age.months }) })} · </b>}
          {weight && <>{t('pets.lastWeight')}: {fmt.num(weight.weight_kg, 2)} {t('common.kg')} · </>}
          {pet.color ? t('body.colour', { c: pet.color }) : t('body.colourNotSet')}
        </p>
        <div className="field" style={{ gap: 2 }}>
          <span>{t('body.view')}</span>
          <div className="seg">
            {(['R', 'L'] as BodySide[]).map((s) => (
              <button key={s} type="button" className={side === s ? 'on' : ''} onClick={() => setSide(s)}>{t(s === 'R' ? 'body.rightSide' : 'body.leftSide')}</button>
            ))}
          </div>
        </div>
      </div>
      <p className="faint small" style={{ margin: '8px 0 0' }}>{t(state.canEdit ? 'charts.hoverHint' : 'charts.hoverHintRO')}</p>

      <div className="clin-grid">
        <div>
          <div className="clin-stage" ref={hover.wrap} onPointerLeave={hover.clear}>
            <svg viewBox={`0 0 ${m.w} ${m.h}`} style={{ direction: 'ltr' }} className="body-svg" role="img" aria-label={t('petRecord.body')}>
              <defs>
                <clipPath id={`${uid}-torso`}><path d={m.torso} /></clipPath>
                <linearGradient id={`${uid}-shade`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0" stopColor="#fff" stopOpacity={0.28} />
                  <stop offset="0.45" stopColor="#fff" stopOpacity={0} />
                  <stop offset="1" stopColor="#000" stopOpacity={0.28} />
                </linearGradient>
                <linearGradient id={`${uid}-belly`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0.4" stopColor={pal.belly} stopOpacity={0} />
                  <stop offset="0.72" stopColor={pal.belly} stopOpacity={1} />
                </linearGradient>
                <radialGradient id={`${uid}-throat`} cx="0.18" cy="0.12" r="0.5">
                  <stop offset="0.3" stopColor={pal.face} stopOpacity={1} />
                  <stop offset="1" stopColor={pal.face} stopOpacity={0} />
                </radialGradient>
                <pattern id={`${uid}-tex`} width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(28)">
                  <path d={m.texture === 'feather' ? 'M 0 5 Q 3.5 1 7 5' : 'M 1 0 L 1 4 M 4.5 3 L 4.5 7'} stroke="#000" strokeOpacity={0.09} strokeWidth={0.9} fill="none" />
                </pattern>
                <pattern id={`${uid}-scl`} width="8" height="6" patternUnits="userSpaceOnUse">
                  <path d="M 0 3 Q 2 0 4 3 Q 6 6 8 3" stroke="#000" strokeOpacity={0.14} strokeWidth={0.8} fill="none" />
                </pattern>
                <filter id={`${uid}-soft`} x="-40%" y="-40%" width="180%" height="180%"><feGaussianBlur stdDeviation="2.2" /></filter>
              </defs>
              <ellipse cx={m.w / 2 - 10} cy={m.h - 12} rx={m.w * 0.36} ry={9} fill="#000" opacity={0.08} />
              <g transform={mirror}>
                {m.shapes.map(renderShape)}
                {m.decor.map((d, i) => {
                  const el = <path key={i} d={d.d} fill={d.fill ?? 'none'} stroke={d.stroke} strokeWidth={d.w} strokeLinecap="round" pointerEvents="none" />;
                  return d.clip ? <g key={i} clipPath={`url(#${uid}-torso)`}>{el}</g> : el;
                })}
              </g>
              <text x={m.w / 2} y={16} textAnchor="middle" className="svg-lbl">{t(side === 'R' ? 'body.petRight' : 'body.petLeft')}</text>
            </svg>
            {hover.hover && hoverInfo && (
              <HoverCard
                x={hover.hover.x} y={hover.hover.y} width={hover.wrap.current?.clientWidth ?? 600} info={hoverInfo} look={state.look(hover.hover.part)}
                labelOf={(c) => t(`bodyCond.${c}`)} sevLabel={sevLabel} hint={t(state.canEdit ? 'charts.clickEdit' : 'charts.clickView')}
              />
            )}
          </div>
          <ul className="body-parts">
            {parts.map((p) => {
              const l = state.look(p);
              return (
                <li key={p}>
                  <button type="button" className={sel === p ? 'on' : ''} onClick={() => state.select(p)} {...hover.bind(p)}>
                    <span>{nameOf(p)}</span>
                    {l.conditions.length ? <Badge kind="warn">{l.conditions.map((c) => t(`bodyCond.${c}`)).join(', ')}</Badge> : l.notes || l.shade ? <span className="faint">✎</span> : null}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
        <div className="insp-col">
          <Inspector
            key={sel ?? ''}
            state={state}
            info={info(sel)}
            notesOnly={sel === 'NOTES'}
            options={opts(sel)}
            exclusive={BODY_EXCLUSIVE}
            normalKey="NORMAL"
            shades={sel && !m.listOnly.includes(sel) ? BODY_SHADES : undefined}
            shadeLabel={(k) => t(`bodyShade.${k}`)}
            naturalHex={selRole ? pal[selRole] : pal.coat}
            empty={t('body.pick')}
          />
          {linkTab && (
            <button type="button" className="btn sm" style={{ marginTop: 8 }} onClick={() => nav(`/pets/${pet.id}?tab=${linkTab}`)}>
              {t(linkTab === 'vision' ? 'body.openVision' : 'body.openDental')}
            </button>
          )}
          <button type="button" className={`btn ghost sm ${sel === 'NOTES' ? 'on' : ''}`} style={{ marginTop: 8 }} onClick={() => state.select('NOTES')}>
            ✎ {t('body.general')}
          </button>
        </div>
      </div>
      <FindingsList state={state} nameOf={nameOf} labelOf={condLabel} empty={t('body.noFindings')} />
      <p className="faint small" lang={locale}>{t('body.legend')}</p>
    </div>
  );
}

/** A finding drawn on the part, around its anchor point (several findings are spread a little). */
function Glyph({ c, at, k, sev, fill }: { c: string; at: [number, number, number]; k: number; sev: number; fill: string }) {
  const [x0, y0, r0] = at;
  const f = 0.7 + 0.15 * sev;
  const r = r0 * f;
  const x = x0 + (k % 2 ? r0 * 0.5 : 0) * (k > 1 ? -1 : 1);
  const y = y0 + (k ? r0 * 0.35 * Math.ceil(k / 2) : 0);
  const dots = (n: number, col: string, size: number) =>
    Array.from({ length: n }, (_, i) => {
      const ang = i * 2.399;
      const d = r * 0.75 * Math.sqrt((i + 0.5) / n);
      return <circle key={i} cx={x + Math.cos(ang) * d} cy={y + Math.sin(ang) * d} r={size} fill={col} />;
    });
  switch (c) {
    case 'WOUND':
      return (
        <g>
          <ellipse cx={x} cy={y} rx={r * 0.9} ry={r * 0.35} fill="#c0392b" opacity={0.35} />
          <path d={`M ${x - r * 0.8} ${y} l ${r * 0.3} ${-r * 0.2} l ${r * 0.3} ${r * 0.25} l ${r * 0.35} ${-r * 0.25} l ${r * 0.35} ${r * 0.2} l ${r * 0.3} ${-r * 0.15}`} stroke="#8e1a20" strokeWidth={Math.max(1.4, r * 0.14)} fill="none" strokeLinecap="round" />
        </g>
      );
    case 'LUMP': case 'HERNIA': case 'ABSCESS':
      return (
        <g>
          <circle cx={x} cy={y} r={r * 0.55} fill={c === 'ABSCESS' ? '#e6c56a' : shadeHex(fill, 0.12)} stroke={shadeHex(fill, -0.45)} strokeWidth={1.2} />
          <circle cx={x - r * 0.18} cy={y - r * 0.2} r={r * 0.18} fill="#fff" opacity={0.55} />
        </g>
      );
    case 'SWELLING': case 'CHEMOSIS':
      return <ellipse cx={x} cy={y} rx={r * 1.2} ry={r * 0.9} fill="#e77d7d" opacity={0.42} />;
    case 'PAIN':
      return (
        <g stroke="#d03a2f" strokeWidth={1.6} strokeLinecap="round">
          {Array.from({ length: 8 }, (_, i) => {
            const a = (i / 8) * Math.PI * 2;
            return <line key={i} x1={x + Math.cos(a) * r * 0.45} y1={y + Math.sin(a) * r * 0.45} x2={x + Math.cos(a) * r * 0.95} y2={y + Math.sin(a) * r * 0.95} />;
          })}
        </g>
      );
    case 'REDNESS': case 'BURN':
      return <ellipse cx={x} cy={y} rx={r * 1.3} ry={r} fill={c === 'BURN' ? '#8e2a22' : '#e0473f'} opacity={0.45} />;
    case 'RASH':
      return <g>{dots(10, '#d23b3b', Math.max(1, r * 0.08))}</g>;
    case 'HAIR_LOSS': case 'FEATHER_LOSS': case 'SCUTE_LOSS':
      return <ellipse cx={x} cy={y} rx={r * 0.95} ry={r * 0.7} fill={c === 'SCUTE_LOSS' ? '#c9b48a' : '#efc3b8'} stroke="#c98d84" strokeWidth={1} strokeDasharray="2 2" />;
    case 'PLUCKING':
      return (
        <g>
          <ellipse cx={x} cy={y} rx={r * 0.9} ry={r * 0.65} fill="#efc3b8" />
          <path d={`M ${x - r * 0.5} ${y - r * 0.2} l ${r * 0.2} ${r * 0.3} M ${x} ${y - r * 0.3} l ${r * 0.1} ${r * 0.35} M ${x + r * 0.4} ${y - r * 0.1} l ${-r * 0.15} ${r * 0.35}`} stroke="#6b5040" strokeWidth={1.2} />
        </g>
      );
    case 'STRESS_BARS':
      return <path d={`M ${x - r} ${y - r * 0.3} h ${r * 2} M ${x - r} ${y} h ${r * 2} M ${x - r} ${y + r * 0.3} h ${r * 2}`} stroke="#3a2a2a" strokeWidth={1.2} opacity={0.7} />;
    case 'PARASITES': case 'MITES':
      return <g>{dots(c === 'MITES' ? 9 : 7, '#2a1d14', Math.max(1, r * 0.09))}</g>;
    case 'DISCHARGE': case 'DROOLING':
      return <path d={`M ${x} ${y - r * 0.3} q ${r * 0.35} ${r * 0.6} 0 ${r * 0.95} q ${-r * 0.35} ${-r * 0.35} 0 ${-r * 0.95} Z`} fill={c === 'DROOLING' ? '#cfe3ef' : '#cdd36a'} stroke="#8c8f35" strokeWidth={0.8} />;
    case 'OTITIS':
      return <g><ellipse cx={x} cy={y} rx={r} ry={r * 0.8} fill="#d84a3c" opacity={0.4} />{dots(5, '#5a3a1a', Math.max(1, r * 0.1))}</g>;
    case 'ITCHING':
      return <path d={`M ${x - r * 0.6} ${y - r * 0.5} l ${r * 0.4} ${r} M ${x - r * 0.15} ${y - r * 0.55} l ${r * 0.4} ${r} M ${x + r * 0.3} ${y - r * 0.5} l ${r * 0.4} ${r}`} stroke="#c0392b" strokeWidth={1.4} strokeLinecap="round" />;
    case 'SCAR':
      return <path d={`M ${x - r * 0.8} ${y} L ${x + r * 0.8} ${y} ${[-0.5, -0.15, 0.2, 0.55].map((k2) => `M ${x + r * k2} ${y - r * 0.2} l 0 ${r * 0.4}`).join(' ')}`} stroke="#7a4b4b" strokeWidth={1.3} />;
    case 'FRACTURE': case 'CRACK': case 'BROKEN':
      return <path d={`M ${x - r * 0.3} ${y - r} l ${r * 0.5} ${r * 0.5} l ${-r * 0.4} ${r * 0.3} l ${r * 0.5} ${r * 0.5} l ${-r * 0.3} ${r * 0.6}`} stroke="#1e1a1a" strokeWidth={Math.max(1.6, r * 0.12)} fill="none" strokeLinejoin="round" />;
    case 'LAMENESS': case 'DROOPING':
      return <path d={`M ${x - r * 0.6} ${y - r * 0.4} q ${r * 0.6} ${-r * 0.6} ${r * 1.1} 0 m 0 0 l ${-r * 0.3} ${-r * 0.05} m ${r * 0.3} ${r * 0.05} l ${-r * 0.05} ${-r * 0.3}`} stroke="#c47a12" strokeWidth={1.6} fill="none" strokeLinecap="round" />;
    case 'OVERGROWN_NAILS':
      return <path d={`M ${x - r * 0.6} ${y + r * 0.2} q ${-r * 0.6} ${r * 0.3} ${-r * 0.9} ${r * 0.9} M ${x - r * 0.1} ${y + r * 0.3} q ${-r * 0.5} ${r * 0.35} ${-r * 0.75} ${r * 0.95} M ${x + r * 0.4} ${y + r * 0.3} q ${-r * 0.4} ${r * 0.4} ${-r * 0.6} ${r * 0.95}`} stroke="#2e2622" strokeWidth={1.4} fill="none" strokeLinecap="round" />;
    case 'OVERGROWN':
      return <path d={`M ${x - r * 0.35} ${y} L ${x + r * 0.35} ${y} L ${x + r * 0.15} ${y + r * 2.4} C ${x} ${y + r * 2.6} ${x - r * 0.1} ${y + r * 2.5} ${x - r * 0.2} ${y + r * 2.3} Z`} fill={shadeHex(fill, 0.1)} stroke={shadeHex(fill, -0.4)} strokeWidth={1} />;
    case 'MISALIGNED':
      return <path d={`M ${x - r * 0.5} ${y - r * 0.5} L ${x + r * 0.5} ${y + r * 0.5} M ${x + r * 0.5} ${y - r * 0.5} L ${x - r * 0.5} ${y + r * 0.5}`} stroke="#b0532a" strokeWidth={1.6} />;
    case 'FLAKING': case 'DRY_SCALY': case 'RETAINED_SHED': case 'DULL': case 'FUNGAL':
      return <g>{Array.from({ length: 8 }, (_, i) => <rect key={i} x={x + Math.cos(i * 2.4) * r * 0.7 - 1.5} y={y + Math.sin(i * 2.4) * r * 0.6 - 1} width={3.2} height={2} fill={c === 'FUNGAL' ? '#f0f0e0' : '#fbf8f2'} opacity={0.9} transform={`rotate(${i * 37} ${x} ${y})`} />)}</g>;
    case 'SHELL_ROT':
      return <g>{[[0, 0, 0.45], [-0.6, 0.3, 0.3], [0.55, -0.25, 0.28]].map(([dx, dy, rr], i) => <circle key={i} cx={x + dx * r} cy={y + dy * r} r={rr * r} fill="#e8dcc0" stroke="#5a3c22" strokeWidth={1.2} opacity={0.9} />)}</g>;
    case 'PYRAMIDING':
      return <g>{[-0.7, 0, 0.7].map((dx, i) => <path key={i} d={`M ${x + dx * r - r * 0.3} ${y + r * 0.2} L ${x + dx * r} ${y - r * 0.45} L ${x + dx * r + r * 0.3} ${y + r * 0.2} Z`} fill={shadeHex(fill, 0.15)} stroke={shadeHex(fill, -0.45)} strokeWidth={1} />)}</g>;
    case 'SOFT_SHELL':
      return <path d={`M ${x - r * 1.2} ${y} q ${r * 0.3} ${-r * 0.3} ${r * 0.6} 0 t ${r * 0.6} 0 t ${r * 0.6} 0 t ${r * 0.6} 0`} stroke="#e9e0c4" strokeWidth={2} fill="none" />;
    case 'IMPACTED': case 'CROP_STASIS': case 'DISTENDED':
      return <ellipse cx={x} cy={y} rx={r * 1.15} ry={r * 0.95} fill="#d9a55a" fillOpacity={0.25} stroke="#a0662a" strokeWidth={1.4} strokeDasharray="4 3" />;
    case 'WET_TAIL': case 'SOILING':
      return <ellipse cx={x} cy={y} rx={r * 1.3} ry={r * 1.1} fill="#6b4a22" opacity={0.55} filter="none" />;
    case 'PROLAPSE':
      return <circle cx={x} cy={y} r={r * 0.6} fill="#c8384a" stroke="#7d1d2a" strokeWidth={1} />;
    case 'BUMBLEFOOT':
      return <circle cx={x} cy={y + r * 0.2} r={r * 0.55} fill="#a8553a" stroke="#6b2f1e" strokeWidth={1} />;
    case 'PROMINENT_KEEL':
      return <path d={`M ${x - r * 0.2} ${y - r} C ${x - r * 0.5} ${y}, ${x - r * 0.4} ${y + r * 0.6}, ${x} ${y + r}`} stroke="#4a3328" strokeWidth={2.2} fill="none" />;
    case 'BAND_TIGHT':
      return <rect x={x - r * 0.9} y={y - r * 0.35} width={r * 1.8} height={r * 0.7} rx={1.5} fill="#9aa3ad" stroke="#5c646c" strokeWidth={0.8} />;
    case 'CLOUDY':
      return <circle cx={x} cy={y} r={r * 0.7} fill="#e8f0f6" opacity={0.8} />;
    case 'BAD_BREATH':
      return <path d={`M ${x - r} ${y - r * 0.6} q ${r * 0.25} ${-r * 0.3} ${r * 0.5} 0 t ${r * 0.5} 0 M ${x - r} ${y - r * 0.2} q ${r * 0.25} ${-r * 0.3} ${r * 0.5} 0 t ${r * 0.5} 0`} stroke="#7c8b3a" strokeWidth={1.2} fill="none" />;
    case 'DRY_CRACKED':
      return <path d={`M ${x - r * 0.5} ${y - r * 0.4} l ${r * 0.3} ${r * 0.4} l ${r * 0.4} ${-r * 0.2} M ${x} ${y} l ${r * 0.1} ${r * 0.5}`} stroke="#5b3a2a" strokeWidth={1} fill="none" />;
    case 'BROWN_HYPERTROPHY': case 'DISCOLOURED':
      return <ellipse cx={x} cy={y} rx={r * 0.9} ry={r * 0.7} fill="#8b5a2b" opacity={0.65} />;
    default:
      return <circle cx={x} cy={y} r={Math.max(2.5, r * 0.25)} fill="#d9534f" stroke="#fff" strokeWidth={1} />;
  }
}
