// Seed from DATABASE.md "Seed data". Demo records only when SEED_DEMO=1 (desktop) or in the web prototype.
import bcrypt from 'bcryptjs';
import { all, get, insert, run, tx } from './core';
import { addDays, today } from '../lib/dates';

export const DEFAULT_LOGINS = [
  { email: 'waleed@clinic.local', password: 'vet12345', role: 'VET' as const },
  { email: 'assistant@clinic.local', password: 'assist123', role: 'ASSISTANT' as const },
];

export function seedBase() {
  tx(() => {
    run(
      `INSERT INTO clinic_settings (id,name_en,name_ar,phone,whatsapp,address,currency,locale_default,receipt_footer)
       VALUES (1,?,?,?,?,?,?,?,?)`,
      ['Animal Care Clinic', 'عيادة رعاية الحيوان', '', '', '', 'EGP', 'ar', 'Thank you — شكراً لثقتكم'],
    );
    insert('users', { name: 'Dr. Waleed El-Bourgy', email: DEFAULT_LOGINS[0].email, password_hash: bcrypt.hashSync(DEFAULT_LOGINS[0].password, 10), role: 'VET', locale: 'ar' });
    insert('users', { name: 'Reception', email: DEFAULT_LOGINS[1].email, password_hash: bcrypt.hashSync(DEFAULT_LOGINS[1].password, 10), role: 'ASSISTANT', locale: 'ar' });

    // Dr. Waleed to confirm / replace at the scoping call.
    for (const [name, species, interval] of [
      ['Rabies', 'DOG,CAT', 365], ['DHPP', 'DOG', 365], ['FVRCP', 'CAT', 365], ['FeLV', 'CAT', 365],
      ['Deworming', 'DOG,CAT', 90], ['Flea/tick', 'DOG,CAT', 30],
    ] as const) insert('vaccine_types', { name, species, interval_days: interval });

    // Prices TBD — placeholders in piastres.
    for (const [en, ar, cat, price] of [
      ['Consultation', 'كشف', 'CONSULTATION', 30000], ['Vaccine administration', 'تطعيم', 'VACCINE', 45000],
      ['Deworming', 'علاج الديدان', 'MEDICATION', 15000], ['Nail trim', 'قص الأظافر', 'GROOMING', 10000],
      ['Surgery (minor)', 'جراحة صغرى', 'SURGERY', 150000], ['Surgery (major)', 'جراحة كبرى', 'SURGERY', 400000],
      ['Boarding / night', 'إقامة / ليلة', 'BOARDING', 20000], ['Medication', 'أدوية', 'MEDICATION', 0],
    ] as const) insert('price_items', { name_en: en, name_ar: ar, category: cat, unit_price: price });
  });
}

/** Demo data so every screen has something to show. Never runs on a real clinic install unless asked. */
export function seedDemo() {
  const t = today();
  const at = (dayOffset: number, h: number, m = 0) => {
    const d = new Date();
    d.setDate(d.getDate() + dayOffset);
    d.setHours(h, m, 0, 0);
    return d.toISOString();
  };
  tx(() => {
    const vetId = get<{ id: string }>("SELECT id FROM users WHERE role='VET' LIMIT 1")!.id;
    const vt = Object.fromEntries(all<{ id: string; name: string }>('SELECT id, name FROM vaccine_types').map((x) => [x.name, x.id]));

    const owner = (full_name: string, phone: string, extra: Record<string, unknown> = {}) =>
      insert('owners', { full_name, phone, whatsapp: phone, ...extra });
    const pet = (owner_id: string, name: string, species: string, extra: Record<string, unknown> = {}) =>
      insert('pets', { owner_id, name, species, ...extra });

    const o1 = owner('Mona Hassan', '01012345678', { email: 'mona@example.com', address: 'Heliopolis, Cairo' });
    const o2 = owner('Karim Adel', '01198765432', { address: 'Nasr City, Cairo' });
    const o3 = owner('سارة محمود', '01223344556', { address: 'المعادي، القاهرة' });
    const o4 = owner('Omar Farouk', '01555443322');
    const o5 = owner('هدى إبراهيم', '01066778899', { notes: 'تفضل التواصل عبر واتساب' });

    const luna = pet(o1, 'Luna', 'CAT', { breed: 'Persian', sex: 'FEMALE', is_neutered: 1, date_of_birth: addDays(t, -3 * 365 - 40), color: 'White', microchip_no: '818000001234567' });
    const max = pet(o1, 'Max', 'DOG', { breed: 'Golden Retriever', sex: 'MALE', date_of_birth: addDays(t, -5 * 365), color: 'Golden' });
    const rocky = pet(o2, 'Rocky', 'DOG', { breed: 'German Shepherd', sex: 'MALE', is_neutered: 1, date_of_birth: addDays(t, -2 * 365 - 100), color: 'Black & tan' });
    const mishmish = pet(o3, 'مشمش', 'CAT', { breed: 'بلدي', sex: 'MALE', date_of_birth: addDays(t, -400), dob_is_estimate: 1, color: 'برتقالي' });
    const kiwi = pet(o4, 'Kiwi', 'BIRD', { breed: 'Budgerigar', sex: 'UNKNOWN', color: 'Green' });
    const bondo = pet(o5, 'بندق', 'RABBIT', { sex: 'FEMALE', date_of_birth: addDays(t, -300) });
    pet(o2, 'Bella', 'DOG', { breed: 'Labrador', sex: 'FEMALE', status: 'DECEASED', deceased_at: addDays(t, -200) });

    const visit = (pet_id: string, daysAgo: number, type: string, extra: Record<string, unknown>) =>
      insert('visits', { pet_id, vet_id: vetId, visited_at: at(-daysAgo, 11), type, ...extra });
    const vacc = (pet_id: string, visit_id: string, type: string, daysAgo: number, interval: number) =>
      insert('vaccinations', { pet_id, visit_id, vaccine_type_id: vt[type], administered_at: addDays(t, -daysAgo), next_due_at: addDays(t, -daysAgo + interval), batch_no: `B-${1000 + daysAgo}` });

    // Luna: 4 visits for a weight chart; rabies due in 3 days.
    visit(luna, 540, 'CHECKUP', { weight_kg: 3.1, temperature_c: 38.4, complaint: 'Annual check', diagnosis: 'Healthy' });
    const lv2 = visit(luna, 362, 'VACCINATION', { weight_kg: 3.6, temperature_c: 38.6, diagnosis: 'Healthy, vaccinated' });
    vacc(luna, lv2, 'Rabies', 362, 365);
    vacc(luna, lv2, 'FVRCP', 362, 365);
    const lv3 = visit(luna, 150, 'EMERGENCY', { weight_kg: 3.9, temperature_c: 39.8, complaint: 'Vomiting since yesterday', diagnosis: 'Gastritis', treatment_notes: 'IV fluids, antiemetic', follow_up_at: at(-147, 12) });
    insert('prescriptions', { visit_id: lv3, drug: 'Metoclopramide', dose: '0.5 ml', frequency: 'Twice daily', duration_days: 5, instructions: 'Before food' });
    insert('prescriptions', { visit_id: lv3, drug: 'Probiotic paste', dose: '1 g', frequency: 'Once daily', duration_days: 7 });
    visit(luna, 30, 'CHECKUP', { weight_kg: 4.2, temperature_c: 38.5, complaint: 'Weight check', diagnosis: 'Good recovery' });

    const mv = visit(max, 90, 'VACCINATION', { weight_kg: 31.5, temperature_c: 38.7 });
    vacc(max, mv, 'Deworming', 88, 90); // due in 2 days
    vacc(max, mv, 'DHPP', 90, 365);
    visit(max, 400, 'CHECKUP', { weight_kg: 30.2 });
    visit(max, 200, 'FOLLOW_UP', { weight_kg: 32.0, diagnosis: 'Mild arthritis' });

    const rv = visit(rocky, 33, 'VACCINATION', { weight_kg: 34, temperature_c: 38.3 });
    vacc(rocky, rv, 'Flea/tick', 33, 30); // overdue by 3 days
    const mm = visit(mishmish, 360, 'VACCINATION', { weight_kg: 4.5 });
    vacc(mishmish, mm, 'Rabies', 360, 365); // due in 5 days
    visit(bondo, 20, 'CHECKUP', { weight_kg: 1.8, complaint: 'فحص دوري' });

    // Today's and this week's appointments.
    const appt = (pet_id: string, owner_id: string, scheduled_at: string, type: string, extra: Record<string, unknown> = {}) =>
      insert('appointments', { pet_id, owner_id, scheduled_at, type, duration_min: 20, status: 'SCHEDULED', ...extra });
    appt(luna, o1, at(0, 10, 0), 'VACCINATION', { notes: 'Rabies booster' });
    appt(rocky, o2, at(0, 11, 30), 'CHECKUP', { status: 'DONE' });
    appt(mishmish, o3, at(0, 13, 0), 'VACCINATION');
    appt(kiwi, o4, at(0, 17, 20), 'CHECKUP', { notes: 'Beak trim' });
    appt(max, o1, at(1, 12, 0), 'FOLLOW_UP');
    appt(bondo, o5, at(2, 16, 0), 'CHECKUP');
    appt(rocky, o2, at(3, 18, 40), 'SURGERY', { duration_min: 60, notes: 'Lump removal' });

    // Invoices: one paid, one partial, one unpaid.
    const inv = (n: number, owner_id: string, pet_id: string, visit_id: string | null, items: [string, number, number][], paid: number, daysAgo: number) => {
      const subtotal = items.reduce((s, [, q, p]) => s + q * p, 0);
      const status = paid >= subtotal ? 'PAID' : paid > 0 ? 'PARTIAL' : 'UNPAID';
      const id = insert('invoices', {
        owner_id, pet_id, visit_id, number: `INV-${new Date().getFullYear()}-${String(n).padStart(4, '0')}`,
        issued_at: at(-daysAgo, 12), subtotal, discount: 0, total: subtotal, status, created_by: vetId,
      });
      items.forEach(([d, q, p]) => insert('invoice_items', { invoice_id: id, description: d, qty: q, unit_price: p, line_total: q * p }));
      if (paid) insert('payments', { invoice_id: id, amount: paid, method: 'CASH', paid_at: at(-daysAgo, 12, 30), received_by: vetId });
      if (visit_id) run('UPDATE visits SET invoice_id = ? WHERE id = ?', [id, visit_id]);
    };
    inv(1, o1, luna, lv3, [['Consultation', 1, 30000], ['IV fluids', 1, 25000], ['Medication', 2, 8500]], 72000, 150);
    inv(2, o2, rocky, rv, [['Consultation', 1, 30000], ['Flea/tick treatment', 1, 35000]], 30000, 33);
    inv(3, o3, mishmish, mm, [['Vaccine administration', 1, 45000]], 0, 10);
  });
}
