// Shared pieces of the Dental and Vision tabs (Phase 6): the vet's draft finding for the selected part, the hover
// card, and the inspector where a Doctor/Admin records a finding, changes how the part looks and adds notes.
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useApp, useQuery } from '../lib/app';
import { petChartMarks, saveChartMark } from '../db/repo';
import type { ChartKind, ChartMark } from '../db/types';
import { splitConditions } from '../lib/dental';
import { Badge } from './ui';

export interface Look { conditions: string[]; severity: number | null; shade: string | null; notes: string | null }
export interface PartInfo {
  title: string;
  subtitle?: string;
  facts?: [string, ReactNode][];
  about?: string;
  /** Extra line under the title, e.g. "not through the gum yet". */
  status?: string;
}
export interface Choice { key: string; label: string }

const EMPTY: Look = { conditions: [], severity: null, shade: null, notes: null };
const toLook = (m?: ChartMark): Look =>
  m ? { conditions: splitConditions(m.conditions), severity: m.severity, shade: m.shade, notes: m.notes } : EMPTY;
const same = (a: Look, b: Look) =>
  a.conditions.join(',') === b.conditions.join(',') && (a.severity ?? null) === (b.severity ?? null) &&
  (a.shade || null) === (b.shade || null) && (a.notes?.trim() || null) === (b.notes?.trim() || null);

/** Marks of one chart, the selected part and its unsaved draft. Picking another part saves the draft first. */
export function useChart(petId: string, chart: ChartKind) {
  const { canVisit, user, toast, t } = useApp();
  const marks = useQuery(() => petChartMarks(petId, chart), [petId, chart]);
  const byPart = useMemo(() => new Map(marks.map((m) => [m.part, m])), [marks]);
  const [selected, setSelected] = useState<string | null>(null);
  const [draft, setDraft] = useState<Look>(EMPTY);
  const saved = selected ? toLook(byPart.get(selected)) : EMPTY;
  const dirty = !!selected && canVisit && !same(draft, saved);

  const save = (quiet = false) => {
    if (!selected || !dirty) return;
    saveChartMark(petId, chart, selected, draft, user?.id ?? null);
    if (!quiet) toast(t('charts.saved'));
  };
  const select = (part: string | null) => {
    if (part === selected) return;
    if (dirty) save(true);
    setSelected(part);
    setDraft(part ? toLook(byPart.get(part)) : EMPTY);
  };
  // Leaving the tab (or the pet) with an unsaved finding keeps it rather than dropping it.
  const onLeave = useRef<() => void>(() => {});
  onLeave.current = () => save(true);
  useEffect(() => () => onLeave.current(), []);
  /** How a part should be drawn right now: the draft while it is being edited, else what is saved. */
  const look = (part: string): Look => (part === selected ? draft : toLook(byPart.get(part)));
  return { marks, byPart, selected, select, draft, setDraft, dirty, save, look, canEdit: canVisit };
}
export type ChartState = ReturnType<typeof useChart>;

/** Hover card that follows the mouse over the chart (mouse only; on a phone a tap selects instead). */
export function useHover() {
  const wrap = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<{ part: string; x: number; y: number } | null>(null);
  const bind = (part: string) => ({
    onPointerMove: (e: React.PointerEvent) => {
      if (e.pointerType !== 'mouse' || !wrap.current) return;
      const r = wrap.current.getBoundingClientRect();
      setHover({ part, x: e.clientX - r.left, y: e.clientY - r.top });
    },
    onPointerLeave: () => setHover((h) => (h?.part === part ? null : h)),
  });
  return { wrap, hover, bind, clear: () => setHover(null) };
}

export function HoverCard({ x, y, width, info, look, labelOf, sevLabel, hint }: {
  x: number; y: number; width: number; info: PartInfo; look: Look; labelOf: (c: string) => string; sevLabel: (n: number) => string; hint: string;
}) {
  const { t } = useApp();
  const left = Math.min(Math.max(8, x + 16), Math.max(8, width - 268));
  return (
    <div className="hovercard" style={{ left, top: y + 18 }} role="tooltip">
      <b>{info.title}</b>
      {info.subtitle && <div className="faint small">{info.subtitle}</div>}
      {info.status && <div className="small" style={{ color: 'var(--warn)' }}>{info.status}</div>}
      {info.facts && info.facts.length > 0 && (
        <dl>{info.facts.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
      )}
      {info.about && <p className="small muted">{info.about}</p>}
      <div className="row" style={{ gap: 4 }}>
        {look.conditions.length ? look.conditions.map((c) => <Badge key={c} kind="warn">{labelOf(c)}</Badge>) : <Badge kind="ok">{t('charts.normal')}</Badge>}
        {look.severity ? <Badge>{sevLabel(look.severity)}</Badge> : null}
      </div>
      {look.notes && <p className="small hc-notes">{look.notes.length > 160 ? `${look.notes.slice(0, 160)}…` : look.notes}</p>}
      <div className="faint small">{hint}</div>
    </div>
  );
}

/** Right-hand (or, on a phone, below) panel: what the part is, and the vet's finding. */
export function Inspector({ state, info, options, exclusive = [], normalKey, shades, shadeLabel, naturalHex, notesOnly, empty }: {
  state: ChartState;
  info: PartInfo | null;
  options: Choice[];
  exclusive?: string[];
  normalKey: string;
  shades?: Record<string, string>;
  shadeLabel?: (k: string) => string;
  naturalHex?: string;
  notesOnly?: boolean;
  empty: string;
}) {
  const { t, fmt } = useApp();
  const ref = useRef<HTMLDivElement>(null);
  const { selected, draft, setDraft, dirty, save, canEdit, byPart } = state;
  useEffect(() => {
    // On a phone the panel is under the chart: bring it into view when a part is tapped.
    if (selected && ref.current && window.matchMedia('(max-width: 900px)').matches) ref.current.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [selected]);
  if (!selected || !info) return <aside className="inspector" ref={ref}><p className="empty" style={{ border: 0 }}>{empty}</p></aside>;
  const mark = byPart.get(selected);
  const toggle = (k: string) => {
    if (k === normalKey) return setDraft({ ...draft, conditions: [], severity: null });
    let next = draft.conditions.includes(k) ? draft.conditions.filter((c) => c !== k) : [...draft.conditions.filter((c) => !exclusive.includes(c)), k];
    if (exclusive.includes(k) && next.includes(k)) next = [k];
    setDraft({ ...draft, conditions: next, severity: next.length ? draft.severity : null });
  };
  return (
    <aside className="inspector" ref={ref}>
      <header>
        <b>{info.title}</b>
        {info.subtitle && <div className="faint small">{info.subtitle}</div>}
        {info.status && <div className="small" style={{ color: 'var(--warn)' }}>{info.status}</div>}
      </header>
      {info.facts && info.facts.length > 0 && (
        <dl className="facts-dl">{info.facts.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
      )}
      {info.about && <p className="small muted" style={{ marginTop: 0 }}>{info.about}</p>}

      {!notesOnly && (
        <div className="insp-sec">
          <span className="lbl">{t('charts.condition')}</span>
          <div className="fchips">
            {options.map((o) => {
              const on = o.key === normalKey ? draft.conditions.length === 0 : draft.conditions.includes(o.key);
              return (
                <button key={o.key} type="button" className={`fchip ${on ? 'on' : ''} ${o.key === normalKey ? 'ok' : ''}`} disabled={!canEdit} aria-pressed={on} onClick={() => toggle(o.key)}>
                  {o.label}
                </button>
              );
            })}
          </div>
        </div>
      )}
      {!notesOnly && draft.conditions.length > 0 && (
        <div className="insp-sec">
          <span className="lbl">{t('charts.severity')}</span>
          <div className="seg">
            {[1, 2, 3].map((n) => (
              <button key={n} type="button" className={draft.severity === n ? 'on' : ''} disabled={!canEdit} onClick={() => setDraft({ ...draft, severity: draft.severity === n ? null : n })}>
                {t(`charts.sev${n}`)}
              </button>
            ))}
          </div>
        </div>
      )}
      {!notesOnly && shades && (
        <div className="insp-sec">
          <span className="lbl">{t('charts.look')}</span>
          <div className="swatches">
            <button type="button" className={`swatch natural ${!draft.shade ? 'on' : ''}`} disabled={!canEdit} onClick={() => setDraft({ ...draft, shade: null })} title={t('charts.natural')}>
              <i style={{ background: naturalHex }} /> <span>{t('charts.natural')}</span>
            </button>
            {Object.entries(shades).map(([k, hex]) => (
              <button key={k} type="button" className={`swatch ${draft.shade === k ? 'on' : ''}`} disabled={!canEdit} onClick={() => setDraft({ ...draft, shade: k })} title={shadeLabel?.(k)}>
                <i style={{ background: hex }} /> <span>{shadeLabel?.(k)}</span>
              </button>
            ))}
          </div>
        </div>
      )}
      <div className="insp-sec">
        <span className="lbl">{t('charts.notes')}</span>
        {canEdit ? (
          <textarea value={draft.notes ?? ''} placeholder={t('charts.notesPh')} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} rows={notesOnly ? 6 : 3} />
        ) : (
          <p className="small" style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{draft.notes || '—'}</p>
        )}
      </div>
      <p className="faint small" style={{ margin: '8px 0' }}>
        {mark ? t('charts.lastBy', { name: mark.updated_by_name ?? '—', when: fmt.dateTime(mark.updated_at) }) : t('charts.never')}
      </p>
      {canEdit ? (
        <div className="row">
          <button type="button" className="btn primary" disabled={!dirty} onClick={() => save()}>{t('charts.save')}</button>
          {!notesOnly && (draft.conditions.length > 0 || draft.shade || draft.severity) && (
            <button type="button" className="btn ghost" onClick={() => setDraft({ ...draft, conditions: [], severity: null, shade: null })}>{t('charts.reset')}</button>
          )}
          {dirty && <span className="faint small">{t('charts.autosave')}</span>}
        </div>
      ) : (
        <p className="faint small">{t('charts.readOnly')}</p>
      )}
    </aside>
  );
}

/** Everything recorded on this chart, as a list; clicking a row selects that part. */
export function FindingsList({ state, nameOf, labelOf, empty }: {
  state: ChartState; nameOf: (part: string) => string | null; labelOf: (part: string, c: string) => string; empty: string;
}) {
  const { t, fmt } = useApp();
  const rows = state.marks.filter((m) => m.conditions || m.notes || m.shade);
  return (
    <div className="findings">
      <h3>{t('charts.allFindings')}</h3>
      {rows.length === 0 ? (
        <p className="empty">{empty}</p>
      ) : (
        <ul className="list">
          {rows.map((m) => {
            const name = nameOf(m.part);
            if (!name) return null;
            const conds = splitConditions(m.conditions);
            return (
              <li key={m.id} className={`link ${state.selected === m.part ? 'sel' : ''}`} onClick={() => state.select(m.part)}>
                <div className="main-col">
                  <b>{name}</b>
                  <div className="row" style={{ gap: 4, marginTop: 2 }}>
                    {conds.map((c) => <Badge key={c} kind="warn">{labelOf(m.part, c)}</Badge>)}
                    {m.severity ? <Badge>{t(`charts.sev${m.severity}`)}</Badge> : null}
                    {m.shade && <Badge>{t('charts.lookChanged')}</Badge>}
                  </div>
                  {m.notes && <div className="sub" style={{ whiteSpace: 'normal' }}>{m.notes}</div>}
                </div>
                <span className="faint small">{fmt.date(m.updated_at)}</span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
