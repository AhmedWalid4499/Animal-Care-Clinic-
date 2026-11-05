# Cloud sync and notifications test (Phases 1 and 3)

Run 2026-11-05 10:30 UTC by `scripts/sync-test.mjs`: local Postgres 16, the clinic server, two desktop apps, a fake push service for a phone. 18/18 passed.

| Check | Result | Evidence |
|---|---|---|
| Server and devices sync the same tables | Pass | 15 tables |
| The first laptop (Admin) uploads its records to an empty clinic | Pass | server now holds 5 owners, 7 pets; default demo logins left active on the server: 0 |
| A second laptop signing in gets all of the clinic’s records | Pass | laptop B shows 5 owners (laptop A has 5) |
| A change on one laptop appears on the other within 2 s | Pass | new owner visible on laptop B after 568 ms |
| And back the other way | Pass | visible on laptop A after 575 ms |
| The Admin adds a Doctor and an Assistant; both reach the server | Pass | users on server: 4 |
| A Doctor can sign in on another laptop, record visits, and has no Settings | Pass | New visit button: yes; Settings in menu: no |
| The server refuses what an Assistant may not do, and allows the WhatsApp reminder | Pass | refused: visits: doctors and admins only; owners: archiving is for admins; users: admins only; owners: records are archived, never deleted — reminder stamp accepted: true |
| An invoice gets its real number from the server, with no duplicates | Pass | new invoice shows INV-2026-0004; duplicate numbers on the server: 0 |
| An assistant books an appointment: the doctor and the admin are notified at once, the assistant is not | Pass | doctor's bell after 96 ms: "Reception حجز موعداً لـ Max (Mona Hassan) يوم الجمعة، 6 نوفمبر 10:00 ص"; admin's bell: yes; assistant notified about own booking: 0 |
| The same booking is pushed to the doctor’s phone even with the app closed (encrypted, signed); dead phones are forgotten | Pass | push decrypted on the "phone": موعد — "Reception حجز موعداً لـ Max (Mona Hassan) يوم الجمعة، 6 نوفمبر، 12:00 م" → /#/appointments?view=day&date=2026-11-06&open=d95005f7-3835-4899-ab7e-4445d3151b28; signed: true; uninstalled phone removed: yes |
| Closing the window keeps the app in the tray; a change still raises a system notification that opens the appointment | Pass | after X: 1 window, visible=false; system notification: موعد — "Reception غيّر موعد Max إلى الجمعة، 6 نوفمبر 11:00 ص"; clicked → window visible=true, #/appointments?view=day&date=2026-11-06, appointment open: true |
| Two people edit the same field: the latest edit wins and the others are told whose change replaced theirs | Pass | kept: "Fasting from midnight"; assistant told: replaced by Admin; doctor told: kept (Admin) |
| Each person chooses what to be notified about; switching one off stops only that kind, and only for them | Pass | assistant turned payments off (accepted) and could not make themself Admin (admins only); doctor turned visits off from the bell: saved; payment notified to assistant: 0, to doctor: 1 |
| A visit recorded for a pet booked today tells the front desk; other visits do not | Pass | assistant notified about visits for: Max (booked today: Max, walk-in: بندق) |
| “Mark all read” clears the count, on every device of that person | Pass | bell count now 0; server unread for the doctor: 0 |
| A change made with the server unreachable syncs when it comes back | Pass | while offline laptop A showed "غير متصل · 2 تغيير في الانتظار"; laptop B received the owner 2 s after the server came back |
| After restarting, the laptop is still signed in to its clinic server and keeps everyone’s records | Pass | signed in again automatically as Admin, synced; owners: 8; after Sign out the sign-in screen shows server 127.0.0.1:8788 |
