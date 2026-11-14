export const SPECIES = ['DOG', 'CAT', 'BIRD', 'RABBIT', 'REPTILE', 'OTHER'] as const;
export const SEXES = ['MALE', 'FEMALE', 'UNKNOWN'] as const;
export const PET_STATUS = ['ACTIVE', 'DECEASED', 'TRANSFERRED'] as const;
/** Patient alerts (schema v6): shown wherever the pet is handled, so the person in front of it sees them first. */
export const ALERT_FLAGS = ['AGGRESSIVE', 'ALLERGY', 'INFECTIOUS', 'DIABETIC', 'HEART', 'EPILEPSY', 'OTHER'] as const;
export const VISIT_TYPES = ['CHECKUP', 'VACCINATION', 'SURGERY', 'EMERGENCY', 'FOLLOW_UP', 'OTHER'] as const;
export const APPT_STATUS = ['SCHEDULED', 'DONE', 'NO_SHOW', 'CANCELLED'] as const;
export const ATTACHMENT_KINDS = ['LAB', 'XRAY', 'PHOTO', 'DOCUMENT', 'OTHER'] as const;
export const PRICE_CATEGORIES = ['CONSULTATION', 'VACCINE', 'SURGERY', 'MEDICATION', 'BOARDING', 'GROOMING', 'OTHER'] as const;
export const INVOICE_STATUS = ['UNPAID', 'PARTIAL', 'PAID', 'VOID'] as const;
export const PAYMENT_METHODS = ['CASH', 'INSTAPAY', 'CARD', 'OTHER'] as const;

export type Species = (typeof SPECIES)[number];
export type Sex = (typeof SEXES)[number];
export type PetStatus = (typeof PET_STATUS)[number];
export type AlertFlag = (typeof ALERT_FLAGS)[number];
export type VisitType = (typeof VISIT_TYPES)[number];
export type ApptStatus = (typeof APPT_STATUS)[number];
export type AttachmentKind = (typeof ATTACHMENT_KINDS)[number];
export type PriceCategory = (typeof PRICE_CATEGORIES)[number];
export type InvoiceStatus = (typeof INVOICE_STATUS)[number];
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];
export type Role = 'ADMIN' | 'DOCTOR' | 'ASSISTANT';
export const URGENCIES = ['ROUTINE', 'SOON', 'EMERGENCY'] as const;
export type Urgency = (typeof URGENCIES)[number];
export type VisitStage = 'WAITING' | 'WITH_VET' | 'DONE';
export const ROLES: Role[] = ['ADMIN', 'DOCTOR', 'ASSISTANT'];
export type Locale = 'ar' | 'en';

export interface User {
  id: string; name: string; email: string; password_hash: string; role: Role; locale: Locale; is_active: number; notify_off?: string | null; must_change_password?: number;
  roles?: string | null;
}
/**
 * Everything a person is (schema v14: users.roles, e.g. "ADMIN,DOCTOR"). Before v14 there was one role, and an Admin was
 * the clinic's vet (the old VET role), so an Admin without a list counts as Admin and Doctor.
 */
export function userRoles(u: Pick<User, 'role' | 'roles'> | null | undefined): Role[] {
  if (!u) return [];
  const list = (u.roles ?? '').split(',').filter((r): r is Role => (ROLES as string[]).includes(r));
  if (list.length) return ROLES.filter((r) => list.includes(r));
  return u.role === 'ADMIN' ? ['ADMIN', 'DOCTOR'] : [u.role];
}
/** The role that decides permissions: the highest of a person's roles. */
export const highestRole = (roles: Role[]): Role => ROLES.find((r) => roles.includes(r)) ?? 'ASSISTANT';
export interface Owner {
  id: string; full_name: string; phone: string; whatsapp: string | null; email: string | null; address: string | null;
  national_id: string | null; notes: string | null; status: 'ACTIVE' | 'ARCHIVED'; created_at: string;
  /** Secret part of the owner page link (QR code); null = the owner has no page. Schema v6. */
  portal_token: string | null;
  /** Customer ID, e.g. AC-00012 (schema v16). TMP-… until the clinic server gives the real one. */
  code: string | null;
}
export interface Pet {
  id: string; owner_id: string; name: string; species: Species; breed: string | null; sex: Sex; is_neutered: number;
  date_of_birth: string | null; dob_is_estimate: number; color: string | null; microchip_no: string | null;
  photo_url: string | null; status: PetStatus; deceased_at: string | null; notes: string | null;
  /** Comma-separated ALERT_FLAGS, and free text (e.g. "penicillin"). Schema v6. */
  alert_flags: string | null; alert_note: string | null;
  recall_sent_at: string | null;
}
export interface Visit {
  id: string; pet_id: string; vet_id: string | null; visited_at: string; type: VisitType; complaint: string | null;
  weight_kg: number | null; temperature_c: number | null; diagnosis: string | null; treatment_notes: string | null;
  follow_up_at: string | null; invoice_id: string | null;
  stage: VisitStage; urgency: Urgency | null; history: string | null; heart_rate: number | null; resp_rate: number | null;
  intake_notes: string | null; intake_by: string | null; intake_at: string | null;
}
export interface Prescription {
  id: string; visit_id: string; drug: string; dose: string | null; frequency: string | null; duration_days: number | null;
  instructions: string | null;
}
export interface VaccineType { id: string; name: string; species: string; interval_days: number; is_active: number }
export interface Vaccination {
  id: string; pet_id: string; visit_id: string | null; vaccine_type_id: string; administered_at: string;
  next_due_at: string | null; batch_no: string | null; reminder_sent_at: string | null;
}
export interface Appointment {
  id: string; pet_id: string; owner_id: string; scheduled_at: string; duration_min: number; type: VisitType;
  status: ApptStatus; notes: string | null; visit_id: string | null; reminder_sent_at: string | null;
}
export interface Attachment {
  id: string; pet_id: string; visit_id: string | null; kind: AttachmentKind; file_url: string; file_name: string;
  mime_type: string | null; size_bytes: number | null; uploaded_by: string | null; created_at: string;
}
export interface PriceItem {
  id: string; name_en: string; name_ar: string; category: PriceCategory; unit_price: number; is_active: number;
  /** Stock (schema v8): count this item; warn on the dashboard at or below low_stock. */
  track_stock: number; low_stock: number | null;
}
export const STOCK_REASONS = ['RESTOCK', 'INVOICE', 'ADJUST'] as const;
export type StockReason = (typeof STOCK_REASONS)[number];
export interface StockMove {
  id: string; price_item_id: string; qty: number; reason: StockReason; invoice_id: string | null; note: string | null; user_id: string | null; at: string;
  batch_no: string | null; expires_at: string | null;
}
export type RequestKind = 'XRAY' | 'LAB';
export type RequestStatus = 'REQUESTED' | 'DONE' | 'CANCELLED';
/** An X-ray or lab request given to the owner (schema v17). items = ticked keys, comma-separated. */
export interface TestRequest {
  id: string; pet_id: string; visit_id: string | null; kind: RequestKind; items: string | null; other: string | null; notes: string | null;
  status: RequestStatus; requested_by: string | null; requested_at: string; created_at: string;
}
export interface LabResult {
  id: string; pet_id: string; visit_id: string | null; taken_at: string; panel: string | null; analyte: string; value: number | null; value_text: string | null;
  unit: string | null; ref_low: number | null; ref_high: number | null; note: string | null; user_id: string | null; created_at: string;
}
export interface Consent {
  id: string; pet_id: string; visit_id: string | null; procedure: string; anaesthesia: number; estimate: number | null; notes: string | null;
  signer_name: string; signature: string; signed_at: string; user_id: string | null; created_at: string;
}
export interface Admission {
  id: string; pet_id: string; visit_id: string | null; admitted_at: string; reason: string | null; cage: string | null; vet_id: string | null;
  status: 'IN' | 'OUT'; discharged_at: string | null; discharge_note: string | null; user_id: string | null; created_at: string;
}
export type CareTaskStatus = 'DUE' | 'DONE' | 'SKIPPED';
export interface CareTask {
  id: string; admission_id: string; task: string; due_at: string; status: CareTaskStatus; done_at: string | null; done_by: string | null; note: string | null;
}
export const EXPENSE_CATEGORIES = ['RENT', 'SALARIES', 'SUPPLIES', 'UTILITIES', 'EQUIPMENT', 'MAINTENANCE', 'MARKETING', 'OTHER'] as const;
export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];
export interface Expense {
  id: string; spent_at: string; category: ExpenseCategory; amount: number; method: PaymentMethod; payee: string | null; note: string | null;
  user_id: string | null; status: 'ACTIVE' | 'VOID'; created_at: string; updated_at: string;
}
export interface Invoice {
  id: string; owner_id: string; pet_id: string | null; visit_id: string | null; number: string; issued_at: string;
  subtotal: number; discount: number; total: number; status: InvoiceStatus; created_by: string | null; notes: string | null;
}
export interface InvoiceItem {
  id: string; invoice_id: string; price_item_id: string | null; description: string; qty: number; unit_price: number; line_total: number;
}
export interface Payment {
  id: string; invoice_id: string; amount: number; method: PaymentMethod; paid_at: string; received_by: string | null; reference: string | null;
}
export interface ClinicSettings {
  id: 1; name_en: string; name_ar: string; logo_url: string | null; phone: string | null; whatsapp: string | null;
  address: string | null; currency: string; locale_default: Locale; receipt_footer: string | null;
}

// Dose calculator and treatment templates (schema v7).
export const DRUG_UNITS = ['ml', 'tablet', 'capsule', 'mg'] as const;
export type DrugUnit = (typeof DRUG_UNITS)[number];
/** One drug in the clinic's own list. dose_mg_kg per dose; concentration = mg per ml / tablet / capsule. */
export interface Drug {
  id: string; name: string; dose_mg_kg: number; concentration: number | null; unit: DrugUnit; max_mg: number | null;
  frequency: string | null; duration_days: number | null; species: string | null; notes: string | null; is_active: number;
  stock_qty: number | null; stock_unit: string | null; low_stock: number | null;
}
export interface TemplateRx { drug: string; dose: string; frequency: string; duration_days: string; instructions: string }
export interface TreatmentTemplate {
  id: string; name: string; diagnosis: string | null; treatment_notes: string | null; prescriptions: string | null;
  is_active: number; created_by: string | null; owner_note: string | null;
}
