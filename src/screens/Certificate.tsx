// Vaccination certificate (6 Nov 2026 change request): one A5 page per pet for travel and boarding, every label in
// English and Arabic whatever the app language, with the clinic logo and a signature / stamp area.
import { useParams, useNavigate } from 'react-router-dom';
import { useApp, useQuery } from '../lib/app';
import { getPet, getSettings, petVaccinations, shownCode } from '../db/repo';
import { platform } from '../lib/platform';
import { Icon, SheetAddress } from '../components/ui';
import ar from '../i18n/ar.json';
import en from '../i18n/en.json';

type Dict = Record<string, unknown>;
const pick = (m: Dict, key: string) => (key.split('.').reduce<unknown>((o, k) => (o as Dict | undefined)?.[k], m) as string | undefined) ?? key;
/** "English · العربية" for a translation key. */
export function Bi({ k }: { k: string }) {
  return (
    <>
      <span>{pick(en as Dict, k)}</span> <span className="ar" dir="rtl" lang="ar">{pick(ar as Dict, k)}</span>
    </>
  );
}
/** A translated value: English, then the Arabic in grey (some Arabic values contain "/" themselves). */
const both = (k: string) => <Bi k={k} />;
// Unambiguous for travel papers abroad: 6 Nov 2026.
export const intlDate = (iso: string | null | undefined) =>
  iso ? new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(iso.length === 10 ? `${iso}T12:00:00` : iso)) : '—';

export function VaccinationCertificate() {
  const { id = '' } = useParams();
  const { t } = useApp();
  const nav = useNavigate();
  const pet = useQuery(() => getPet(id), [id]);
  const vacc = useQuery(() => petVaccinations(id).slice().reverse(), [id]); // oldest first
  const settings = useQuery(getSettings);
  if (!pet) return null;
  return (
    <div className="page">
      <div className="row no-print" style={{ marginBottom: 14 }}>
        <button className="btn" onClick={() => nav(-1)}>{t('app.back')}</button>
        <button className="btn primary" onClick={() => platform.print()}><Icon name="print" /> {t('common.print')}</button>
      </div>
      <div className="sheet-wrap">
        <div className="sheet a5 certificate">
          <div className="head">
            <div>
              <b style={{ fontSize: 15 }}>{settings.name_en}</b>
              <div className="ar" dir="rtl" lang="ar" style={{ fontSize: 13, fontWeight: 600 }}>{settings.name_ar}</div>
              <div style={{ fontSize: 10 }}>{settings.phone && <span className="ltr">{settings.phone}</span>}</div>
            </div>
            {settings.logo_url && <img src={settings.logo_url} alt="" />}
          </div>
          <h2 className="cert-title"><Bi k="certificate.title" /></h2>
          <table className="facts-table">
            <tbody>
              <tr><td><Bi k="certificate.petName" /></td><td><b>{pet.name}</b></td></tr>
              <tr><td><Bi k="pets.species" /></td><td>{both(`species.${pet.species}`)}{pet.breed ? <> · {pet.breed}</> : null}</td></tr>
              <tr><td><Bi k="pets.sex" /></td><td>{both(`sex.${pet.sex}`)}{pet.is_neutered ? <> · {both('pets.neutered')}</> : null}</td></tr>
              <tr><td><Bi k="pets.dob" /></td><td>{intlDate(pet.date_of_birth)}{pet.date_of_birth && pet.dob_is_estimate ? <> ({both('pets.dobEstimate')})</> : null}</td></tr>
              {pet.color && <tr><td><Bi k="pets.color" /></td><td>{pet.color}</td></tr>}
              <tr><td><Bi k="pets.microchip" /></td><td className="ltr">{pet.microchip_no || '—'}</td></tr>
              <tr><td><Bi k="certificate.owner" /></td><td>{pet.owner_name} · <span className="ltr">{pet.owner_phone}</span>{shownCode(pet.owner_code) ? <> · <span className="ltr">{pet.owner_code}</span></> : null}</td></tr>
            </tbody>
          </table>
          <h3 style={{ margin: '12px 0 4px' }}><Bi k="petRecord.vaccinations" /></h3>
          <table>
            <thead>
              <tr>
                <th><Bi k="visits.vaccine" /></th>
                <th><Bi k="certificate.given" /></th>
                <th><Bi k="certificate.batch" /></th>
                <th><Bi k="petRecord.nextDue" /></th>
              </tr>
            </thead>
            <tbody>
              {vacc.length ? (
                vacc.map((x) => (
                  <tr key={x.id}>
                    <td>{x.vaccine}</td>
                    <td>{intlDate(x.administered_at)}</td>
                    <td className="ltr">{x.batch_no || '—'}</td>
                    <td>{intlDate(x.next_due_at)}</td>
                  </tr>
                ))
              ) : (
                <tr><td colSpan={4}><Bi k="certificate.none" /></td></tr>
              )}
            </tbody>
          </table>
          <div className="cert-sign">
            <div><div className="line" /><Bi k="certificate.signature" /></div>
            <div><div className="stamp" /><Bi k="certificate.stamp" /></div>
          </div>
          <div className="foot"><Bi k="certificate.issued" /> {intlDate(new Date().toISOString())}</div>
          <SheetAddress address={settings.address} />
        </div>
      </div>
    </div>
  );
}
