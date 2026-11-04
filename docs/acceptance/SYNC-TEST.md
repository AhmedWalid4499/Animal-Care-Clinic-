# Cloud sync test (Phase 1)

Run 2026-11-04 12:23 UTC by `scripts/sync-test.mjs`: local Postgres 16, the clinic server, two desktop apps. 11/11 passed.

| Check | Result | Evidence |
|---|---|---|
| Server and devices sync the same tables | Pass | 15 tables |
| The first laptop (Admin) uploads its records to an empty clinic | Pass | server now holds 5 owners, 7 pets; default demo logins left active on the server: 0 |
| A second laptop signing in gets all of the clinic’s records | Pass | laptop B shows 5 owners (laptop A has 5) |
| A change on one laptop appears on the other within 2 s | Pass | new owner visible on laptop B after 557 ms |
| And back the other way | Pass | visible on laptop A after 574 ms |
| The Admin adds a Doctor and an Assistant; both reach the server | Pass | users on server: 4 |
| A Doctor can sign in on another laptop, record visits, and has no Settings | Pass | New visit button: yes; Settings in menu: no |
| The server refuses what an Assistant may not do, and allows the WhatsApp reminder | Pass | refused: visits: doctors and admins only; owners: archiving is for admins; users: admins only; owners: records are archived, never deleted — reminder stamp accepted: true |
| An invoice gets its real number from the server, with no duplicates | Pass | new invoice shows INV-2026-0004; duplicate numbers on the server: 0 |
| A change made with the server unreachable syncs when it comes back | Pass | while offline laptop A showed "غير متصل · 2 تغيير في الانتظار"; laptop B received the owner 2 s after the server came back |
| After restarting, the laptop remembers its clinic server and keeps everyone’s records | Pass | server shown on sign-in: 127.0.0.1:8788; owners: 8 |
