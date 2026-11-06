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
}
export interface Owner {
  id: string; full_name: string; phone: string; whatsapp: string | null; email: string | null; address: string | null;
  national_id: string | null; notes: string | null; status: 'ACTIVE' | 'ARCHIVED'; created_at: string;
}
export interface Pet {
  id: string; owner_id: string; name: string; species: Species; breed: string | null; sex: Sex; is_neutered: number;
  date_of_birth: string | null; dob_is_estimate: number; color: string | null; microchip_no: string | null;
  photo_url: string | null; status: PetStatus; deceased_at: string | null; notes: string | null;
  /** Comma-separated ALERT_FLAGS, and free text (e.g. "penicillin"). Schema v6. */
  alert_flags: string | null; alert_note: string | null;
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
export interface PriceItem { id: string; name_en: string; name_ar: string; category: PriceCategory; unit_price: number; is_active: number }
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
