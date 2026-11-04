import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useApp, useQuery } from '../lib/app';
import { getOwner, getSettings, ownerBalance, ownerInvoices, ownerPets, setOwnerStatus } from '../db/repo';
import { ageParts } from '../lib/dates';
import { telUrl } from '../lib/whatsapp';
import { Confirm, Icon, PetAvatar, StatusBadge, WaButton } from '../components/ui';
import { PageHead } from '../components/Layout';

export function OwnerDetail() {
  const { id = '' } = useParams();
  const { t, fmt, isAdmin, locale } = useApp();
  const nav = useNavigate();
  const owner = useQuery(() => getOwner(id), [id]);
  const pets = useQuery(() => ownerPets(id), [id]);
  const invoices = useQuery(() => ownerInvoices(id), [id]);
  const balance = useQuery(() => ownerBalance(id), [id]);
  const settings = useQuery(getSettings);
  const [confirm, setConfirm] = useState(false);
  if (!owner) return <div className="page">{t('common.notFound')}</div>;
  const open = invoices.filter((i) => i.status === 'UNPAID' || i.status === 'PARTIAL');
  const clinic = locale === 'ar' ? settings.name_ar : settings.name_en;

  return (
    <div className="page">
      <PageHead title={owner.full_name} crumb={{ to: '/owners', label: t('owners.title') }} sub={owner.status === 'ARCHIVED' ? t('owners.archived') : undefined}>
        <a className="btn" href={telUrl(owner.phone)}><Icon name="phone" /> {t('common.call')}</a>
        <WaButton phone={owner.whatsapp || owner.phone} text={t('wa.general', { owner: owner.full_name, clinic })} />
        <button className="btn" onClick={() => nav(`/owners/${id}/edit`)}><Icon name="edit" /> {t('common.edit')}</button>
      </PageHead>

      <div className="facts" style={{ marginTop: 0 }}>
        <div><span>{t('owners.phone')}</span><b className="ltr">{owner.phone}</b></div>
        <div><span>{t('owners.whatsapp')}</span><b className="ltr">{owner.whatsapp || owner.phone}</b></div>
        {owner.email && <div><span>{t('owners.email')}</span><b className="ltr">{owner.email}</b></div>}
        {owner.address && <div><span>{t('owners.address')}</span><b>{owner.address}</b></div>}
        {owner.national_id && <div><span>{t('owners.nationalId')}</span><b className="ltr">{owner.national_id}</b></div>}
        <div>
          <span>{t('owners.balance')}</span>
          <b className="num" style={{ color: balance > 0 ? 'var(--bad)' : undefined }}>{fmt.money(balance)}</b>
        </div>
      </div>
      {owner.notes && <p className="note" style={{ marginTop: 14 }}>{owner.notes}</p>}

      <div className="cols" style={{ marginTop: 22 }}>
        <section className="section">
          <header>
            <h2>{t('owners.pets')} <span className="count">{pets.length}</span></h2>
            <button className="btn sm primary" onClick={() => nav(`/owners/${id}/pets/new`)}><Icon name="plus" /> {t('ownerDetail.addPet')}</button>
          </header>
          <ul className="list">
            {pets.length === 0 && <li className="empty">{t('ownerDetail.noPets')}</li>}
            {pets.map((p) => {
              const age = p.date_of_birth ? ageParts(p.date_of_birth) : null;
              return (
                <li key={p.id} className={`link ${p.status !== 'ACTIVE' ? 'greyed' : ''}`} onClick={() => nav(`/pets/${p.id}`)}>
                  <PetAvatar photo={p.photo_url} species={p.species} size="sm" />
                  <div className="main-col">
                    <b>{p.name}</b>
                    <div className="sub">
                      {t(`species.${p.species}`)}{p.breed ? ` · ${p.breed}` : ''} · {t(`sex.${p.sex}`)}
                      {age ? ` · ${t('pets.ageValue', { y: age.years, m: age.months })}` : ''}
                    </div>
                  </div>
                  {p.status !== 'ACTIVE' && <StatusBadge ns="petStatus" value={p.status} />}
                </li>
              );
            })}
          </ul>
        </section>

        <section className="section">
          <header>
            <h2>{t('ownerDetail.openInvoices')} <span className="count">{open.length}</span></h2>
            <button className="btn sm" onClick={() => nav(`/invoices/new?owner=${id}`)}><Icon name="plus" /> {t('ownerDetail.newInvoice')}</button>
          </header>
          <ul className="list">
            {open.length === 0 && <li className="empty">{t('ownerDetail.noOpenInvoices')}</li>}
            {open.map((i) => (
              <li key={i.id} className="link" onClick={() => nav(`/invoices/${i.id}`)}>
                <div className="main-col">
                  <b className="ltr">{i.number}</b>
                  <div className="sub">{fmt.date(i.issued_at)}{i.pet_name ? ` · ${i.pet_name}` : ''}</div>
                </div>
                <span className="num">{fmt.money(i.total - i.paid)}</span>
                <StatusBadge ns="invoiceStatus" value={i.status} />
              </li>
            ))}
          </ul>
          {invoices.length > open.length && (
            <p className="small"><a href={`#/invoices?q=${encodeURIComponent(owner.full_name)}`}>{t('ownerDetail.allInvoices')} ({invoices.length})</a></p>
          )}
        </section>
      </div>

      {isAdmin && (
        <div style={{ marginTop: 32 }}>
          <button className="btn danger sm" onClick={() => setConfirm(true)}>
            {owner.status === 'ACTIVE' ? t('owners.archive') : t('owners.unarchive')}
          </button>
        </div>
      )}
      {confirm && (
        <Confirm
          title={owner.status === 'ACTIVE' ? t('owners.archive') : t('owners.unarchive')}
          body={owner.full_name}
          danger={owner.status === 'ACTIVE'}
          onClose={() => setConfirm(false)}
          onConfirm={() => setOwnerStatus(id, owner.status === 'ACTIVE' ? 'ARCHIVED' : 'ACTIVE')}
        />
      )}
    </div>
  );
}
