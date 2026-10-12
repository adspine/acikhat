/**
 * Hizmet verdiğimiz sektörler. Kurulum formu sektöre göre farklı sorular sorar (web/sectors.js);
 * burada yalnızca kimlikler tutulur ki sunucu formu doğrulayabilsin.
 * Her sektörün ajan şablonu agent/verticals/<id> altındadır (spa dışındakilerin test senaryoları henüz yazılmadı).
 */
export const SECTOR_IDS = ["spa", "guzellik", "saglik", "emlak", "otel", "restoran", "fitness", "servis", "danismanlik", "diger"] as const;
export type SectorId = (typeof SECTOR_IDS)[number];
