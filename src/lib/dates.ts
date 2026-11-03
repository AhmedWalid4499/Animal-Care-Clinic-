// Date helpers. Clinical dates (vaccinations, DOB) are stored as local 'YYYY-MM-DD';
// moments (visits, appointments, payments) as ISO-8601 UTC. The clinic PC runs on Africa/Cairo time.
const pad = (n: number) => String(n).padStart(2, '0');

export function toDateStr(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
export function today(): string {
  return toDateStr(new Date());
}
export function parseDateStr(s: string): Date {
  const [y, m, d] = s.slice(0, 10).split('-').map(Number);
  return new Date(y, m - 1, d);
}
export function addDays(s: string, n: number): string {
  const d = parseDateStr(s);
  d.setDate(d.getDate() + n);
  return toDateStr(d);
}
export function daysBetween(a: string, b: string): number {
  return Math.round((parseDateStr(b).getTime() - parseDateStr(a).getTime()) / 86_400_000);
}
/** Local date of an ISO moment. */
export function localDateOf(iso: string): string {
  return toDateStr(new Date(iso));
}
/** Value for <input type="datetime-local"> from an ISO moment. */
export function toLocalInput(iso: string): string {
  const d = new Date(iso);
  return `${toDateStr(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
export function fromLocalInput(v: string): string {
  return new Date(v).toISOString();
}
export function nowLocalInput(): string {
  return toLocalInput(new Date().toISOString());
}
export function startOfDayIso(dateStr: string): string {
  return parseDateStr(dateStr).toISOString();
}
export function startOfWeek(dateStr: string): string {
  // Egyptian week starts Saturday.
  const d = parseDateStr(dateStr);
  const diff = (d.getDay() + 1) % 7;
  d.setDate(d.getDate() - diff);
  return toDateStr(d);
}
/** Age in years/months from DOB. */
export function ageParts(dob: string, at = today()): { years: number; months: number } {
  const a = parseDateStr(dob);
  const b = parseDateStr(at);
  let months = (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth());
  if (b.getDate() < a.getDate()) months--;
  months = Math.max(0, months);
  return { years: Math.floor(months / 12), months: months % 12 };
}
