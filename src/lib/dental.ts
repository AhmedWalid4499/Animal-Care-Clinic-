// Dental chart anatomy for dogs and cats (change request, 19 Nov 2026).
// Teeth use the modified Triadan system: quadrant 1 upper right, 2 upper left, 3 lower left, 4 lower right
// (5–8 the same for baby teeth); position 01–03 incisors, 04 canine, 05–08 premolars, 09–11 molars.
// Which teeth are drawn, and how far they have come in, depends on the pet's age.
import { daysBetween, today } from './dates';

export type Animal = 'DOG' | 'CAT';
export type ToothType = 'I' | 'C' | 'P' | 'M';
export type Jaw = 'upper' | 'lower';
export type Side = 'right' | 'left';

export interface ToothDef {
  /** Triadan number, e.g. '108' (permanent) or '508' (baby tooth). */
  id: string;
  pos: number;
  quadrant: number;
  jaw: Jaw;
  side: Side;
  type: ToothType;
  /** 1st, 2nd… of its type, e.g. 4 for the 4th premolar. */
  ordinal: number;
  deciduous: boolean;
  /** The pair of big shearing teeth (upper P4, lower M1). */
  carnassial: boolean;
  roots: string;
  /** Eruption window in months of age. */
  erupt: [number, number];
  /** Size in chart units: w along the arch, d across it. */
  w: number;
  d: number;
}

const PERM: Record<Animal, Record<Jaw, number[]>> = {
  DOG: { upper: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], lower: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] },
  CAT: { upper: [1, 2, 3, 4, 6, 7, 8, 9], lower: [1, 2, 3, 4, 7, 8, 9] },
};
const DECID: Record<Animal, Record<Jaw, number[]>> = {
  DOG: { upper: [1, 2, 3, 4, 6, 7, 8], lower: [1, 2, 3, 4, 6, 7, 8] },
  CAT: { upper: [1, 2, 3, 4, 6, 7, 8], lower: [1, 2, 3, 4, 7, 8] },
};

const wk = (w: number) => w / 4.345;

function typeOf(pos: number): { type: ToothType; ordinal: number } {
  if (pos <= 3) return { type: 'I', ordinal: pos };
  if (pos === 4) return { type: 'C', ordinal: 1 };
  if (pos <= 8) return { type: 'P', ordinal: pos - 4 };
  return { type: 'M', ordinal: pos - 8 };
}

function roots(a: Animal, jaw: Jaw, pos: number, deciduous: boolean): string {
  if (pos <= 4) return '1';
  if (deciduous) return pos === 8 && jaw === 'upper' ? '3' : '2';
  if (a === 'DOG') {
    if (jaw === 'upper') return pos === 5 ? '1' : pos <= 7 ? '2' : '3';
    return pos === 5 || pos === 11 ? '1' : '2';
  }
  if (jaw === 'upper') return pos === 6 ? '1–2' : pos === 7 ? '2' : pos === 8 ? '3' : '1–2';
  return '2';
}

function eruption(a: Animal, jaw: Jaw, pos: number, deciduous: boolean): [number, number] {
  const { type } = typeOf(pos);
  if (deciduous) {
    if (a === 'DOG') return type === 'I' ? [wk(3), wk(4)] : type === 'C' ? [wk(3), wk(4)] : [wk(4), wk(10)];
    return type === 'I' ? [wk(2), wk(3)] : type === 'C' ? [wk(3), wk(4)] : jaw === 'lower' ? [wk(4), wk(5)] : [wk(3), wk(6)];
  }
  if (a === 'DOG') {
    if (type === 'I') return [3, 5];
    if (type === 'C') return [4, 6];
    if (type === 'P') return pos === 5 ? [4, 5] : [4, 6];
    return pos === 9 ? [5, 6] : pos === 10 ? [5, 6] : [6, 7];
  }
  if (type === 'I') return [3, 4];
  if (type === 'C') return [4, 5];
  if (type === 'P') return [4, 6];
  return [4, 5];
}

/** Occlusal size (along the arch × across it). Baby teeth are drawn smaller in the same place. */
function size(a: Animal, jaw: Jaw, pos: number): [number, number] {
  const { type } = typeOf(pos);
  const carn = (jaw === 'upper' && pos === 8) || (jaw === 'lower' && pos === 9);
  if (type === 'I') return [pos === 3 ? 10 : 8.5, 9];
  if (type === 'C') return a === 'CAT' ? [15, 13] : [17, 15];
  if (carn) return a === 'CAT' ? [24, 12] : [26, 14];
  if (type === 'P') {
    if (a === 'DOG') return pos === 5 ? [8, 8] : pos === 6 ? [13, 10] : [16, 11];
    return pos === 6 ? [7, 7] : [16, 11];
  }
  if (a === 'CAT') return jaw === 'upper' ? [6, 9] : [24, 12];
  if (jaw === 'upper') return pos === 9 ? [17, 20] : [11, 15];
  return pos === 10 ? [12, 11] : [7, 7];
}

function def(a: Animal, quadrant: number, pos: number): ToothDef {
  const deciduous = quadrant >= 5;
  const q = deciduous ? quadrant - 4 : quadrant;
  const jaw: Jaw = q <= 2 ? 'upper' : 'lower';
  const side: Side = q === 1 || q === 4 ? 'right' : 'left';
  const { type, ordinal } = typeOf(pos);
  const [w, d] = size(a, jaw, pos);
  const carnassial = (jaw === 'upper' && pos === 8) || (jaw === 'lower' && pos === 9);
  return {
    id: `${quadrant}${String(pos).padStart(2, '0')}`, pos, quadrant, jaw, side, type, ordinal, deciduous,
    carnassial: carnassial && !deciduous, roots: roots(a, jaw, pos, deciduous), erupt: eruption(a, jaw, pos, deciduous),
    w: deciduous ? w * 0.68 : w, d: deciduous ? d * 0.7 : d,
  };
}

/** Look up any tooth by Triadan number. */
export function toothById(a: Animal, id: string): ToothDef | undefined {
  const quadrant = Number(id[0]);
  const pos = Number(id.slice(1));
  if (!(quadrant >= 1 && quadrant <= 8) || !pos) return undefined;
  const jaw: Jaw = ((quadrant - 1) % 4) < 2 ? 'upper' : 'lower';
  const list = (quadrant >= 5 ? DECID : PERM)[a][jaw];
  return list.includes(pos) ? def(a, quadrant, pos) : undefined;
}

export const permanentCount = (a: Animal) => (PERM[a].upper.length + PERM[a].lower.length) * 2;
export const deciduousCount = (a: Animal) => (DECID[a].upper.length + DECID[a].lower.length) * 2;

export type DentalView = 'auto' | 'deciduous' | 'permanent';
export type DentalStage = 'NONE' | 'DECIDUOUS' | 'MIXED' | 'PERMANENT' | 'SENIOR' | 'UNKNOWN';

/** One slot on the chart: a tooth position, what is in it at this age, and how far it has erupted (0–1). */
export interface Slot {
  quadrant: number; // 1–4: where on the chart
  pos: number;
  /** Permanent tooth of this slot (for layout); undefined only where a cat has a baby tooth but no adult one. */
  layout: ToothDef;
  tooth: ToothDef;
  /** 0 = not through the gum yet (drawn as an outline), 1 = fully erupted. */
  grown: number;
}

export function ageMonths(dob: string | null | undefined, at = today()): number | null {
  if (!dob) return null;
  return Math.max(0, daysBetween(dob, at) / 30.44);
}

export function seniorFrom(a: Animal) {
  return a === 'DOG' ? 8 * 12 : 11 * 12;
}

/** What the mouth looks like at this age (or the forced view). */
export function dentition(a: Animal, months: number | null, view: DentalView = 'auto'): { stage: DentalStage; slots: Slot[] } {
  const slots: Slot[] = [];
  const m = view === 'permanent' ? 999 : view === 'deciduous' ? 2.9 : months ?? 999;
  let perm = 0;
  let decid = 0;
  let none = 0;
  let partial = 0;
  for (const quadrant of [1, 2, 3, 4]) {
    const jaw: Jaw = quadrant <= 2 ? 'upper' : 'lower';
    const positions = [...new Set([...PERM[a][jaw], ...DECID[a][jaw]])].sort((x, y) => x - y);
    for (const pos of positions) {
      const p = PERM[a][jaw].includes(pos) ? def(a, quadrant, pos) : undefined;
      const d = DECID[a][jaw].includes(pos) ? def(a, quadrant + 4, pos) : undefined;
      const layout = p ?? d!;
      const grow = (t: ToothDef) => Math.max(0, Math.min(1, (m - t.erupt[0]) / Math.max(0.01, t.erupt[1] - t.erupt[0])));
      // The baby tooth stays until the adult one is about 40% through the gum, then it is shed.
      const shedAt = p ? p.erupt[0] + 0.4 * (p.erupt[1] - p.erupt[0]) : 0;
      if (p && (m >= shedAt || !d)) {
        const g = view === 'deciduous' ? 0 : grow(p);
        if (g > 0) perm++;
        else none++;
        if (g > 0 && g < 1) partial++;
        slots.push({ quadrant, pos, layout, tooth: p, grown: g });
      } else if (d) {
        const g = grow(d);
        if (g > 0) decid++;
        else none++;
        if (g > 0 && g < 1) partial++;
        slots.push({ quadrant, pos, layout, tooth: d, grown: g });
      }
    }
  }
  let stage: DentalStage;
  if (view === 'auto' && months == null) stage = 'UNKNOWN';
  else if (perm === 0 && decid === 0) stage = 'NONE';
  else if (perm === 0) stage = 'DECIDUOUS';
  else if (decid > 0 || none > 0 || partial > 0) stage = 'MIXED';
  else stage = view === 'auto' && months! >= seniorFrom(a) ? 'SENIOR' : 'PERMANENT';
  return { stage, slots };
}

// ---------------------------------------------------------------- findings and how they look
export const TOOTH_CONDITIONS = [
  'HEALTHY', 'PLAQUE', 'TARTAR', 'GINGIVITIS', 'DISCOLORED', 'WORN', 'FRACTURED', 'CARIES', 'RESORPTION', 'MOBILE',
  'RETAINED', 'TREATED', 'MISSING', 'EXTRACTED',
] as const;
export type ToothCondition = (typeof TOOTH_CONDITIONS)[number];
/** These replace every other finding on the tooth. */
export const TOOTH_EXCLUSIVE: string[] = ['HEALTHY', 'MISSING', 'EXTRACTED'];

export const TOOTH_SHADES: Record<string, string> = {
  WHITE: '#f9f8f3', IVORY: '#f1e9d6', CREAM: '#ead9b0', YELLOW: '#e2c477', BROWN: '#b48550', GREY: '#b2aea6', PINK: '#e8b7b5',
};
/** Natural enamel colour for the age before the vet changes anything. */
export function defaultToothShade(stage: DentalStage, months: number | null): string {
  if (stage === 'DECIDUOUS' || stage === 'MIXED' || stage === 'NONE') return 'WHITE';
  if (stage === 'SENIOR') return 'CREAM';
  if (months != null && months < 24) return 'WHITE';
  return 'IVORY';
}
/** A finding that changes the colour when the vet has not picked a shade. */
export function conditionShade(conditions: string[]): string | null {
  if (conditions.includes('DISCOLORED')) return 'GREY';
  if (conditions.includes('TARTAR')) return 'CREAM';
  if (conditions.includes('PLAQUE')) return 'IVORY';
  return null;
}

export const SOFT_PARTS = ['PALATE', 'GUM_UPPER', 'GUM_LOWER', 'TONGUE'] as const;
export const SOFT_CONDITIONS = ['NORMAL', 'INFLAMED', 'BLEEDING', 'ULCER', 'MASS', 'PALE', 'JAUNDICE', 'CYANOSIS'] as const;
export const SOFT_SHADES: Record<string, string> = {
  PINK: '#ee9ea6', PALE: '#f4d3d2', RED: '#d9535f', YELLOW: '#ecd48a', BLUE: '#a8a6cc', PIGMENTED: '#5a4446',
};
export function softShade(shade: string | null, conditions: string[], base: string): string {
  if (shade && SOFT_SHADES[shade]) return SOFT_SHADES[shade];
  if (conditions.includes('CYANOSIS')) return SOFT_SHADES.BLUE;
  if (conditions.includes('JAUNDICE')) return SOFT_SHADES.YELLOW;
  if (conditions.includes('PALE')) return SOFT_SHADES.PALE;
  if (conditions.includes('INFLAMED') || conditions.includes('BLEEDING')) return SOFT_SHADES.RED;
  return base;
}

/** Hex helpers for shading. */
export function shadeHex(hex: string, amount: number): string {
  const n = parseInt(hex.slice(1), 16);
  const f = (c: number) => Math.max(0, Math.min(255, Math.round(amount < 0 ? c * (1 + amount) : c + (255 - c) * amount)));
  const r = f((n >> 16) & 255);
  const g = f((n >> 8) & 255);
  const b = f(n & 255);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}
export function mixHex(a: string, b: string, t: number): string {
  const x = parseInt(a.slice(1), 16);
  const y = parseInt(b.slice(1), 16);
  const ch = (s: number) => Math.round(((x >> s) & 255) * (1 - t) + ((y >> s) & 255) * t);
  return `#${((ch(16) << 16) | (ch(8) << 8) | ch(0)).toString(16).padStart(6, '0')}`;
}

export const splitConditions = (s: string | null | undefined) => (s ? s.split(',').filter(Boolean) : []);
