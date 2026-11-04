import { HashRouter, Navigate, Route, Routes } from 'react-router-dom';
import { useApp } from './lib/app';
import { Layout } from './components/Layout';
import { Login } from './screens/Login';
import { Dashboard } from './screens/Dashboard';
import { OwnersList, OwnerFormPage } from './screens/Owners';
import { OwnerDetail } from './screens/OwnerDetail';
import { PetFormPage } from './screens/PetForm';
import { PetRecord, PetSummaryPrint } from './screens/PetRecord';
import { VisitFormPage, VisitPickPet } from './screens/VisitForm';
import { Appointments } from './screens/Appointments';
import { InvoicesList, InvoiceFormPage, InvoiceDetail, InvoicePrint } from './screens/Invoices';
import { Settings } from './screens/Settings';
import type { ReactNode } from 'react';

function AdminOnly({ children }: { children: ReactNode }) {
  const { isAdmin, t } = useApp();
  if (!isAdmin) return <div className="page"><p className="note warn">{t('settings.vetOnly')}</p></div>;
  return <>{children}</>;
}

function ClinicalOnly({ children }: { children: ReactNode }) {
  const { canVisit, t } = useApp();
  if (!canVisit) return <div className="page"><p className="note warn">{t('visits.vetOnly')}</p></div>;
  return <>{children}</>;
}

/** Routes follow CLAUDE.md "Screens → routes". HashRouter because the desktop app loads from file://. */
export function App({ firstRun }: { firstRun: boolean }) {
  const { user } = useApp();
  if (!user) return <Login firstRun={firstRun} />;
  return (
    <HashRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<Dashboard />} />
          <Route path="owners" element={<OwnersList />} />
          <Route path="owners/new" element={<OwnerFormPage />} />
          <Route path="owners/:id" element={<OwnerDetail />} />
          <Route path="owners/:id/edit" element={<OwnerFormPage />} />
          <Route path="owners/:ownerId/pets/new" element={<PetFormPage />} />
          <Route path="pets/:id" element={<PetRecord />} />
          <Route path="pets/:id/edit" element={<PetFormPage />} />
          <Route path="pets/:id/print" element={<PetSummaryPrint />} />
          <Route path="visits/new" element={<ClinicalOnly><VisitPickPet /></ClinicalOnly>} />
          <Route path="pets/:petId/visits/new" element={<ClinicalOnly><VisitFormPage /></ClinicalOnly>} />
          <Route path="visits/:visitId/edit" element={<ClinicalOnly><VisitFormPage /></ClinicalOnly>} />
          <Route path="appointments" element={<Appointments />} />
          <Route path="invoices" element={<InvoicesList />} />
          <Route path="invoices/new" element={<InvoiceFormPage />} />
          <Route path="invoices/:id" element={<InvoiceDetail />} />
          <Route path="invoices/:id/edit" element={<InvoiceFormPage />} />
          <Route path="invoices/:id/print" element={<InvoicePrint />} />
          <Route path="settings" element={<AdminOnly><Settings /></AdminOnly>} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </HashRouter>
  );
}
