// Dose calculator (6 Nov 2026 change request). The clinic enters each drug's mg/kg and concentration in Settings →
// Drugs; this file only does the arithmetic. The vet always sees the working and decides.
import type { Drug } from '../db/types';

export interface DoseResult {
  kg: number;
  mg: number; // per dose, after the cap
  capped: boolean; // max_mg applied
  amount: number | null; // ml / tablets / capsules; null when the drug is given in mg or has no concentration
  speciesOk: boolean; // drug lists this species (or lists none)
  allergy: boolean; // the pet's allergy note names this drug
}

const round = (n: number, step: number) => Math.round(n / step) * step;

/** Dose for a weight. Tablets/capsules round to a quarter, ml to 0.01 ml, mg to 0.1 mg. */
export function calcDose(drug: Drug, kg: number, pet?: { species?: string | null; alert_flags?: string | null; alert_note?: string | null }): DoseResult {
  let mg = drug.dose_mg_kg * kg;
  const capped = drug.max_mg != null && drug.max_mg > 0 && mg > drug.max_mg;
  if (capped) mg = drug.max_mg!;
  mg = round(mg, 0.1);
  let amount: number | null = null;
  if (drug.unit !== 'mg' && drug.concentration && drug.concentration > 0) {
    const raw = mg / drug.concentration;
    amount = drug.unit === 'ml' ? round(raw, 0.01) : round(raw, 0.25);
  }
  const list = (drug.species ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  const speciesOk = !list.length || !pet?.species || list.includes(pet.species);
  return { kg, mg, capped, amount, speciesOk, allergy: allergyMatch(drug.name, pet) };
}

/** The pet has the Allergy flag and its alert note names this drug (first word of 4+ letters, e.g. "amoxicillin"). */
export function allergyMatch(drugName: string, pet?: { alert_flags?: string | null; alert_note?: string | null }): boolean {
  const name = drugName.trim().toLowerCase();
  if (!name || !pet?.alert_note || !(pet.alert_flags ?? '').split(',').includes('ALLERGY')) return false;
  const word = name.split(/[\s(,/]+/).find((w) => w.length >= 4) ?? name;
  return pet.alert_note.toLowerCase().includes(word);
}

/** What goes into the prescription's dose field, e.g. "21.8 mg (0.44 ml)". */
export function doseText(r: DoseResult, drug: Drug, unitLabel: (u: string, n: number) => string): string {
  const mg = `${Number(r.mg.toFixed(1))} mg`;
  return r.amount == null ? mg : `${mg} (${Number(r.amount.toFixed(2))} ${unitLabel(drug.unit, r.amount)})`;
}

/** Match a typed drug name to the list (case- and space-insensitive). */
export const findDrug = (drugs: Drug[], name: string) => {
  const n = name.trim().toLowerCase();
  return n ? drugs.find((d) => d.name.trim().toLowerCase() === n) : undefined;
};
