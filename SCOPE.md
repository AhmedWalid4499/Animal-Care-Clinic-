# Fixed Scope — [CLINIC NAME] Patient Tracker

| | |
|---|---|
| **Client** | Dr. Waleed El-Bourgy — [title / affiliation, fill from ResearchGate] — [CLINIC NAME], [city] |
| **Provider** | [BUSINESS NAME] (Ahmed "Yuto" El-Bourgy) |
| **Package** | **Build** — web app / MVP: auth & roles, database, admin, ≤ 8 screens, 1 integration |
| **Delivery** | 3 weeks from scope sign-off |
| **Fixed price** | Build package value 45,000 EGP — **waived (family / portfolio project)**. Delivered under the standard process so it can serve as the first public case study. |
| **Scope version** | v1.0 — 3 Nov 2026 |
| **Status** | Draft — awaiting Dr. Waleed's review and sign-off |

> Signed before the first line of code. Anything not listed under *In scope* is a change request, priced from the add-on list.

---

## 1. Why this project exists

The clinic keeps owner and pet records on paper and in memory. When an owner walks in, the vet needs the pet's history (visits, vaccinations, weight, medications) in seconds, and the clinic needs to know which vaccinations are due so owners can be reminded. The app replaces the paper card with one searchable record per pet, grouped under its owner.

**Success looks like:** on launch day, every active owner and pet is in the system, a visit can be recorded in under two minutes on a phone or laptop, and the dashboard shows today's appointments and this week's due vaccinations.

## 2. Users and roles

| Role | Who | Can |
|---|---|---|
| **Vet** (admin) | Dr. Waleed | Everything: records, visits, invoices, users, settings |
| **Assistant** | Reception / nurse | Owners, pets, appointments, invoices; read visits; cannot delete or change settings |

One clinic, one database. No owner-facing login in v1 (owners are *records*, not users).

## 3. Core rule of the data model

- An **owner** (the person Dr. Waleed calls the "patient") can have **many pets**.
- A **pet** belongs to **exactly one owner**. Transfer of ownership = edit the pet's owner (history stays with the pet).
- Every clinical fact (visit, vaccination, prescription, weight, file) is attached to the **pet**, never the owner.
- Money (appointments, invoices) is attached to the **owner**, with a link to the pet/visit it was for.

Full schema: `DATABASE.md` and `prisma/schema.prisma`.

## 4. In scope — the 8 screens

| # | Screen | What it does | Done when |
|---|---|---|---|
| 1 | **Dashboard** | Today's appointments; vaccinations due in the next 7 days; quick search (owner name, phone, pet name); "New visit" button | Loads in < 1 s with 500 pets; search returns on 3rd keystroke |
| 2 | **Owners** | List with search and filter; add / edit owner (name, phone, WhatsApp, email, address, notes); tap-to-call and tap-to-WhatsApp | Duplicate phone warning on save |
| 3 | **Owner detail** | Owner card + their pets + their open invoices; add a pet from here | Shows all pets incl. deceased (greyed) |
| 4 | **Pet record** | Pet card (species, breed, sex, neutered, DOB/age, colour, microchip, photo, status); tabs: **Timeline** (visits), **Vaccinations**, **Weight chart**, **Files**; print/PDF summary | Timeline is newest-first; weight chart from visit weights |
| 5 | **New / edit visit** | Date, type (check-up, vaccination, surgery, emergency, follow-up, other), complaint, weight, temperature, diagnosis, treatment notes, prescriptions (drug, dose, frequency, days), vaccination given (with next-due date), follow-up date, vet | Saves offline-tolerant draft; auto-creates vaccination record and follow-up appointment |
| 6 | **Appointments** | Day / week calendar; create, reschedule, mark done / no-show; links to pet | No double-booking warning; done → opens New visit |
| 7 | **Invoices** | Create invoice per visit or standalone; line items from a price list (consultation, vaccine, surgery, boarding, medication, other); status unpaid / partial / paid; cash / InstaPay / card; print A5 receipt | Totals in EGP; owner balance shown on owner detail |
| 8 | **Settings & users** | Clinic name/logo/phone/address; price list; vaccine catalogue (name, species, interval); users & roles; backup export (CSV/Excel of all tables) | Export downloads in one click |

Plus login (not counted as a screen).

### Included integration (1 of 1)
**WhatsApp click-to-chat with pre-filled message** — from an owner, pet, appointment or due-vaccination row, one tap opens WhatsApp with a ready message in Arabic or English ("Reminder: Luna's rabies vaccine is due on 12 Nov. Reply to book."). No WhatsApp Business API, no automatic sending (see §6).

### Also included (every Build package)
- Arabic + English interface (RTL tested), Plex Sans Arabic
- Works on phone, tablet and laptop (responsive PWA, installable on the clinic phone)
- Scoping call · this written scope · clickable prototype · weekly progress note · recorded handover session · 30-day fix window
- Dr. Waleed owns the code, hosting account, domain and data
- Initial data load: a spreadsheet template for owners/pets; one import run of the filled sheet

## 5. Out of scope (v1)

| Not included | Where it goes |
|---|---|
| Owner-facing portal or booking app | v2 (uses the same database) |
| Automatic WhatsApp / SMS sending (Business API) | Add-on: integration from 5,000 EGP |
| Inventory / pharmacy stock | v2 |
| Multi-branch, multiple clinics | v2 |
| Lab-result parsing, X-ray viewer (files are stored and opened, not interpreted) | v2 |
| Accounting, VAT reports, e-invoicing | out — export to Excel instead |
| Payment gateway inside the app | out — payment recorded manually |
| Native iOS/Android apps | out — PWA covers the clinic phone |

## 6. How the project runs

| Milestone | Date | What Dr. Waleed does |
|---|---|---|
| Scoping call | Thu 6 Nov 2026 | 30 min: walk through this document, correct the species/vaccine lists, pick clinic colour |
| **Scope sign-off** | Sat 8 Nov | Reply "approved" (WhatsApp is fine) |
| **Prototype approval** | Thu 13 Nov | Click through the prototype link, say what is wrong |
| Weekly progress note | every Saturday | Read one paragraph |
| Data sheet returned | Sat 22 Nov | Fill the owners/pets spreadsheet |
| **Handover** | Sat 29 Nov | 45-min recorded session: login, first real visit, export |
| Fix window ends | Mon 29 Dec 2026 | Report anything broken; fixed free |
| Care plan starts (optional) | Jan 2027 | 2,500 EGP/month — updates, backup checks, ≤ 2 h changes |

Tools: Claude Code for build, Railway for hosting (Postgres + app), GitHub for code, WhatsApp for all communication, one shared folder for the data sheet and photos.

## 7. Acceptance criteria (handover checklist)

1. Both roles can log in; assistant cannot reach Settings or delete records.
2. Owner → pets → visit chain works end to end on a phone in Arabic and on a laptop in English.
3. A vaccination recorded in a visit appears on the dashboard when due and opens a pre-filled WhatsApp message.
4. Weight chart plots at least 3 points for a test pet.
5. Invoice totals, partial payment and A5 receipt print correctly.
6. Export produces one CSV/Excel per table with all data.
7. Nightly database backup on Railway is on and a restore was tested once.
8. Lighthouse PWA install works on the clinic Android phone.
9. Imported data sheet matches the spreadsheet row count.
10. Handover recording and a one-page "how to" (AR/EN) delivered.

## 8. Assumptions and constraints

- One clinic, one vet, ≤ 2 assistants, < 5,000 pets in year one.
- Clinic has a smartphone with WhatsApp and a laptop/tablet with Chrome; internet available during consultations.
- Dr. Waleed provides: clinic name, logo (or we use text), species list, vaccine protocols with intervals, price list, 5–10 sample records for testing.
- Data stays on a Railway region in the EU; no patient data leaves the clinic account. Logins are personal; no shared password.
- Build time: 10–15 h/week evenings and weekends; dates above already reflect that.

## 9. Risks

| Risk | Impact | Response |
|---|---|---|
| Vaccine protocols differ by species and age → complex scheduling | Scope creep | v1 uses a simple catalogue: vaccine → species → interval in days; the vet edits next-due manually when needed |
| Data entry too slow during consultations | App unused | Prototype reviewed on the clinic phone before build; minimum fields = pet + date + type |
| Paper records never imported | Launch with empty app | Spreadsheet template given at sign-off; import is a milestone |
| Family project, no deposit → drifts | No handover | Same milestones and weekly notes as a paying client; this is the first case study |

## 10. Change requests

Anything outside §4 is estimated from the add-on list (revision round 1,500 EGP · extra screen 1,500 EGP · integration from 5,000 EGP · training hour 750 EGP · rush +50 %) and starts only after written approval. For this project, add-ons are quoted at list price so the case study reflects real numbers, then waived at Dr. Waleed's discretion.

## 11. Sign-off

| | Name | Date | Signature |
|---|---|---|---|
| Client | Dr. Waleed El-Bourgy | | |
| Provider | Ahmed El-Bourgy — [BUSINESS NAME] | | |
