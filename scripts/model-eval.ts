/**
 * Aynı simülasyon testlerini farklı LLM'lerle çalıştırıp karşılaştırır.
 *   node --env-file=.env scripts/model-eval.ts demo-spa --models gemini-3.5-flash-lite,claude-haiku-4-5 [--only 01-normal-randevu]
 * Testler gerçek backend araçlarını çağırır (PUBLIC_BASE_URL erişilebilir olmalı).
 * Sonuç: build/evals/<zaman>.md ve .json
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { parseArgs } from "node:util";
import { TenantRegistry } from "../src/store/tenants.ts";
import { initVariables } from "../src/http/webhooks.ts";
import { agentEnvFrom, buildAgent } from "../src/agent/build.ts";
import { verticalFile } from "../src/domain/vertical.ts";

interface Scenario {
  name: string;
  scenario: string;
  success_conditions: string[];
  max_turns: number;
  caller_unknown?: boolean;
}

const API = "https://api.elevenlabs.io/v1/convai";
const key = process.env.ELEVENLABS_API_KEY;
if (!key) throw new Error("ELEVENLABS_API_KEY eksik");

async function api<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { "xi-api-key": key!, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status}: ${text.slice(0, 800)}`);
  return JSON.parse(text) as T;
}

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { models: { type: "string" }, only: { type: "string" } },
});
const tenantId = positionals[0] ?? "demo-spa";
const tenant = TenantRegistry.fromDir("tenants").get(tenantId);
if (!tenant) throw new Error(`tenants/${tenantId}.json bulunamadı`);
const models = (values.models ?? "gemini-3.5-flash-lite").split(",");
let scenarios: Scenario[] = JSON.parse(readFileSync(verticalFile(tenant.vertical, "eval-scenarios.json"), "utf8"));
if (values.only) scenarios = scenarios.filter((s) => values.only!.split(",").includes(s.name));

// Testleri bir kez oluştur, id'leri sakla. Senaryo metni değişirse PUT ile güncelle.
mkdirSync("build/evals", { recursive: true });
const idsFile = "build/evals/test-ids.json";
const ids: Record<string, string> = existsSync(idsFile) ? JSON.parse(readFileSync(idsFile, "utf8")) : {};
const now = Temporal.Now.zonedDateTimeISO("UTC");

for (const s of scenarios) {
  const vars = initVariables(tenant, now, s.caller_unknown ? undefined : "+905321112233");
  const body = {
    name: `[${tenantId}] ${s.name}`,
    type: "simulation",
    simulation_scenario: s.scenario,
    success_conditions: s.success_conditions,
    simulation_max_turns: s.max_turns,
    dynamic_variables: vars,
    tool_mock_config: { mocking_strategy: "none", fallback_strategy: "call_real_tool" },
  };
  if (ids[s.name]) await api("PUT", `/agent-testing/${ids[s.name]}`, body);
  else ids[s.name] = (await api<{ id: string }>("POST", "/agent-testing/create", body)).id;
}
writeFileSync(idsFile, JSON.stringify(ids, null, 2));

type Run = {
  test_id: string;
  test_name: string;
  status: "pending" | "passed" | "failed" | "cancelled";
  credits_used?: number | null;
  condition_result?: { result: string; rationale?: { summary?: string; messages?: string[] } | null } | null;
  agent_responses?: {
    role: string;
    message?: string | null;
    tool_calls?: { tool_name: string }[];
    tool_results?: unknown[];
    conversation_turn_metrics?: { metrics?: Record<string, { elapsed_time?: number }> } | null;
  }[] | null;
};

const baseUrl = process.env.PUBLIC_BASE_URL ?? "";
const results: { model: string; runs: Run[] }[] = [];

/**
 * Her model için asıl ajanın birebir kopyası (yalnızca LLM farklı).
 * run-tests'teki agent_config_override webhook araçlarını taşımadığı için
 * (Ekim 2026'da denendi: ajan hiç araç çağıramadı) ayrı ajan kullanılıyor.
 */
const evalAgentsFile = "build/evals/eval-agents.json";
const evalAgents: Record<string, string> = existsSync(evalAgentsFile) ? JSON.parse(readFileSync(evalAgentsFile, "utf8")) : {};
for (const model of models) {
  const cfg = buildAgent(tenant, agentEnvFrom(process.env)) as any;
  cfg.name = `[EVAL] ${tenant.name} – ${model}`;
  cfg.tags = ["eval", tenant.id];
  cfg.conversation_config.agent.prompt.llm = model;
  if (evalAgents[model]) await api("PATCH", `/agents/${evalAgents[model]}`, cfg);
  else evalAgents[model] = (await api<{ agent_id: string }>("POST", "/agents/create", cfg)).agent_id;
}
writeFileSync(evalAgentsFile, JSON.stringify(evalAgents, null, 2));
const startedMs = Date.now();

await Promise.all(
  models.map(async (model) => {
    const inv = await api<{ id: string }>("POST", `/agents/${evalAgents[model]}/run-tests`, {
      tests: scenarios.map((s) => ({ test_id: ids[s.name] })),
    });
    console.info(`${model}: çalışıyor (${inv.id})`);
    for (;;) {
      await new Promise((r) => setTimeout(r, 5000));
      const r = await api<{ test_runs: Run[] }>("GET", `/test-invocations/${inv.id}`);
      if (r.test_runs.every((t) => t.status !== "pending")) {
        results.push({ model, runs: r.test_runs });
        console.info(`${model}: bitti`);
        return;
      }
    }
  }),
);

/** Araç sonucundan sonra ajanın konuşmadığı turlar (canlı testte görülen 8 sn sessizlik) */
function silentAfterTool(run: Run): number {
  const turns = run.agent_responses ?? [];
  let n = 0;
  for (let i = 0; i < turns.length; i++) {
    if (!turns[i]!.tool_results?.length) continue;
    const next = turns.slice(i + 1).find((t) => t.role === "agent" && !t.tool_results?.length);
    const nextUser = turns.findIndex((t, j) => j > i && t.role === "user");
    const nextAgentIdx = next ? turns.indexOf(next) : -1;
    if (!next || !next.message?.trim() || (nextUser !== -1 && nextUser < nextAgentIdx)) n++;
  }
  return n;
}

function llmTtfbMs(run: Run): number[] {
  return (run.agent_responses ?? [])
    .map((t) => t.conversation_turn_metrics?.metrics?.convai_llm_service_ttfb?.elapsed_time)
    .filter((x): x is number => typeof x === "number")
    .map((x) => x * 1000);
}

const median = (xs: number[]) => {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)]!;
};

const lines: string[] = [];
lines.push(`# Model karşılaştırması (${now.withTimeZone("Europe/Istanbul").toPlainDateTime().toString().slice(0, 16)})`, "");
lines.push("| Model | Geçen | Araç sonrası sessizlik | LLM ilk token (medyan) | Kredi |", "|---|---|---|---|---|");
for (const { model, runs } of results) {
  const passed = runs.filter((r) => r.status === "passed").length;
  const silent = runs.reduce((a, r) => a + silentAfterTool(r), 0);
  const ttfb = median(runs.flatMap(llmTtfbMs));
  const credits = runs.reduce((a, r) => a + (r.credits_used ?? 0), 0);
  lines.push(`| ${model} | ${passed}/${runs.length} | ${silent} | ${Number.isNaN(ttfb) ? "?" : Math.round(ttfb) + " ms"} | ${credits} |`);
}
lines.push("", "## Senaryo bazında", "", `| Senaryo | ${results.map((r) => r.model).join(" | ")} |`, `|---|${results.map(() => "---").join("|")}|`);
for (const s of scenarios) {
  const cells = results.map(({ runs }) => {
    const r = runs.find((x) => x.test_id === ids[s.name]);
    return r ? (r.status === "passed" ? "✅" : "❌") + (r && silentAfterTool(r) ? " 🔇" : "") : "-";
  });
  lines.push(`| ${s.name} | ${cells.join(" | ")} |`);
}
lines.push("", "## Başarısızlık gerekçeleri", "");
for (const { model, runs } of results)
  for (const r of runs.filter((x) => x.status !== "passed"))
    lines.push(`- **${model} / ${r.test_name}**: ${r.condition_result?.rationale?.summary ?? r.condition_result?.rationale?.messages?.join(" ") ?? r.status}`);

// Testlerin gerçek backend'e yazdığı randevu ve geri arama kayıtlarını temizle.
// Araçlar Fly.io'daki sunucuya gidiyorsa temizlik orada yapılır (yerel veritabanı boş kalır).
{
  const sql = (db: string) =>
    `const {DatabaseSync}=require('node:sqlite');const d=new DatabaseSync('${db}');` +
    `console.log(d.prepare('DELETE FROM appointments WHERE created_at >= ?').run(${startedMs}).changes+' randevu ve '+` +
    `d.prepare('DELETE FROM callback_requests WHERE created_at >= ?').run(${startedMs}).changes+' geri arama kaydı')`;
  const flyApp = baseUrl.match(/^https:\/\/([a-z0-9-]+)\.fly\.dev/)?.[1];
  const { execFileSync } = await import("node:child_process");
  try {
    const out = flyApp
      ? execFileSync("fly", ["ssh", "console", "--app", flyApp, "-C", `node -e "${sql("/data/app.db")}"`], { encoding: "utf8" })
      : execFileSync(process.execPath, ["-e", sql(process.env.DB_PATH ?? "data/app.db")], { encoding: "utf8" });
    lines.push("", `_Test sırasında oluşan ${out.trim().split("\n").at(-1)} silindi (${flyApp ? `Fly: ${flyApp}` : "yerel"})._`);
  } catch (err) {
    lines.push("", `_UYARI: test kayıtları temizlenemedi (${(err as Error).message.split("\n")[0]}). ${startedMs} sonrası kayıtları elle sil._`);
  }
}

const stamp = now.epochMilliseconds;
writeFileSync(`build/evals/${stamp}.md`, lines.join("\n"));
writeFileSync(`build/evals/${stamp}.json`, JSON.stringify(results, null, 2));
console.info(lines.join("\n"));
console.info(`\nKaydedildi: build/evals/${stamp}.md`);
