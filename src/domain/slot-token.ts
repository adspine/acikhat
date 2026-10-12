import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * LLM'e verilen slot_id: içeriği + HMAC imzası.
 * book_appointment yalnızca check_availability'nin ürettiği id'leri kabul eder,
 * böylece model saat, terapist veya oda uyduramaz.
 */
export interface SlotClaim {
  tenantId: string;
  serviceId: string;
  staffId: string;
  roomId: string;
  startMs: number;
}

const sign = (key: string, body: string) => createHmac("sha256", key).update(body).digest("base64url").slice(0, 22);

export function encodeSlotId(claim: SlotClaim, key: string): string {
  const body = Buffer.from(
    JSON.stringify([claim.tenantId, claim.serviceId, claim.staffId, claim.roomId, claim.startMs]),
  ).toString("base64url");
  return `${body}.${sign(key, body)}`;
}

export function decodeSlotId(id: string, key: string): SlotClaim | null {
  const [body, mac] = id.split(".");
  if (!body || !mac) return null;
  const expected = Buffer.from(sign(key, body));
  const given = Buffer.from(mac);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  try {
    const [tenantId, serviceId, staffId, roomId, startMs] = JSON.parse(Buffer.from(body, "base64url").toString());
    if (typeof startMs !== "number") return null;
    return { tenantId, serviceId, staffId, roomId, startMs };
  } catch {
    return null;
  }
}
