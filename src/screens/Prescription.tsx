// Prescription for the owner (7 Nov 2026 change request): an A5 sheet from a visit's prescriptions — what to give,
// how much, how often and for how many days — printed in Arabic or English (the owner's choice, not the app's), or sent
// as a WhatsApp message (the one integration, click-to-chat).
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useApp, useQuery } from '../lib/app';
import { getPet, getSettings, getTemplate, getVisit, lastWeight, listDrugs, templateRx, type PetOption } from '../db/repo';
import { calcDose, doseText, findDrug } from '../lib/dose';
import { platform } from '../lib/platform';
import { Field, Icon, PetPicker, WaButton } from '../components/ui';
import ar from '../i18n/ar.json';
import en from '../i18n/en.json';

type Dict = Record<string, unknown>;
const dicts = { ar: ar as Dict, en: en as Dict };
type Lang = keyof typeof dicts;

/** A translator for one language, whatever the app is set to. */
function translator(lang: Lang) {
  return (key: string, vars?: Record<string, string | number>) => {
    let s = (key.split('.').reduce<unknown>((o, k) => (o as Dict | undefined)?.[k], dicts[lang]) as string | undefined) ?? key;
    for (const [k, v] of Object.entries(vars ?? {})) s = s.replaceAll(`{${k}}`, String(v));
    return s;
  };
}
const dateIn = (lang: Lang, iso: string | null | undefined) =>
  iso ? new Intl.DateTimeFormat(lang === 'ar' ? 'ar-EG-u-nu-latn' : 'en-GB', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(iso.length === 10 ? `${iso}T12:00:00` : iso)) : '';

export function PrescriptionPrint() {
  const { visitId = '' } = useParams();
  const { t, locale } = useApp();
  const nav = useNavigate();
  const [lang, setLang] = useState<Lang>(locale === 'en' ? 'en' : 'ar');
  const visit = useQuery(() => getVisit(visitId), [visitId]);
  const pet = useQuery(() => (visit ? getPet(visit.pet_id) : undefined), [visit?.pet_id]);
  const settings = useQuery(getSettings);
  if (!visit || !pet) return null;
  const L = translator(lang);
  const clinic = lang === 'ar' ? settings.name_ar : settings.name_en;
  const lines = visit.prescriptions.map((r, i) =>
    `${i + 1}. ${r.drug}${[r.dose, r.frequency, r.duration_days ? L('rxSheet.forDays', { n: r.duration_days }) : null, r.instructions].filter(Boolean).map((x) => ` — ${x}`).join('')}`);
  const waText = [L('rxSheet.waIntro', { owner: pet.owner_name ?? '', pet: pet.name, clinic, date: dateIn(lang, visit.visited_at) }), ...lines,
    visit.follow_up_at ? L('rxSheet.waNext', { date: dateIn(lang, visit.follow_up_at) }) : null].filter(Boolean).join('\n');

  return (
    <div className="page">
      <div className="row no-print" style={{ marginBottom: 14 }}>
        <button className="btn" onClick={() => nav(-1)}>{t('app.back')}</button>
        <div className="seg" role="group" aria-label={t('rxSheet.language')}>
          <button type="button" className={lang === 'ar' ? 'on' : ''} onClick={() => setLang('ar')}>العربية</button>
          <button type="button" className={lang === 'en' ? 'on' : ''} onClick={() => setLang('en')}>English</button>
        </div>
        <span className="spacer" />
        <WaButton phone={pet.owner_whatsapp || pet.owner_phone} text={waText} label={t('rxSheet.sendWa')} />
        <button className="btn primary" onClick={() => platform.print()}><Icon name="print" /> {t('common.print')}</button>
      </div>
      <div className="sheet-wrap">
        <div className="sheet a5 rx-sheet" dir={lang === 'ar' ? 'rtl' : 'ltr'} lang={lang}>
          <div className="head">
            <div>
              <b style={{ fontSize: 15 }}>{clinic}</b>
              <div style={{ fontSize: 10 }}>{settings.address} {settings.phone && <span className="ltr">· {settings.phone}</span>}</div>
            </div>
            {settings.logo_url && <img src={settings.logo_url} alt="" />}
          </div>
          <h2 className="rx-title">{L('rxSheet.title')}</h2>
          <div className="rx-facts">
            <span>{L('rxSheet.pet')}: <b>{pet.name}</b> ({L(`species.${pet.species}`)})</span>
            {visit.weight_kg != null && <span>{L('visits.weight')}: <b className="ltr">{visit.weight_kg}</b></span>}
            <span>{L('rxSheet.owner')}: <b>{pet.owner_name}</b></span>
            <span>{L('common.date')}: <b>{dateIn(lang, visit.visited_at)}</b></span>
            {visit.vet_name && <span>{L('rxSheet.vet')}: <b>{visit.vet_name}</b></span>}
          </div>
          {visit.diagnosis && <p className="small">{L('visits.diagnosis')}: {visit.diagnosis}</p>}
          <table>
            <thead>
              <tr><th>{L('rxSheet.rx')}</th><th>{L('visits.dose')}</th><th>{L('rxSheet.howOften')}</th><th>{L('rxSheet.howLong')}</th></tr>
            </thead>
            <tbody>
              {visit.prescriptions.length === 0 && <tr><td colSpan={4}>{L('rxSheet.none')}</td></tr>}
              {visit.prescriptions.map((r) => (
                <tr key={r.id}>
                  {/* What the vet typed may be in either language: let each value keep its own direction ("0.5 ml"). */}
                  <td><b dir="auto">{r.drug}</b>{r.instructions ? <div className="small" dir="auto">{r.instructions}</div> : null}</td>
                  <td><span dir="auto">{r.dose || '—'}</span></td>
                  <td><span dir="auto">{r.frequency || '—'}</span></td>
                  <td>{r.duration_days ? L('rxSheet.forDays', { n: r.duration_days }) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {visit.treatment_notes && <p className="small" style={{ marginTop: 10 }}>{visit.treatment_notes}</p>}
          {visit.follow_up_at && <p className="rx-next">↻ {L('rxSheet.next', { date: dateIn(lang, visit.follow_up_at) })}</p>}
          <div className="rx-sign"><div className="line" />{L('certificate.signature')}</div>
          <div className="foot">{L('rxSheet.foot')}</div>
        </div>
      </div>
    </div>
  );
}

/**
 * A treatment template as a prescription for the owner (7 Nov 2026, at Ahmed's request): the template's medicines,
 * how often and for how long (the separate "how to use" box was removed 10 Nov at the customer's request). Choose a patient to fill in the name and work out
 * the doses left blank from the pet's weight; without one, the sheet has blank lines to write on.
 */
export function TemplatePrint() {
  const { id = '' } = useParams();
  const { t, locale } = useApp();
  const nav = useNavigate();
  const [lang, setLang] = useState<Lang>(locale === 'en' ? 'en' : 'ar');
  const [picked, setPicked] = useState<PetOption | null>(null);
  const tpl = useQuery(() => getTemplate(id), [id]);
  const pet = useQuery(() => (picked ? getPet(picked.id) : undefined), [picked?.id]);
  const kg = useQuery(() => (picked ? lastWeight(picked.id)?.weight_kg ?? null : null), [picked?.id]);
  const drugs = useQuery(() => listDrugs(true));
  const settings = useQuery(getSettings);
  if (!tpl) return null;
  const L = translator(lang);
  const clinic = lang === 'ar' ? settings.name_ar : settings.name_en;
  const unitLabel = (u: string, n: number) => L(n === 1 ? `drugs.unit1.${u}` : `drugs.unit.${u}`);
  const rows = templateRx(tpl).map((r) => {
    const d = findDrug(drugs, r.drug);
    const dose = r.dose || (d && kg ? doseText(calcDose(d, kg, pet), d, unitLabel) : '');
    return { ...r, dose };
  });
  const today = new Date().toISOString();
  return (
    <div className="page">
      <div className="row no-print" style={{ marginBottom: 14 }}>
        <button className="btn" onClick={() => nav(-1)}>{t('app.back')}</button>
        <div className="seg" role="group" aria-label={t('rxSheet.language')}>
          <button type="button" className={lang === 'ar' ? 'on' : ''} onClick={() => setLang('ar')}>العربية</button>
          <button type="button" className={lang === 'en' ? 'on' : ''} onClick={() => setLang('en')}>English</button>
        </div>
        <span className="spacer" />
        <button className="btn primary" onClick={() => platform.print()}><Icon name="print" /> {t('common.print')}</button>
      </div>
      <div className="no-print tpl-patient">
        <Field label={t('templates.forPatient')} optional hint={t('templates.forPatientHint')}><PetPicker value={picked} onChange={setPicked} /></Field>
      </div>
      <div className="sheet-wrap">
        <div className="sheet a5 rx-sheet" dir={lang === 'ar' ? 'rtl' : 'ltr'} lang={lang}>
          <div className="head">
            <div>
              <b style={{ fontSize: 15 }}>{clinic}</b>
              <div style={{ fontSize: 10 }}>{settings.address} {settings.phone && <span className="ltr">· {settings.phone}</span>}</div>
            </div>
            {settings.logo_url && <img src={settings.logo_url} alt="" />}
          </div>
          <h2 className="rx-title">{L('rxSheet.title')}</h2>
          <div className="rx-facts">
            <span>{L('rxSheet.pet')}: <b>{pet ? `${pet.name} (${L(`species.${pet.species}`)})` : <span className="blank" />}</b></span>
            {pet && kg != null && <span>{L('visits.weight')}: <b className="ltr">{kg}</b></span>}
            <span>{L('rxSheet.owner')}: <b>{pet ? pet.owner_name : <span className="blank" />}</b></span>
            <span>{L('common.date')}: <b>{dateIn(lang, today)}</b></span>
          </div>
          {tpl.diagnosis && <p className="small">{L('visits.diagnosis')}: <span dir="auto">{tpl.diagnosis}</span></p>}
          <table>
            <thead><tr><th>{L('rxSheet.rx')}</th><th>{L('visits.dose')}</th><th>{L('rxSheet.howOften')}</th><th>{L('rxSheet.howLong')}</th></tr></thead>
            <tbody>
              {rows.length === 0 && <tr><td colSpan={4}>{L('rxSheet.none')}</td></tr>}
              {rows.map((r, i) => (
                <tr key={i}>
                  <td><b dir="auto">{r.drug}</b>{r.instructions ? <div className="small" dir="auto">{r.instructions}</div> : null}</td>
                  <td>{r.dose ? <span dir="auto">{r.dose}</span> : <span className="blank" />}</td>
                  <td><span dir="auto">{r.frequency || '—'}</span></td>
                  <td>{r.duration_days ? L('rxSheet.forDays', { n: r.duration_days }) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="rx-sign"><div className="line" />{L('certificate.signature')}</div>
          <div className="foot">{L('rxSheet.foot')}</div>
        </div>
      </div>
    </div>
  );
}
