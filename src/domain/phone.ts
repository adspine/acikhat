/**
 * Türkiye numaralarını E.164'e çevirir. Geçersizse null.
 * Kabul: "0532 111 22 33", "532-111-2233", "+90 532 111 22 33", "905321112233"
 */
export function normalizeTrPhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let digits = raw.replace(/\D/g, "");
  if (digits.startsWith("0090")) digits = digits.slice(4);
  else if (digits.startsWith("90") && digits.length === 12) digits = digits.slice(2);
  else if (digits.startsWith("0") && digits.length === 11) digits = digits.slice(1);
  if (digits.length !== 10 || digits.startsWith("0")) return null;
  return `+90${digits}`;
}

/** SMS yalnızca cep numarasına gider (5xx) */
export function isTrMobile(e164: string): boolean {
  return /^\+905\d{9}$/.test(e164);
}

/** Telefonda geri okumak için: "0532 111 22 33" */
export function spokenPhone(e164: string): string {
  const d = e164.replace(/^\+90/, "");
  return `0${d.slice(0, 3)} ${d.slice(3, 6)} ${d.slice(6, 8)} ${d.slice(8, 10)}`;
}
