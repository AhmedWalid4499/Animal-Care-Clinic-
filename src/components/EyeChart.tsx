// Vision tab (change request, 19 Nov 2026): both eyes as you face the pet — its right eye (OD) on the viewer's left.
// The iris takes the eye colour chosen on the pet (blue-grey in puppies and kittens); dogs have round pupils,
// cats vertical slits. Every part can be hovered for what it is and clicked to record a finding.
import { useId, useMemo, type ReactNode } from 'react';
import { useApp } from '../lib/app';
import type { PetRow } from '../db/repo';
import { ageParts } from '../lib/dates';
import { ageMonths, shadeHex } from '../lib/dental';
import {
  EYE_CONDITIONS, EYE_PARTS, IRIS_COLORS, defaultEyeColor, eyeAge, eyeHex, irisAtAge, partKey,
  type EyePart, type EyeSide,
} from '../lib/vision';
import { FindingsList, HoverCard, Inspector, useChart, useHover, type ChartState, type Look, type PartInfo } from './ChartKit';
import { Badge } from './ui';

const VW = 320;
const VH = 220;
const C: [number, number] = [160, 110];

interface Geo { upper: string; lower: string; opening: string; irisR: number; lat: [number, number]; med: [number, number]; low: string; droop: string; droopBack: string }
/** Base geometry with the inner corner (nose side) on the right; the left eye is drawn mirrored. */
function geometry(cat: boolean): Geo {
  if (cat) {
    const lat: [number, number] = [56, 98];
    const med: [number, number] = [262, 122];
    const upper = `M ${lat} C 88 30, 222 26, ${med}`;
    const lower = `M ${med} C 232 190, 96 186, ${lat}`;
    return { upper, lower, opening: `${upper} C 232 190, 96 186, ${lat} Z`, irisR: 64, lat, med, low: '232 190, 96 186', droop: '236 224, 94 220', droopBack: '94 220, 236 224' };
  }
  const lat: [number, number] = [52, 110];
  const med: [number, number] = [266, 112];
  const upper = `M ${lat} C 92 40, 216 32, ${med}`;
  const lower = `M ${med} C 226 172, 98 176, ${lat}`;
  return { upper, lower, opening: `${upper} C 226 172, 98 176, ${lat} Z`, irisR: 59, lat, med, low: '226 172, 98 176', droop: '228 206, 92 210', droopBack: '92 210, 228 206' };
}

function seeded(n: number) {
  let s = n;
  return () => ((s = (s * 9301 + 49297) % 233280) / 233280);
}

function Eye({ side, cat, adultIris, blue, closed, state, uid, part }: {
  side: EyeSide; cat: boolean; adultIris: string; blue: number; closed: boolean; state: ChartState; uid: string;
  part: (k: string, label: string) => object;
}) {
  const { t } = useApp();
  const g = geometry(cat);
  const L = (p: EyePart) => state.look(partKey(side, p));
  const has = (p: EyePart, c: string) => L(p).conditions.includes(c);
  const sev = (p: EyePart) => 0.6 + 0.2 * (L(p).severity ?? 2);
  const iris = irisAtAge(L('IRIS').shade ? eyeHex(L('IRIS').shade, side) : adultIris, L('IRIS').shade ? 0 : blue);
  const glaucoma = has('GLOBE', 'GLAUCOMA');
  const enucleated = has('GLOBE', 'ENUCLEATED');
  const r = g.irisR * (glaucoma ? 1.09 : 1);
  const dilated = has('PUPIL', 'DILATED') || glaucoma || has('GLOBE', 'BLIND');
  const constricted = has('PUPIL', 'CONSTRICTED') || has('IRIS', 'UVEITIS');
  const [prx, pry] = cat
    ? dilated ? [r * 0.66, r * 0.74] : constricted ? [2.6, r * 0.66] : [7.5, r * 0.72]
    : dilated ? [r * 0.68, r * 0.68] : constricted ? [8, 8] : [19, 19];
  const pupil = `M ${C[0] - prx} ${C[1]} A ${prx} ${pry} 0 1 0 ${C[0] + prx} ${C[1]} A ${prx} ${pry} 0 1 0 ${C[0] - prx} ${C[1]} Z`;
  const id = (k: string) => `${uid}-${side}-${k}`;
  const fibres = useMemo(() => {
    const rnd = seeded(side === 'OD' ? 7 : 11);
    return Array.from({ length: 84 }, (_, i) => {
      const a = (i / 84) * Math.PI * 2 + rnd() * 0.05;
      const r0 = 14 + rnd() * 8;
      const r1 = 0.78 + rnd() * 0.2;
      return { a, r0, r1, light: rnd() > 0.5, o: 0.18 + rnd() * 0.25 };
    });
  }, [side]);
  const sclera = has('CONJUNCTIVA', 'JAUNDICE') ? '#efd77f' : has('CONJUNCTIVA', 'REDNESS') ? '#f0b9b3' : '#f3ece3';
  const lid = '#2b1c17';
  const skin = '#b99c7e';
  const lowerLid = has('EYELIDS', 'ECTROPION') ? `M ${g.med} C ${g.droop}, ${g.lat}` : g.lower;
  const mirror = side === 'OS' ? `translate(${VW} 0) scale(-1 1)` : undefined;
  const hs = side === 'OS' ? -1 : 1;
  const hitStroke = { fill: 'none', stroke: 'transparent', strokeWidth: 18, pointerEvents: 'stroke' } as const;

  const thirdBig = has('THIRD_EYELID', 'PROTRUDING');
  const third = thirdBig
    ? `M ${g.med[0] - 2} ${g.med[1] - 46} C ${g.med[0] - 60} ${g.med[1] - 30}, ${g.med[0] - 62} ${g.med[1] + 34}, ${g.med[0] - 8} ${g.med[1] + 44} C ${g.med[0] + 4} ${g.med[1] + 10}, ${g.med[0] + 4} ${g.med[1] - 20}, ${g.med[0] - 2} ${g.med[1] - 46} Z`
    : `M ${g.med[0] - 4} ${g.med[1] - 20} C ${g.med[0] - 26} ${g.med[1] - 12}, ${g.med[0] - 28} ${g.med[1] + 14}, ${g.med[0] - 8} ${g.med[1] + 22} C ${g.med[0] + 2} ${g.med[1] + 8}, ${g.med[0] + 2} ${g.med[1] - 10}, ${g.med[0] - 4} ${g.med[1] - 20} Z`;

  return (
    <svg viewBox={`0 0 ${VW} ${VH}`} style={{ direction: 'ltr' }} className="eye-svg" role="img" aria-label={t(`vision.eye${side}`)}>
      <defs>
        <radialGradient id={id('fur')} cx="50%" cy="50%" r="60%">
          <stop offset="0.55" stopColor={skin} />
          <stop offset="1" stopColor={shadeHex(skin, -0.25)} />
        </radialGradient>
        <radialGradient id={id('iris')} cx="50%" cy="50%" r="50%">
          <stop offset="0.12" stopColor={shadeHex(iris, -0.35)} />
          <stop offset="0.3" stopColor={shadeHex(iris, 0.28)} />
          <stop offset="0.62" stopColor={iris} />
          <stop offset="0.9" stopColor={shadeHex(iris, -0.3)} />
          <stop offset="1" stopColor={shadeHex(iris, -0.6)} />
        </radialGradient>
        <radialGradient id={id('pupil')} cx="50%" cy="55%" r="55%">
          <stop offset="0" stopColor={cat ? '#1d3a2c' : '#18232b'} />
          <stop offset="0.6" stopColor="#09090c" />
          <stop offset="1" stopColor="#020203" />
        </radialGradient>
        <radialGradient id={id('scl')} cx="50%" cy="50%" r="60%">
          <stop offset="0.5" stopColor={sclera} />
          <stop offset="1" stopColor={shadeHex(sclera, -0.18)} />
        </radialGradient>
        <radialGradient id={id('ns')} cx="50%" cy="50%" r="50%">
          <stop offset="0" stopColor="#c9d6e6" stopOpacity={0.85} />
          <stop offset="0.7" stopColor="#9fb2c8" stopOpacity={0.45} />
          <stop offset="1" stopColor="#9fb2c8" stopOpacity={0} />
        </radialGradient>
        <radialGradient id={id('cat')} cx="45%" cy="40%" r="60%">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="0.7" stopColor="#dfe8ef" />
          <stop offset="1" stopColor="#b8c7d4" />
        </radialGradient>
        <clipPath id={id('open')}><path d={g.opening} /></clipPath>
        <clipPath id={id('pup')}><path d={pupil} /></clipPath>
        <clipPath id={id('cornea')}><circle cx={C[0]} cy={C[1]} r={r + 2} /></clipPath>
        <filter id={id('soft')} x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="2.2" /></filter>
      </defs>
      <g transform={mirror}>
        <rect x={0} y={0} width={VW} height={VH} rx={10} fill={`url(#${id('fur')})`} />
        {has('EYELIDS', 'SWELLING') && <path d={g.opening} fill="none" stroke="#e3a097" strokeWidth={22 * sev('EYELIDS')} opacity={0.7} filter={`url(#${id('soft')})`} />}
        {closed || enucleated ? (
          <g {...part(partKey(side, 'EYELIDS'), t('vision.part.EYELIDS'))}>
            <path d={`M ${g.lat} C 110 ${C[1] + 26}, 210 ${C[1] + 26}, ${g.med}`} fill="none" stroke={lid} strokeWidth={4} strokeLinecap="round" />
            <path d={`M ${g.lat} C 110 ${C[1] + 30}, 210 ${C[1] + 30}, ${g.med}`} fill="none" stroke={shadeHex(skin, -0.35)} strokeWidth={2} opacity={0.6} />
            {enucleated && [0.3, 0.42, 0.54, 0.66, 0.78].map((k) => {
              const x = g.lat[0] + (g.med[0] - g.lat[0]) * k;
              return <path key={k} d={`M ${x} ${C[1] + 10} L ${x + 4} ${C[1] + 34}`} stroke="#3a6fb0" strokeWidth={1.5} />;
            })}
            <path d={`M ${g.lat} C 110 ${C[1] + 26}, 210 ${C[1] + 26}, ${g.med}`} {...hitStroke} strokeWidth={28} />
          </g>
        ) : (
          <>
            {/* white of the eye / conjunctiva, behind the iris */}
            <g {...part(partKey(side, 'CONJUNCTIVA'), t('vision.part.CONJUNCTIVA'))}>
              <path d={g.opening} fill={`url(#${id('scl')})`} />
              <g clipPath={`url(#${id('open')})`}>
                {(has('CONJUNCTIVA', 'REDNESS') || glaucoma) && [0, 1, 2, 3, 4, 5].map((k) => {
                  const y0 = C[1] - 40 + k * 16;
                  const x0 = k % 2 ? g.lat[0] + 6 : g.med[0] - 6;
                  const dir = k % 2 ? 1 : -1;
                  return <path key={k} d={`M ${x0} ${y0} q ${dir * 14} 6 ${dir * 22} -2 t ${dir * 18} 4`} stroke="#c8343e" strokeWidth={1.2} fill="none" opacity={0.75 * sev('CONJUNCTIVA')} />;
                })}
                {has('CONJUNCTIVA', 'CHEMOSIS') && <path d={g.opening} fill="none" stroke="#f0a8a2" strokeWidth={22 * sev('CONJUNCTIVA')} opacity={0.75} />}
              </g>
            </g>

            <g clipPath={`url(#${id('open')})`}>
              {/* iris */}
              <g {...part(partKey(side, 'IRIS'), t('vision.part.IRIS'))}>
                <circle cx={C[0]} cy={C[1]} r={r} fill={`url(#${id('iris')})`} />
                {fibres.map((f, i) => (
                  <line key={i} x1={C[0] + Math.cos(f.a) * f.r0} y1={C[1] + Math.sin(f.a) * f.r0} x2={C[0] + Math.cos(f.a) * r * f.r1} y2={C[1] + Math.sin(f.a) * r * f.r1}
                    stroke={f.light ? shadeHex(iris, 0.45) : shadeHex(iris, -0.45)} strokeWidth={0.9} opacity={f.o} />
                ))}
                <circle cx={C[0]} cy={C[1]} r={r - 1} fill="none" stroke={shadeHex(iris, -0.65)} strokeWidth={3} opacity={0.55} />
                {has('IRIS', 'UVEITIS') && <circle cx={C[0]} cy={C[1]} r={r} fill="#8c2f2a" opacity={0.32 * sev('IRIS')} />}
                {has('IRIS', 'ATROPHY') && [0.6, 2.2, 4.1].map((a) => <ellipse key={a} cx={C[0] + Math.cos(a) * (prx + 12)} cy={C[1] + Math.sin(a) * (pry * 0.6 + 10)} rx={5} ry={3} fill="#0b0b0d" opacity={0.75} />)}
                {has('IRIS', 'MELANOSIS') && [0.9, 2.6, 3.7, 5.3].map((a) => <circle key={a} cx={C[0] + Math.cos(a) * r * 0.7} cy={C[1] + Math.sin(a) * r * 0.7} r={4 * sev('IRIS')} fill="#2a1a12" opacity={0.85} />)}
              </g>
              {/* pupil, with the lens seen through it */}
              <g {...part(partKey(side, 'PUPIL'), t('vision.part.PUPIL'))}>
                <path d={pupil} fill={`url(#${id('pupil')})`} />
              </g>
              <g clipPath={`url(#${id('pup')})`} pointerEvents="none">
                {has('LENS', 'NUCLEAR_SCLEROSIS') && <ellipse cx={C[0]} cy={C[1]} rx={Math.max(prx, 10) * 0.75} ry={Math.max(pry, 10) * 0.75} fill={`url(#${id('ns')})`} />}
                {has('LENS', 'CATARACT') && <path d={pupil} fill={`url(#${id('cat')})`} opacity={0.6 + 0.12 * (L('LENS').severity ?? 2)} />}
                {has('LENS', 'CATARACT_EARLY') && Array.from({ length: 10 }, (_, k) => {
                  const a = (k / 10) * Math.PI * 2;
                  return <line key={k} x1={C[0] + Math.cos(a) * 3} y1={C[1] + Math.sin(a) * 3} x2={C[0] + Math.cos(a) * 30} y2={C[1] + Math.sin(a) * 30} stroke="#eef3f7" strokeWidth={2.4} opacity={0.75} strokeLinecap="round" />;
                })}
                {has('LENS', 'LUXATION') && <circle cx={C[0] - 8} cy={C[1] + 9} r={Math.max(prx, pry) * 0.85} fill="none" stroke="#e8f0f5" strokeWidth={2.5} opacity={0.85} />}
              </g>
              <g {...part(partKey(side, 'LENS'), t('vision.part.LENS'))}>
                <ellipse cx={C[0]} cy={C[1]} rx={Math.max(4, prx * 0.55)} ry={Math.max(6, pry * 0.4)} fill="transparent" />
              </g>

              {/* cornea: the clear dome over iris and pupil */}
              <g clipPath={`url(#${id('cornea')})`} pointerEvents="none">
                {(has('CORNEA', 'EDEMA') || glaucoma) && <circle cx={C[0]} cy={C[1]} r={r + 2} fill="#cfe0f0" opacity={0.3 + 0.12 * (L('CORNEA').severity ?? 2)} />}
                {has('CORNEA', 'VESSELS') && [-0.6, -0.2, 0.25].map((a) => (
                  <path key={a} d={`M ${C[0] + Math.cos(a - Math.PI / 2) * r} ${C[1] + Math.sin(a - Math.PI / 2) * r} q 6 14 ${Math.cos(a + Math.PI / 2) * 6} ${22 * sev('CORNEA')} t 4 14`} stroke="#c42d36" strokeWidth={1.3} fill="none" opacity={0.85} />
                ))}
                {has('CORNEA', 'PIGMENT') && <ellipse cx={C[0] + r * 0.72} cy={C[1] + 4} rx={18 * sev('CORNEA')} ry={24 * sev('CORNEA')} fill="#4a2d1c" opacity={0.75} filter={`url(#${id('soft')})`} />}
                {has('CORNEA', 'SCAR') && <path d={`M ${C[0] - 22} ${C[1] - 8} q 10 -14 24 -6 q 12 8 2 18 q -14 10 -24 0 z`} fill="#f4f6f7" opacity={0.8} filter={`url(#${id('soft')})`} />}
                {has('CORNEA', 'ULCER') && <ellipse cx={C[0] - 18} cy={C[1] + 14} rx={11 * sev('CORNEA')} ry={8 * sev('CORNEA')} fill="#38d65a" opacity={0.78} filter={`url(#${id('soft')})`} />}
              </g>
              <g pointerEvents="none" opacity={has('CORNEA', 'DRY') ? 0.25 : 1}>
                {/* the light comes from the same side for both eyes (the left eye is drawn mirrored) */}
                <ellipse cx={C[0] - hs * r * 0.38} cy={C[1] - r * 0.42} rx={r * 0.2} ry={r * 0.12} fill="#fff" opacity={0.88} transform={`rotate(${-28 * hs} ${C[0] - hs * r * 0.38} ${C[1] - r * 0.42})`} />
                <circle cx={C[0] + hs * r * 0.3} cy={C[1] + r * 0.36} r={2.6} fill="#fff" opacity={0.7} />
                <path d={`M ${C[0] - hs * r * 0.85} ${C[1] - r * 0.1} A ${r * 0.88} ${r * 0.88} 0 0 ${hs > 0 ? 1 : 0} ${C[0] - hs * r * 0.2} ${C[1] - r * 0.84}`} stroke="#fff" strokeWidth={2} fill="none" opacity={0.25} />
              </g>
              {has('CORNEA', 'DRY') && <path d={`M ${C[0] - 50} ${C[1] + 38} q 30 10 70 -2`} stroke="#e9e3b8" strokeWidth={3} fill="none" opacity={0.85} />}
              <g {...part(partKey(side, 'CORNEA'), t('vision.part.CORNEA'))}>
                <circle cx={C[0]} cy={C[1]} r={r - 1} {...hitStroke} strokeWidth={10} />
                <ellipse cx={C[0] - hs * r * 0.38} cy={C[1] - r * 0.42} rx={r * 0.24} ry={r * 0.16} fill="transparent" />
              </g>
            </g>

            {/* third eyelid at the inner corner */}
            <g {...part(partKey(side, 'THIRD_EYELID'), t('vision.part.THIRD_EYELID'))}>
              <g clipPath={has('THIRD_EYELID', 'CHERRY_EYE') ? undefined : `url(#${id('open')})`}>
                <path d={third} fill="#dba7a0" stroke="#5c3d35" strokeWidth={1.4} />
                {has('THIRD_EYELID', 'CHERRY_EYE') && (
                  <>
                    <ellipse cx={g.med[0] - 14} cy={g.med[1] + 12} rx={15 * sev('THIRD_EYELID')} ry={12 * sev('THIRD_EYELID')} fill="#d33f4f" />
                    <ellipse cx={g.med[0] - 18} cy={g.med[1] + 8} rx={5} ry={3} fill="#fff" opacity={0.45} />
                  </>
                )}
              </g>
            </g>

            {/* eyelids: dark pigmented margin, lashes on a dog's upper lid */}
            <g {...part(partKey(side, 'EYELIDS'), t('vision.part.EYELIDS'))}>
              {has('EYELIDS', 'ECTROPION') && <path d={`M ${g.med} C ${g.low}, ${g.lat} C ${g.droopBack}, ${g.med} Z`} fill="#d65f69" opacity={0.9} />}
              <path d={g.upper} fill="none" stroke={lid} strokeWidth={has('EYELIDS', 'ENTROPION') ? 7 : 4.5} strokeLinecap="round" />
              <path d={lowerLid} fill="none" stroke={lid} strokeWidth={has('EYELIDS', 'ENTROPION') ? 7 : 4} strokeLinecap="round" />
              {!cat && Array.from({ length: 12 }, (_, k) => {
                const tt = 0.2 + k * 0.055;
                const x = (1 - tt) ** 3 * g.lat[0] + 3 * (1 - tt) ** 2 * tt * 92 + 3 * (1 - tt) * tt ** 2 * 216 + tt ** 3 * g.med[0];
                const y = (1 - tt) ** 3 * g.lat[1] + 3 * (1 - tt) ** 2 * tt * 40 + 3 * (1 - tt) * tt ** 2 * 32 + tt ** 3 * g.med[1];
                const inward = has('EYELIDS', 'ENTROPION');
                return <path key={k} d={`M ${x} ${y} q ${-4} ${inward ? 8 : -9} ${-9} ${inward ? 13 : -12}`} stroke={lid} strokeWidth={1.4} fill="none" strokeLinecap="round" />;
              })}
              {has('EYELIDS', 'MASS') && <circle cx={178} cy={cat ? 44 : 50} r={8 * sev('EYELIDS')} fill="#d29b8d" stroke="#8a5a4f" strokeWidth={1} />}
              <path d={g.upper} {...hitStroke} />
              <path d={lowerLid} {...hitStroke} />
            </g>
            {has('CONJUNCTIVA', 'DISCHARGE') && (
              <path d={`M ${g.med[0] - 2} ${g.med[1] + 2} q 6 18 -4 34 q -6 -14 4 -34`} fill="#d7cf73" stroke="#a89d3e" strokeWidth={0.8} opacity={0.9} pointerEvents="none" />
            )}
          </>
        )}
      </g>
    </svg>
  );
}

export function VisionTab({ pet }: { pet: PetRow }) {
  const { t, locale } = useApp();
  const uid = useId().replace(/:/g, '');
  const cat = pet.species === 'CAT';
  const months = ageMonths(pet.date_of_birth);
  const { stage, blue } = eyeAge(pet.species, months);
  const colour = pet.eye_color ?? defaultEyeColor(pet.species);
  const state = useChart(pet.id, 'VISION');
  const hover = useHover();
  const age = pet.date_of_birth ? ageParts(pet.date_of_birth) : null;
  const colourName = t(`eyeColor.${colour}`);

  const parse = (p: string) => p.split('.') as [EyeSide, EyePart];
  const nameOf = (p: string): string | null => {
    if (p === 'EYES') return t('vision.general');
    const [side, part] = parse(p);
    if (!part || !(EYE_PARTS as readonly string[]).includes(part)) return null;
    return `${t(`vision.part.${part}`)} · ${t(`vision.short${side}`)}`;
  };
  const condLabel = (_p: string, c: string) => t(`eyeCond.${c}`);
  const info = (p: string | null): PartInfo | null => {
    if (!p) return null;
    if (p === 'EYES') return { title: t('vision.general'), about: t('vision.generalHint') };
    const [side, part] = parse(p);
    const facts: [string, ReactNode][] = [[t('vision.side'), t(`vision.eye${side}`)]];
    if (part === 'IRIS') {
      const shade = state.look(p).shade;
      facts.push([t('vision.irisColour'), shade ? t(`eyeColor.${shade}`) : pet.eye_color ? colourName : t('vision.notSet', { c: colourName })]);
    }
    const aboutKey = part === 'PUPIL' ? (cat ? 'PUPIL_CAT' : 'PUPIL_DOG') : part === 'EYELIDS' && cat ? 'EYELIDS_CAT' : part;
    return { title: t(`vision.part.${part}`), subtitle: t(`vision.eye${side}`), facts, about: t(`vision.about.${aboutKey}`) };
  };
  const sel = state.selected;
  const selPart = sel && sel !== 'EYES' ? parse(sel)[1] : null;
  const part = (k: string, label: string) => ({
    role: 'button',
    tabIndex: 0,
    'aria-label': label,
    className: `part ${sel === k ? 'sel' : ''} ${hover.hover?.part === k ? 'hov' : ''}`,
    onClick: (e: React.MouseEvent) => { e.stopPropagation(); state.select(k); },
    onKeyDown: (e: React.KeyboardEvent) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), state.select(k)),
    ...hover.bind(k),
  });
  const hoverInfo = hover.hover ? info(hover.hover.part) : null;
  const stageText = stage === 'ADULT' ? '' : t(`vision.stage.${stage}`, { c: colourName, y: cat ? 10 : 7 });

  return (
    <div className="clin-chart">
      <div className="row clin-head">
        <p className={`note ${stage === 'SENIOR' || stage === 'UNKNOWN' ? 'warn' : ''}`} style={{ margin: 0, flex: 1, minWidth: 220 }}>
          {age && <b>{t('dental.age', { age: t('pets.ageValue', { y: age.years, m: age.months }) })} · </b>}
          {pet.eye_color ? t('vision.colour', { c: colourName }) : t('vision.colourNotSet', { c: colourName })}
          {stageText && <> · {stageText}</>}
        </p>
      </div>
      <p className="faint small" style={{ margin: '8px 0 0' }}>{t(state.canEdit ? 'charts.hoverHint' : 'charts.hoverHintRO')}</p>
      <div className="clin-grid">
        <div>
          <div className="clin-stage eyes" ref={hover.wrap} onPointerLeave={hover.clear}>
            {/* always the pet's right eye on the viewer's left, also in Arabic */}
            <div className="eye-pair" dir="ltr">
            {(['OD', 'OS'] as EyeSide[]).map((side) => (
              <figure key={side} dir={locale === 'ar' ? 'rtl' : 'ltr'}>
                <Eye
                  side={side} cat={cat} adultIris={eyeHex(colour, side)} blue={blue} closed={stage === 'CLOSED'} state={state} uid={uid} part={part}
                />
                <figcaption>{t(`vision.eye${side}`)}</figcaption>
                <ul className="eye-parts">
                  {EYE_PARTS.map((p) => {
                    const k = partKey(side, p);
                    const l: Look = state.look(k);
                    return (
                      <li key={p}>
                        <button type="button" className={sel === k ? 'on' : ''} onClick={() => state.select(k)} {...hover.bind(k)}>
                          <span>{t(`vision.part.${p}`)}</span>
                          {l.conditions.length ? <Badge kind="warn">{l.conditions.map((c) => t(`eyeCond.${c}`)).join(', ')}</Badge> : l.notes ? <span className="faint">✎</span> : null}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </figure>
            ))}
            </div>
            {hover.hover && hoverInfo && (
              <HoverCard
                x={hover.hover.x} y={hover.hover.y} width={hover.wrap.current?.clientWidth ?? 600} info={hoverInfo} look={state.look(hover.hover.part)}
                labelOf={(c) => t(`eyeCond.${c}`)} sevLabel={(n) => t(`charts.sev${n}`)} hint={t(state.canEdit ? 'charts.clickEdit' : 'charts.clickView')}
              />
            )}
          </div>
        </div>
        <div className="insp-col">
          <Inspector
            key={sel ?? ''}
            state={state}
            info={info(sel)}
            notesOnly={sel === 'EYES'}
            options={(selPart ? EYE_CONDITIONS[selPart] : []).map((k) => ({ key: k, label: t(`eyeCond.${k}`) }))}
            exclusive={selPart === 'GLOBE' ? ['ENUCLEATED'] : selPart === 'PUPIL' ? ['DILATED', 'CONSTRICTED'] : []}
            normalKey="NORMAL"
            shades={selPart === 'IRIS' ? Object.fromEntries(IRIS_COLORS.map((c) => [c, eyeHex(c, 'OD')])) : undefined}
            shadeLabel={(k) => t(`eyeColor.${k}`)}
            naturalHex={sel ? eyeHex(colour, parse(sel)[0]) : undefined}
            empty={t('vision.pick')}
          />
          <button type="button" className={`btn ghost sm ${sel === 'EYES' ? 'on' : ''}`} style={{ marginTop: 8 }} onClick={() => state.select('EYES')}>
            ✎ {t('vision.general')}
          </button>
        </div>
      </div>
      <FindingsList state={state} nameOf={nameOf} labelOf={condLabel} empty={t('vision.noFindings')} />
      <p className="faint small" lang={locale}>{t('vision.legend')}</p>
    </div>
  );
}
