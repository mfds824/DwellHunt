// Agent passwords: checked and stretched in the browser, so the plain password never leaves the device.
const COMMON = new Set(['password', 'passw0rd', 'qwerty', 'qwertyuiop', 'abcdefghij', 'letmein', 'welcome', 'iloveyou',
  'dwellhunt', 'admin', 'srilanka', 'colombo', 'property', 'agent']);
const lower = email => String(email || '').trim().toLowerCase();
/** '' when the password is good enough, otherwise a message to show. */
export function passwordProblem(password, email) {
  const p = String(password || '').normalize('NFKC');
  if ([...p].length < 10) return 'Use at least 10 characters.';
  if (p.length > 128) return 'Use 128 characters or fewer.';
  const low = p.toLowerCase(), word = low.replace(/[^a-z0-9]/g, '').replace(/^\d+|\d+$/g, '');
  // A common word or the email name with only digits or symbols around it, few distinct characters, or a digit run.
  if (COMMON.has(word) || new Set(low).size < 4 || '01234567890123456789'.includes(low) || '98765432109876543210'.includes(low) ||
      low === lower(email) || word === lower(email).split('@')[0]) return 'That password is too easy to guess. Try three unrelated words.';
  return '';
}
/** 64 hex characters sent to DwellHunt instead of the password. */
export async function passwordKey(password, email) {
  const enc = new TextEncoder();
  const base = await crypto.subtle.importKey('raw', enc.encode(String(password).normalize('NFKC')), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: enc.encode('dwellhunt-agent|' + lower(email)), iterations: 310000 }, base, 256);
  return [...new Uint8Array(bits)].map(b => b.toString(16).padStart(2, '0')).join('');
}
