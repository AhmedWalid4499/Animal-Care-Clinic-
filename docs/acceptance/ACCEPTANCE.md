# Acceptance run

Run 2026-11-03 19:14 UTC by `scripts/acceptance.mjs` against the desktop build (Electron on Linux, same code as the Windows exe). 13/13 checks passed.

| Check | Scope reference | Result | Evidence |
|---|---|---|---|
| Test database at the scope size (screen 1: 500 pets) | size | Pass | 500 pets, 305 owners, 1982 visits, 499 vaccinations, 250 invoices, 27 appointments |
| Dashboard loads in under 1 s with 500 pets | S1-load | Pass | sign-in → dashboard 194 ms (includes password check); dashboard re-open 56 / 52 / 57 ms; 173 due-vaccination rows on screen |
| Quick search returns on the 3rd keystroke | S1-search | Pass | "Moh" 17 ms, 16 hits; "Lun" 18 ms, 16 hits; "011" 43 ms, 16 hits; "مشم" 28 ms, 16 hits |
| Excel export in one click: one sheet per table, every row | S8-export-xlsx | Pass | clinic-export-2026-11-03.xlsx written with no dialog; 15 sheets; row counts match the database for all 15 tables |
| CSV export in one click: one file per table | S7.6-export-csv | Pass | clinic-export-2026-11-03-csv.zip holds 15 CSV files; row counts match |
| Backup restore tested once | S7.7-restore | Pass | owners: backup 305 → after adding one 306 → after restore 305; the added owner is gone from the list |
| Spreadsheet template matches import/TEMPLATE.md | S4-template | Pass | 16 columns |
| Imported data matches the spreadsheet row count | S7.9-import | Pass | 73 sheet rows = 61 pets + 10 owner-only rows + 2 skipped rows (reported by row number); 41 new owners, 1 row merged into an existing owner by phone. App said: "Imported 41 owners and 61 pets. Skipped 2 rows." |
| A5 receipt prints on one A5 page | S7.5-receipt | Pass | receipt-A5.pdf: 1 page, 420×595 pt (A5 = 420×595 pt) |
| Pet summary prints / saves as PDF | S4-summary | Pass | pet-summary-A5.pdf: 1 page(s), 420×595 pt |
| Arabic right-to-left on every screen, laptop and phone width | RTL | Pass | 25 screens × 2 widths: dir=rtl, Arabic labels, no sideways scrolling (screenshots in rtl/) |
| Data survives closing and reopening the app | persist | Pass | 346 owners / 561 pets / 250 invoices before and after |
| Automatic daily backup copy exists | S7.7-daily | Pass | clinic-2026-11-03.sqlite in data\backups (taken when the app is first opened each day; last 14 kept) |

Evidence files beside this report: `receipt-A5.pdf`, `pet-summary-A5.pdf`, `rtl/` (Arabic screens at laptop and phone width), `acceptance.json`. Re-run with `npm run acceptance`.

## Not covered by this run

| SCOPE §7 item | Why |
|---|---|
| 2. Owner → pet → visit on a phone in Arabic | The Windows app does not run on a phone. The phone-width layout is checked above, but there is no phone install. Platform decision pending with Dr. Waleed. |
| 7. Nightly backup | The copy is taken when the app is first opened each day and stays on the same PC. Weekly copy to USB / Google Drive is in the how-to. |
| 8. Installs on the clinic Android phone | Same platform decision as item 2. |
| 5. Receipt on paper | Checked as an A5 PDF; needs one print on the clinic printer at handover. |
| 3. WhatsApp message actually sent | The button opens `wa.me` with the message; sending is done by staff in WhatsApp (by design, §4). |
| 10. Handover recording | Recorded at the 29 Nov session. The one-page how-to is in `docs/how-to/`. |
