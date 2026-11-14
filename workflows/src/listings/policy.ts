export const LISTING_SHEET_ID = '1GvI8qnb5ZKCgtshRJsPBrpmIuKd6M-gi8mMeEMkGH50';
export const POLICY_TIME_ZONE = 'Asia/Colombo';
const COLOMBO_OFFSET_MS = 330 * 60_000;
/** Preserve Colombo wall-clock time, clamp month-end, store/return UTC. */
export function calendarMonthExpiry(start: string): string {
  const instant = Date.parse(start); if (!Number.isFinite(instant)) throw new Error('INVALID_DATE');
  const local = new Date(instant + COLOMBO_OFFSET_MS);
  const year = local.getUTCFullYear(), nextMonth = local.getUTCMonth() + 1;
  const day = Math.min(local.getUTCDate(), new Date(Date.UTC(year,nextMonth+1,0)).getUTCDate());
  return new Date(Date.UTC(year,nextMonth,day,local.getUTCHours(),local.getUTCMinutes(),local.getUTCSeconds(),local.getUTCMilliseconds())-COLOMBO_OFFSET_MS).toISOString();
}
export function sheetDate(instant: string | null | undefined): number | '' {
  if (!instant) return ''; const ms = Date.parse(instant); if (!Number.isFinite(ms)) throw new Error('INVALID_DATE');
  return (ms + COLOMBO_OFFSET_MS) / 86_400_000 + 25569;
}
export function publiclyAvailable(row: {status:string;synthetic?:boolean;expires_at?:string|null}, now=Date.now()): boolean {
  return row.status==='published' && row.synthetic!==true && !!row.expires_at && Date.parse(row.expires_at)>now;
}
export function stableJson(value: unknown): string {
  if (Array.isArray(value)) return '['+value.map(stableJson).join(',')+']';
  if (value && typeof value==='object') return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+stableJson((value as Record<string,unknown>)[k])).join(',')+'}';
  return JSON.stringify(value) ?? 'null';
}
export async function fingerprint(value: unknown): Promise<string> {
  const hash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(stableJson(value)));
  return [...new Uint8Array(hash)].map(b=>b.toString(16).padStart(2,'0')).join('');
}
export const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
