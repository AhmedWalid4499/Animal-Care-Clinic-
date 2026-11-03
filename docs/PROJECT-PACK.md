# [CLINIC NAME] Patient Tracker — project pack v1 (3 Nov 2026)

Drop this folder into the new repo root and open it in Claude Code.

| File | For | Use |
|---|---|---|
| `SCOPE.md` | Dr. Waleed + you | The fixed scope: screens, done-criteria, milestones, out-of-scope, sign-off. Share the `.docx` version with him. |
| `DATABASE.md` | you + Claude Code | Schema v1 in plain tables, rules, indexes, seed data. |
| `prisma/schema.prisma` | Claude Code | Ready to `npx prisma migrate dev --name init`. |
| `CLAUDE.md` | Claude Code | Stack, routes, data rules, working agreement, open items. |
| `import/TEMPLATE.md` | Dr. Waleed's assistant | Columns for the owners/pets spreadsheet. |

First Claude Code prompt:
```
Read CLAUDE.md, SCOPE.md and DATABASE.md. Scaffold the Next.js 15 + Prisma + next-intl project described there, run the initial migration against DATABASE_URL, write prisma/seed.ts from DATABASE.md, and stop at a running /login and empty /. Do not build screens 1–8 yet.
```
