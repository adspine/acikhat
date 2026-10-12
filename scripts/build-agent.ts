/**
 * Bir firmanın ElevenLabs ajan yapılandırmasını dosyaya yazar (inceleme için).
 *   node --env-file=.env scripts/build-agent.ts demo-spa
 * Asıl kod: src/agent/build.ts (panelde Yayınla da aynısını kullanır).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { TenantRegistry } from "../src/store/tenants.ts";
import { agentEnvFrom, buildAgent } from "../src/agent/build.ts";

export { buildAgent } from "../src/agent/build.ts";

if (import.meta.main) {
  const tenantId = process.argv[2];
  if (!tenantId) throw new Error("Kullanım: node --env-file=.env scripts/build-agent.ts <tenant-id>");
  const tenant = TenantRegistry.fromDir("tenants").get(tenantId);
  if (!tenant) throw new Error(`tenants/${tenantId}.json bulunamadı`);
  mkdirSync("build/agents", { recursive: true });
  const out = `build/agents/${tenantId}.agent.json`;
  writeFileSync(out, JSON.stringify(buildAgent(tenant, agentEnvFrom(process.env)), null, 2));
  console.info(`Yazıldı: ${out}`);
}
