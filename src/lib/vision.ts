// Eye chart anatomy for dogs and cats (Phase 6 change request). OD = the pet's right eye, OS = its left eye.
// The iris is drawn in the eye colour chosen on the pet; the vet can change each eye on its own (e.g. odd eyes).
import type { EyeColor } from '../db/types';
import { mixHex } from './dental';

export type EyeSide = 'OD' | 'OS';
export const EYE_PARTS = ['EYELIDS', 'THIRD_EYELID', 'CONJUNCTIVA', 'CORNEA', 'IRIS', 'PUPIL', 'LENS', 'GLOBE'] as const;
export type EyePart = (typeof EYE_PARTS)[number];

export const EYE_CONDITIONS: Record<EyePart, readonly string[]> = {
  EYELIDS: ['NORMAL', 'ENTROPION', 'ECTROPION', 'SWELLING', 'MASS'],
  THIRD_EYELID: ['NORMAL', 'PROTRUDING', 'CHERRY_EYE'],
  CONJUNCTIVA: ['NORMAL', 'REDNESS', 'CHEMOSIS', 'DISCHARGE', 'JAUNDICE'],
  CORNEA: ['NORMAL', 'ULCER', 'EDEMA', 'SCAR', 'PIGMENT', 'VESSELS', 'DRY'],
  IRIS: ['NORMAL', 'UVEITIS', 'ATROPHY', 'MELANOSIS'],
  PUPIL: ['NORMAL', 'DILATED', 'CONSTRICTED'],
  LENS: ['NORMAL', 'NUCLEAR_SCLEROSIS', 'CATARACT_EARLY', 'CATARACT', 'LUXATION'],
  GLOBE: ['NORMAL', 'REDUCED_VISION', 'BLIND', 'GLAUCOMA', 'ENUCLEATED'],
};

const IRIS: Record<Exclude<EyeColor, 'ODD'>, string> = {
  DARK_BROWN: '#3e2516', BROWN: '#6d4424', AMBER: '#c98614', HAZEL: '#8f7838', GOLD: '#d9a821', COPPER: '#b4642a',
  GREEN: '#6f9a2e', BLUE: '#5f9fd8',
};
export const IRIS_COLORS = Object.keys(IRIS) as Exclude<EyeColor, 'ODD'>[];
/** Puppies and kittens open their eyes blue-grey. */
const BABY_BLUE = '#7f9db4';

/** The iris colour of one eye; ODD (heterochromia) = blue right eye, amber left eye until the vet sets each one. */
export function eyeHex(color: EyeColor | string | null | undefined, side: EyeSide): string {
  if (color === 'ODD') return side === 'OD' ? IRIS.BLUE : IRIS.AMBER;
  return IRIS[(color as keyof typeof IRIS) ?? ''] ?? IRIS.BROWN;
}
export function defaultEyeColor(species: string): Exclude<EyeColor, 'ODD'> {
  return species === 'CAT' ? 'AMBER' : 'BROWN';
}

export type EyeAgeStage = 'CLOSED' | 'BABY_BLUE' | 'CHANGING' | 'ADULT' | 'SENIOR' | 'UNKNOWN';
/** Eyes open at 10–14 days, are blue-grey until ~8 weeks and reach their adult colour by ~4 months. */
export function eyeAge(species: string, months: number | null): { stage: EyeAgeStage; blue: number } {
  if (months == null) return { stage: 'UNKNOWN', blue: 0 };
  if (months < 0.4) return { stage: 'CLOSED', blue: 1 };
  if (months < 2) return { stage: 'BABY_BLUE', blue: 1 };
  if (months < 4) return { stage: 'CHANGING', blue: 1 - (months - 2) / 2 };
  if (months >= (species === 'CAT' ? 10 * 12 : 7 * 12)) return { stage: 'SENIOR', blue: 0 };
  return { stage: 'ADULT', blue: 0 };
}
export function irisAtAge(adult: string, blue: number) {
  return blue > 0 ? mixHex(adult, BABY_BLUE, blue) : adult;
}

export const partKey = (side: EyeSide, part: EyePart) => `${side}.${part}`;
