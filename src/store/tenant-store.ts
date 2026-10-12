import type { DatabaseSync } from "node:sqlite";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { TenantSchema, type Tenant } from "../domain/tenant.ts";

/**
 * Firma ayarlarının kalıcı kaydı.
 * - config_live: asistanın ve araçların kullandığı, yayınlanmış ayar
 * - config_draft: panelde düzenlenip henüz yayınlanmamış ayar (yoksa null)
 * Yayınlama doğrulanmış ayarla yapılır; taslak serbest biçimde saklanır (yarım düzenleme kaybolmasın).
 */
export class TenantStore {
  private readonly db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this.db = db;
  }

  /** tenants/*.json içinden veritabanında olmayan firmaları ekler (var olanlara dokunmaz) */
  seedFromDir(dir: string): string[] {
    const added: string[] = [];
    for (const f of readdirSync(dir).filter((x) => x.endsWith(".json"))) {
      const parsed = TenantSchema.safeParse(JSON.parse(readFileSync(join(dir, f), "utf8")));
      if (!parsed.success) {
        console.warn(`[tenants] ${f} geçersiz, içeri alınmadı:\n${parsed.error.message}`);
        continue;
      }
      const res = this.db
        .prepare("INSERT OR IGNORE INTO tenants (id, config_live, updated_at, published_at) VALUES (?, ?, ?, ?)")
        .run(parsed.data.id, JSON.stringify(parsed.data), Date.now(), Date.now());
      if (res.changes) added.push(parsed.data.id);
    }
    return added;
  }

  loadLive(): Tenant[] {
    const rows = this.db.prepare("SELECT id, config_live FROM tenants").all() as { id: string; config_live: string }[];
    return rows.flatMap((r) => {
      const parsed = TenantSchema.safeParse(JSON.parse(r.config_live));
      if (parsed.success) return [parsed.data];
      console.error(`[tenants] ${r.id} canlı ayarı geçersiz, yüklenmedi:\n${parsed.error.message}`);
      return [];
    });
  }

  /** Panelde düzenlenen ayar: taslak varsa o, yoksa canlı */
  getEditable(id: string): { config: unknown; hasDraft: boolean; version: number; publishedAt: number | null } | null {
    const row = this.db.prepare("SELECT config_live, config_draft, version, published_at FROM tenants WHERE id = ?").get(id) as
      | { config_live: string; config_draft: string | null; version: number; published_at: number | null }
      | undefined;
    if (!row) return null;
    return {
      config: JSON.parse(row.config_draft ?? row.config_live),
      hasDraft: row.config_draft !== null,
      version: row.version,
      publishedAt: row.published_at,
    };
  }

  getLiveRaw(id: string): unknown {
    const row = this.db.prepare("SELECT config_live FROM tenants WHERE id = ?").get(id) as { config_live: string } | undefined;
    return row ? JSON.parse(row.config_live) : null;
  }

  saveDraft(id: string, config: unknown) {
    this.db.prepare("UPDATE tenants SET config_draft = ?, updated_at = ? WHERE id = ?").run(JSON.stringify(config), Date.now(), id);
  }

  discardDraft(id: string) {
    this.db.prepare("UPDATE tenants SET config_draft = NULL, updated_at = ? WHERE id = ?").run(Date.now(), id);
  }

  /** Doğrulanmış ayarı canlıya alır, taslağı temizler */
  publish(tenant: Tenant): number {
    const now = Date.now();
    this.db
      .prepare("UPDATE tenants SET config_live = ?, config_draft = NULL, version = version + 1, published_at = ?, updated_at = ? WHERE id = ?")
      .run(JSON.stringify(tenant), now, now, tenant.id);
    return (this.db.prepare("SELECT version FROM tenants WHERE id = ?").get(tenant.id) as { version: number }).version;
  }

  /**
   * Asistanı etkilemeyen bir alanı (ekip rolü gibi) yayınlamadan hemen uygular.
   * Bekleyen taslak varsa ona da aynı değişiklik işlenir, taslak silinmez.
   */
  patchLive(id: string, field: string, value: unknown): Tenant | null {
    const row = this.db.prepare("SELECT config_live, config_draft FROM tenants WHERE id = ?").get(id) as
      | { config_live: string; config_draft: string | null }
      | undefined;
    if (!row) return null;
    const live = { ...JSON.parse(row.config_live), [field]: value };
    const parsed = TenantSchema.parse(live);
    const draft = row.config_draft ? JSON.stringify({ ...JSON.parse(row.config_draft), [field]: value }) : null;
    this.db.prepare("UPDATE tenants SET config_live = ?, config_draft = ?, updated_at = ? WHERE id = ?").run(JSON.stringify(parsed), draft, Date.now(), id);
    return parsed;
  }

  create(tenant: Tenant) {
    this.db
      .prepare("INSERT INTO tenants (id, config_live, updated_at, published_at) VALUES (?, ?, ?, ?)")
      .run(tenant.id, JSON.stringify(tenant), Date.now(), Date.now());
  }

  list(): { id: string; name: string; version: number; hasDraft: boolean; publishedAt: number | null }[] {
    return (this.db.prepare("SELECT id, config_live, config_draft, version, published_at FROM tenants ORDER BY id").all() as {
      id: string; config_live: string; config_draft: string | null; version: number; published_at: number | null;
    }[]).map((r) => ({
      id: r.id,
      name: (JSON.parse(r.config_live) as { name?: string }).name ?? r.id,
      version: r.version,
      hasDraft: r.config_draft !== null,
      publishedAt: r.published_at,
    }));
  }
}
