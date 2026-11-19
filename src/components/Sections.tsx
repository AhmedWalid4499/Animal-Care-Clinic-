// Sidebar sections that hold several screens (7 Nov 2026, at Ahmed's request):
// Pricing = Invoices · Reports · Price list, Stock = Stock · Vaccine catalogue · Drugs. Each screen keeps its own route;
// this row of links on top moves between them.
import { NavLink } from 'react-router-dom';
import { useApp } from '../lib/app';
import { PageHead } from './Layout';
import { DrugsTab, TemplatesTab } from '../screens/SettingsClinical';
import { PricesTab, VaccinesTab } from '../screens/Settings';

function SectionTabs({ items }: { items: { to: string; label: string; end?: boolean }[] }) {
  if (items.length < 2) return null;
  return (
    <nav className="section-tabs no-print">
      {items.map((i) => <NavLink key={i.to} to={i.to} end={i.end ?? true}>{i.label}</NavLink>)}
    </nav>
  );
}

/** Invoices · Reports · Price list · Packages (all but Invoices for the Admin). */
export function PricingTabs() {
  const { t, isAdmin } = useApp();
  return (
    <SectionTabs
      items={[
        { to: '/invoices', label: t('nav.invoices') },
        ...(isAdmin ? [{ to: '/reports', label: t('nav.reports') }, { to: '/prices', label: t('settings.prices') }, { to: '/packages', label: t('packages.title') }] : []),
      ]}
    />
  );
}

/** Stock · Vaccine catalogue · Drugs · Suppliers (all but Stock are the Admin's). */
export function StockTabs() {
  const { t, isAdmin } = useApp();
  return (
    <SectionTabs
      items={[
        { to: '/stock', label: t('stock.title') },
        ...(isAdmin ? [{ to: '/stock/vaccines', label: t('settings.vaccines') }, { to: '/stock/drugs', label: t('settings.drugs') }, { to: '/stock/suppliers', label: t('suppliers.title'), end: false }] : []),
      ]}
    />
  );
}

export function PricesPage() {
  const { t } = useApp();
  return (
    <div className="page">
      <PricingTabs />
      <PageHead title={t('settings.prices')} />
      <PricesTab />
    </div>
  );
}

export function VaccinesPage() {
  const { t } = useApp();
  return (
    <div className="page">
      <StockTabs />
      <PageHead title={t('settings.vaccines')} />
      <VaccinesTab />
    </div>
  );
}

export function DrugsPage() {
  const { t } = useApp();
  return (
    <div className="page">
      <StockTabs />
      <PageHead title={t('settings.drugs')} />
      <DrugsTab />
    </div>
  );
}

export function TemplatesPage() {
  const { t } = useApp();
  return (
    <div className="page">
      <PageHead title={t('settings.templates')} />
      <TemplatesTab />
    </div>
  );
}
