// Stock (6 Nov 2026 change request): tracked price items (Settings → Price list → "Track stock"), how many are on hand,
// and their movement log. Invoices take items out by themselves; the Admin restocks and corrects counts here.
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp, useQuery } from '../lib/app';
import { correctStock, expiringStock, lowStock, restock, stockHistory, stockLevels, type StockRow } from '../db/repo';
import { daysBetween, today } from '../lib/dates';
import { Badge, Dialog, Field, Icon } from '../components/ui';
import { PageHead } from '../components/Layout';
import { StockTabs } from '../components/Sections';

type Action = { row: StockRow; kind: 'restock' | 'count' } | { row: StockRow; kind: 'history' };

export function StockPage() {
  const { t, fmt, locale, isAdmin } = useApp();
  const nav = useNavigate();
  const rows = useQuery(stockLevels);
  const expiring = useQuery(() => expiringStock(30));
  const [act, setAct] = useState<Action | null>(null);
  const name = (r: StockRow) => (locale === 'ar' ? r.name_ar : r.name_en);
  return (
    <div className="page stock">
      <StockTabs />
      <PageHead title={t('stock.title')} sub={t('stock.sub')} />
      {rows.length === 0 ? (
        <p className="note">
          {t('stock.none')}{' '}
          {isAdmin && <button type="button" className="linkbtn" onClick={() => nav('/prices')}>{t('settings.prices')}</button>}
        </p>
      ) : (
        <div className="tablewrap">
          <table className="t">
            <thead>
              <tr><th>{t('stock.item')}</th><th className="r">{t('stock.onHand')}</th><th className="r">{t('stock.lowAt')}</th><th>{t('common.status')}</th><th>{t('stock.lastMove')}</th>{isAdmin && <th />}</tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const low = r.on_hand <= (r.low_stock ?? 0);
                return (
                  <tr key={r.id} className={`link ${r.is_active ? '' : 'greyed'}`} onClick={() => setAct({ row: r, kind: 'history' })}>
                    <td><b>{name(r)}</b> <span className="muted small">· {t(`priceCategory.${r.category}`)}</span></td>
                    <td className="r num"><b>{fmt.num(r.on_hand, 2)}</b></td>
                    <td className="r num muted">{r.low_stock != null ? fmt.num(r.low_stock, 2) : '—'}</td>
                    <td>{r.on_hand <= 0 ? <Badge kind="bad">{t('stock.out')}</Badge> : low ? <Badge kind="warn">{t('stock.low')}</Badge> : <Badge kind="ok">{t('stock.ok')}</Badge>}</td>
                    <td className="muted">{r.last_move ? fmt.date(r.last_move) : '—'}</td>
                    {isAdmin && (
                      <td className="r" onClick={(e) => e.stopPropagation()}>
                        <span className="row" style={{ justifyContent: 'flex-end', flexWrap: 'nowrap' }}>
                          <button type="button" className="btn sm primary" onClick={() => setAct({ row: r, kind: 'restock' })}><Icon name="plus" /> {t('stock.restock')}</button>
                          <button type="button" className="btn sm" onClick={() => setAct({ row: r, kind: 'count' })}>{t('stock.count')}</button>
                        </span>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {expiring.length > 0 && (
        <section className="section expiring" style={{ marginTop: 22 }}>
          <header><h2>⏳ {t('stock.expiringTitle')}</h2><span className="count">{expiring.length}</span></header>
          <p className="muted small">{t('stock.expiringHint')}</p>
          <table className="t">
            <thead><tr><th>{t('stock.item')}</th><th>{t('stock.batch')}</th><th>{t('stock.expires')}</th><th className="r">{t('stock.left')}</th></tr></thead>
            <tbody>
              {expiring.map((b, i) => {
                const n = daysBetween(today(), b.expires_at!);
                return (
                  <tr key={i}>
                    <td><b>{locale === 'ar' ? b.name_ar : b.name_en}</b></td>
                    <td className="ltr">{b.batch_no ?? '—'}</td>
                    <td>{fmt.date(b.expires_at!)} <Badge kind={n < 0 ? 'bad' : 'warn'}>{n < 0 ? t('stock.expired') : t('stock.inDays', { n })}</Badge></td>
                    <td className="r num">{fmt.num(b.left, 2)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      )}
      {act && act.kind !== 'history' && <MoveDialog row={act.row} kind={act.kind} name={name(act.row)} onClose={() => setAct(null)} />}
      {act?.kind === 'history' && <HistoryDialog row={act.row} name={name(act.row)} onClose={() => setAct(null)} />}
    </div>
  );
}

function MoveDialog({ row, kind, name, onClose }: { row: StockRow; kind: 'restock' | 'count'; name: string; onClose: () => void }) {
  const { t, fmt, toast, user } = useApp();
  const [qty, setQty] = useState('');
  const [note, setNote] = useState('');
  const [batch, setBatch] = useState('');
  const [expires, setExpires] = useState('');
  const v = Number(qty.replace(',', '.'));
  const valid = qty.trim() !== '' && Number.isFinite(v) && (kind === 'restock' ? v > 0 : v >= 0);
  const save = () => {
    if (kind === 'restock') restock(row.id, v, note, user?.id ?? null, { batch_no: batch, expires_at: expires });
    else correctStock(row.id, v, note, user?.id ?? null);
    toast(t('app.saved'));
    onClose();
  };
  return (
    <Dialog
      title={`${kind === 'restock' ? t('stock.restock') : t('stock.count')} · ${name}`}
      onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>{t('common.cancel')}</button><button className="btn primary" disabled={!valid} onClick={save}>{t('common.save')}</button></>}
    >
      <p className="muted small">{t('stock.nowOnHand', { n: fmt.num(row.on_hand, 2) })}</p>
      <Field label={kind === 'restock' ? t('stock.received') : t('stock.counted')} hint={kind === 'count' ? t('stock.countHint') : undefined}>
        <input type="number" min="0" step="any" inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)} autoFocus />
      </Field>
      {kind === 'restock' && (
        <div className="grid g2">
          <Field label={t('stock.batch')} optional><input type="text" className="ltr" value={batch} onChange={(e) => setBatch(e.target.value)} /></Field>
          <Field label={t('stock.expires')} optional><input type="date" value={expires} min={today()} onChange={(e) => setExpires(e.target.value)} /></Field>
        </div>
      )}
      <Field label={t('common.notes')} optional>
        <input type="text" value={note} placeholder={kind === 'restock' ? t('stock.notePh') : ''} onChange={(e) => setNote(e.target.value)} />
      </Field>
    </Dialog>
  );
}

function HistoryDialog({ row, name, onClose }: { row: StockRow; name: string; onClose: () => void }) {
  const { t, fmt } = useApp();
  const moves = useQuery(() => stockHistory(row.id), [row.id]);
  return (
    <Dialog title={`${t('stock.history')} · ${name}`} onClose={onClose} wide footer={<button className="btn" onClick={onClose}>{t('common.close')}</button>}>
      <p className="muted small">{t('stock.nowOnHand', { n: fmt.num(row.on_hand, 2) })}</p>
      <div className="tablewrap">
        <table className="t compact">
          <thead><tr><th>{t('common.date')}</th><th>{t('stock.reasonCol')}</th><th className="r">{t('stock.change')}</th><th>{t('stock.by')}</th><th>{t('common.notes')}</th></tr></thead>
          <tbody>
            {moves.length === 0 && <tr><td colSpan={5} className="muted">{t('stock.noMoves')}</td></tr>}
            {moves.map((m) => (
              <tr key={m.id}>
                <td>{fmt.dateTime(m.at)}</td>
                <td>{t(`stock.reason.${m.reason}`)}{m.invoice_number ? <span className="ltr muted"> · {m.invoice_number}</span> : null}</td>
                <td className={`r num ${m.qty < 0 ? 'neg' : 'pos'}`}>{m.qty > 0 ? '+' : ''}{fmt.num(m.qty, 2)}</td>
                <td>{m.user_name ?? '—'}</td>
                <td className="muted">{[m.batch_no ? `${t('stock.batch')} ${m.batch_no}` : null, m.expires_at ? `${t('stock.expires')} ${fmt.date(m.expires_at)}` : null, m.note].filter(Boolean).join(' · ')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Dialog>
  );
}

/** Dashboard: tracked items at or below their warning level. Nothing when all is well. */
export function LowStockSection() {
  const { t, fmt, locale } = useApp();
  const nav = useNavigate();
  const rows = useQuery(lowStock);
  const expiring = useQuery(() => expiringStock(30));
  if (!rows.length && !expiring.length) return null;
  return (
    <div className="note warn low-stock" role="status">
      {rows.length > 0 && (
        <div>
          <b>📦 {t('stock.runningLow')}</b>{' '}
          {rows.map((r, i) => (
            <span key={r.id}>{i ? ' · ' : ''}{locale === 'ar' ? r.name_ar : r.name_en}: <b className="num">{fmt.num(r.on_hand, 2)}</b></span>
          ))}
        </div>
      )}
      {expiring.length > 0 && (
        <div>
          <b>⏳ {t('stock.expiringSoon')}</b>{' '}
          {expiring.slice(0, 4).map((b, i) => (
            <span key={i}>{i ? ' · ' : ''}{locale === 'ar' ? b.name_ar : b.name_en}{b.batch_no ? <span className="ltr"> ({b.batch_no})</span> : null}: {fmt.date(b.expires_at!)}</span>
          ))}
          {expiring.length > 4 ? ` +${expiring.length - 4}` : ''}
        </div>
      )}
      <button type="button" className="linkbtn" onClick={() => nav('/stock')}>{t('stock.open')}</button>
    </div>
  );
}
