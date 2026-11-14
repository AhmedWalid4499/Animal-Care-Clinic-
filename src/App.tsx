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
import { IntakeFormPage } from './screens/IntakeForm';
import { Appointments } from './screens/Appointments';
import { InvoicesList, InvoiceFormPage, InvoiceDetail, InvoicePrint } from './screens/Invoices';
import { Settings } from './screens/Settings';
import { MySettings } from './screens/MySettings';
import { Reminders } from './screens/Reminders';
import { VaccinationCertificate } from './screens/Certificate';
import { Reports } from './screens/Reports';
import { StockPage } from './screens/Stock';
import { PrescriptionPrint, TemplatePrint } from './screens/Prescription';
import { ConsentNew, ConsentView } from './screens/Consent';
import { Ward } from './screens/Ward';
import { DrugsPage, PricesPage, TemplatesPage, VaccinesPage } from './components/Sections';
import { useEffect, type ReactNode } from 'react';
import { OwnerCardPrint } from './components/OwnerPage';
import { ForcedPasswordChange } from './components/Account';
import { onLive } from './sync/engine';

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

// Pre-diagnosis: Assistants too (they send the patient to the vet; the diagnosis stays with Admins and Doctors).
function IntakeAllowed({ children }: { children: ReactNode }) {
  const { canIntake, t } = useApp();
  if (!canIntake) return <div className="page"><p className="note warn">{t('visits.vetOnly')}</p></div>;
  return <>{children}</>;
}

/** Routes follow CLAUDE.md "Screens → routes". HashRouter because the desktop app loads from file://. */
export function App({ firstRun }: { firstRun: boolean }) {
  const { user, setUser } = useApp();
  // The server signed this device out (Admin, password reset, deactivated): back to the sign-in screen.
  useEffect(() => onLive((m) => m.type === 'revoked' && setUser(null)), [setUser]);
  if (!user) return <Login firstRun={firstRun} />;
  if (user.must_change_password) return <ForcedPasswordChange />;
  return (
    <HashRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<Dashboard />} />
          <Route path="owners" element={<OwnersList />} />
          <Route path="owners/new" element={<OwnerFormPage />} />
          <Route path="owners/:id" element={<OwnerDetail />} />
          <Route path="owners/:id/edit" element={<OwnerFormPage />} />
          <Route path="owners/:id/card" element={<OwnerCardPrint />} />
          <Route path="owners/:ownerId/pets/new" element={<PetFormPage />} />
          <Route path="pets/:id" element={<PetRecord />} />
          <Route path="pets/:id/edit" element={<PetFormPage />} />
          <Route path="pets/:id/print" element={<PetSummaryPrint />} />
          <Route path="pets/:id/certificate" element={<VaccinationCertificate />} />
          <Route path="pets/:id/consent/new" element={<ConsentNew />} />
          <Route path="consents/:id" element={<ConsentView />} />
          <Route path="visits/new" element={<ClinicalOnly><VisitPickPet /></ClinicalOnly>} />
          <Route path="pets/:petId/visits/new" element={<ClinicalOnly><VisitFormPage /></ClinicalOnly>} />
          <Route path="visits/:visitId/edit" element={<ClinicalOnly><VisitFormPage /></ClinicalOnly>} />
          <Route path="visits/:visitId/prescription" element={<PrescriptionPrint />} />
          <Route path="intake/new" element={<IntakeAllowed><VisitPickPet intake /></IntakeAllowed>} />
          <Route path="pets/:petId/intake" element={<IntakeAllowed><IntakeFormPage /></IntakeAllowed>} />
          <Route path="visits/:visitId/intake" element={<IntakeAllowed><IntakeFormPage /></IntakeAllowed>} />
          <Route path="appointments" element={<Appointments />} />
          <Route path="reminders" element={<Reminders />} />
          <Route path="invoices" element={<InvoicesList />} />
          <Route path="invoices/new" element={<InvoiceFormPage />} />
          <Route path="invoices/:id" element={<InvoiceDetail />} />
          <Route path="invoices/:id/edit" element={<InvoiceFormPage />} />
          <Route path="invoices/:id/print" element={<InvoicePrint />} />
          <Route path="reports" element={<AdminOnly><Reports /></AdminOnly>} />
          <Route path="ward" element={<Ward />} />
          <Route path="stock" element={<StockPage />} />
          <Route path="stock/vaccines" element={<AdminOnly><VaccinesPage /></AdminOnly>} />
          <Route path="stock/drugs" element={<AdminOnly><DrugsPage /></AdminOnly>} />
          <Route path="prices" element={<AdminOnly><PricesPage /></AdminOnly>} />
          <Route path="templates" element={<ClinicalOnly><TemplatesPage /></ClinicalOnly>} />
          <Route path="templates/:id/print" element={<ClinicalOnly><TemplatePrint /></ClinicalOnly>} />
          <Route path="settings" element={<AdminOnly><Settings /></AdminOnly>} />
          <Route path="account" element={<MySettings />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </HashRouter>
  );
}
