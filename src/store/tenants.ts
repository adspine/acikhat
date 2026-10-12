import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { TenantSchema, type Tenant } from "../domain/tenant.ts";

export class TenantRegistry {
  private readonly byId = new Map<string, Tenant>();

  constructor(tenants: Tenant[]) {
    for (const t of tenants) this.byId.set(t.id, t);
  }

  static fromDir(dir: string): TenantRegistry {
    const tenants = readdirSync(dir)
      .filter((f) => f.endsWith(".json"))
      .map((f) => {
        const parsed = TenantSchema.safeParse(JSON.parse(readFileSync(join(dir, f), "utf8")));
        if (!parsed.success) throw new Error(`${f} geçersiz:\n${parsed.error.message}`);
        return parsed.data;
      });
    return new TenantRegistry(tenants);
  }

  get(id: string): Tenant | undefined {
    return this.byId.get(id);
  }

  /** Yayınlanan ayarı hemen devreye alır (sunucu yeniden başlamadan) */
  set(tenant: Tenant) {
    this.byId.set(tenant.id, tenant);
  }

  all(): Tenant[] {
    return [...this.byId.values()];
  }

  /** Init webhook'ta gelen aranan numara veya agent_id ile tenant bulur */
  find(opts: { calledNumber?: string | undefined; agentId?: string | undefined }): Tenant | undefined {
    for (const t of this.byId.values()) {
      if (opts.agentId && t.agentIds.includes(opts.agentId)) return t;
      if (opts.calledNumber && t.phoneNumbers.includes(opts.calledNumber)) return t;
    }
    return undefined;
  }
}
