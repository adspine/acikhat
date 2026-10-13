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

const DIGIT_WORDS = ["sıfır", "bir", "iki", "üç", "dört", "beş", "altı", "yedi", "sekiz", "dokuz"];

/**
 * Telefonda geri okumak için rakam rakam: "0532 015 10 95" → "sıfır beş üç iki, sıfır bir beş, bir sıfır, dokuz beş".
 * Model rakamları kendisi okuyunca "otuz iki, on beş" gibi sayılara çeviriyordu; metin sunucudan hazır gelir.
 */
export function spelledPhone(e164: string): string {
  const words = (s: string) => [...s].map((d) => DIGIT_WORDS[Number(d)]).join(" ");
  return spokenPhone(e164).split(" ").map(words).join(", ");
}

/** Telefonda geri okumak için: "0532 111 22 33" */
export function spokenPhone(e164: string): string {
  const d = e164.replace(/^\+90/, "");
  return `0${d.slice(0, 3)} ${d.slice(3, 6)} ${d.slice(6, 8)} ${d.slice(8, 10)}`;
}
