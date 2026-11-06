// Tables the clinic server stores and syncs. Must equal SYNC_TABLES in src/db/schema.ts
// (scripts/sync-test.mjs checks this). attachment_blobs (file bytes) are not synced in Phase 1.
export const SYNC_TABLES = [
  'clinic_settings', 'users', 'owners', 'pets', 'visits', 'prescriptions', 'vaccine_types', 'vaccinations',
  'appointments', 'attachments', 'price_items', 'invoices', 'invoice_items', 'payments', 'drugs', 'treatment_templates', 'audit_log',
];

/** Only these may be hard-deleted, and only as part of editing their visit / invoice (CLAUDE.md data rules). */
export const DELETABLE = new Set(['prescriptions', 'invoice_items']);
