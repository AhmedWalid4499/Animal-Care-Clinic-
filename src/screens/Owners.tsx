import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useApp, useQuery } from '../lib/app';
import { findDuplicatePhone, getOwner, getSettings, saveOwner, searchOwners, type OwnerInput } from '../db/repo';
import { telUrl } from '../lib/whatsapp';
import { Dialog, Field, Icon, OwnerCode, StatusBadge, WaButton } from '../components/ui';
import { PageHead } from '../components/Layout';
import type { Owner } from '../db/types';

export function OwnersList() {
  const { t, fmt, locale } = useApp();
  const nav = useNavigate();
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<'ACTIVE' | 'ARCHIVED' | 'ALL' | 'BALANCE'>('ACTIVE');
  const rows = useQuery(() => searchOwners(q, filter === 'BALANCE' ? 'ACTIVE' : filter, filter === 'BALANCE'), [q, filter]);
  const settings = useQuery(getSettings);
  const clinic = locale === 'ar' ? settings.name_ar : settings.name_en;
  return (
    <div className="page">
      <PageHead title={t('owners.title')} sub={t('owners.count', { n: rows.length })}>
        <button className="btn primary" onClick={() => nav('/owners/new')}>
          <Icon name="plus" /> {t('owners.new')}
        </button>
      </PageHead>
      <div className="row" style={{ marginBottom: 12 }}>
        <div className="searchbox" style={{ flex: 1, minWidth: 240 }}>
          <Icon name="search" />
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('dashboard.search')} />
        </div>
        <div className="seg" role="tablist">
          {(['ACTIVE', 'BALANCE', 'ARCHIVED', 'ALL'] as const).map((f) => (
            <button key={f} className={filter === f ? 'on' : ''} onClick={() => setFilter(f)}>
              {f === 'ALL' ? t('common.all') : f === 'ACTIVE' ? t('owners.filterActive') : f === 'ARCHIVED' ? t('owners.filterArchived') : t('owners.filterBalance')}
            </button>
          ))}
        </div>
      </div>
      <div className="tablewrap">
        <table className="t">
          <thead>
            <tr>
              <th>{t('owners.fullName')}</th>
              <th>{t('owners.phone')}</th>
              <th className="hide-sm">{t('owners.pets')}</th>
              <th className="r">{t('owners.balance')}</th>
              <th className="r" />
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr><td colSpan={5} className="empty">{q ? t('common.noResults') : t('owners.empty')}</td></tr>
            )}
            {rows.map((o) => (
              <tr key={o.id} className={`link ${o.status === 'ARCHIVED' ? 'greyed' : ''}`} onClick={() => nav(`/owners/${o.id}`)}>
                <td>
                  <b>{o.full_name}</b> <OwnerCode code={o.code} ownerId={o.id} /> {o.status === 'ARCHIVED' && <StatusBadge ns="owners" value="archived" />}
                </td>
                <td className="ltr num">{o.phone}</td>
                <td className="hide-sm muted">{o.pet_names ?? '—'}</td>
                <td className="r num">{o.balance > 0 ? <b style={{ color: 'var(--bad)' }}>{fmt.money(o.balance)}</b> : <span className="faint">—</span>}</td>
                <td className="r" onClick={(e) => e.stopPropagation()}>
                  <div className="row end" style={{ flexWrap: 'nowrap' }}>
                    <a className="btn sm" href={telUrl(o.phone)} title={t('common.call')} onClick={(e) => e.stopPropagation()}>
                      <Icon name="phone" />
                    </a>
                    <WaButton small label="" phone={o.whatsapp || o.phone} text={t('wa.general', { owner: o.full_name, clinic })} />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const emptyOwner: OwnerInput = { full_name: '', phone: '', whatsapp: '', email: '', address: '', national_id: '', notes: '' };

export function OwnerFormPage() {
  const { id } = useParams();
  const existing = id ? getOwner(id) : undefined;
  const { t, toast } = useApp();
  const nav = useNavigate();
  const [f, setF] = useState<OwnerInput>(() => (existing ? { ...emptyOwner, ...pick(existing) } : emptyOwner));
  const [dup, setDup] = useState<Owner | null>(null);
  const set = (k: keyof OwnerInput) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });

  const doSave = () => {
    const savedId = saveOwner(f, id);
    toast(t('app.saved'));
    nav(`/owners/${savedId}`, { replace: true });
  };
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const d = findDuplicatePhone(f.phone, id) ?? (f.whatsapp ? findDuplicatePhone(f.whatsapp, id) : undefined);
    if (d) setDup(d);
    else doSave();
  };

  return (
    <div className="page narrow">
      <PageHead title={id ? t('owners.edit') : t('owners.new')} crumb={{ to: id ? `/owners/${id}` : '/owners', label: id ? existing?.full_name ?? '' : t('owners.title') }} />
      <form onSubmit={submit}>
        <div className="grid g2">
          <Field label={t('owners.fullName')} className="span2">
            <input type="text" value={f.full_name} onChange={set('full_name')} required autoFocus />
          </Field>
          <Field label={t('owners.phone')}>
            <input type="tel" className="ltr" value={f.phone} onChange={set('phone')} required inputMode="tel" placeholder="01x xxxx xxxx" />
          </Field>
          <Field label={t('owners.whatsapp')} hint={t('owners.whatsappHint')} optional>
            <input type="tel" className="ltr" value={f.whatsapp ?? ''} onChange={set('whatsapp')} inputMode="tel" />
          </Field>
          <Field label={t('owners.email')} optional>
            <input type="email" className="ltr" value={f.email ?? ''} onChange={set('email')} />
          </Field>
          <Field label={t('owners.nationalId')} optional>
            <input type="text" className="ltr" value={f.national_id ?? ''} onChange={set('national_id')} />
          </Field>
          <Field label={t('owners.address')} className="span2" optional>
            <input type="text" value={f.address ?? ''} onChange={set('address')} />
          </Field>
          <Field label={t('common.notes')} className="span2" optional>
            <textarea value={f.notes ?? ''} onChange={set('notes')} />
          </Field>
        </div>
        <div className="actionbar">
          <button type="button" className="btn" onClick={() => nav(-1)}>{t('common.cancel')}</button>
          <button className="btn primary">{t('common.save')}</button>
        </div>
      </form>
      {dup && (
        <Dialog
          title={t('owners.dupTitle')}
          onClose={() => setDup(null)}
          footer={
            <>
              <button className="btn" onClick={() => nav(`/owners/${dup.id}`)}>{t('owners.openExisting', { name: dup.full_name })}</button>
              <button className="btn primary" onClick={() => { setDup(null); doSave(); }}>{t('common.saveAnyway')}</button>
            </>
          }
        >
          <p className="note warn" style={{ margin: 0 }}>{t('owners.dupBody', { name: dup.full_name })}</p>
          <p className="ltr muted">{dup.phone}</p>
        </Dialog>
      )}
    </div>
  );
}

function pick(o: Owner): OwnerInput {
  return { full_name: o.full_name, phone: o.phone, whatsapp: o.whatsapp, email: o.email, address: o.address, national_id: o.national_id, notes: o.notes };
}
