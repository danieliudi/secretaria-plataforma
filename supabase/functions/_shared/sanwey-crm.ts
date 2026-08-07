// CRM da Sanwey (sanwey-gestao.netlify.app) — leitura read-only de leads e
// operações de marketing (campanhas, entregas, cotações de fornecedor). Vive
// num projeto Supabase SEPARADO do secretaria-agentic — não confundir com
// _shared/supabase.ts (SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY), que aponta
// pro banco da própria secretária.
//
// Secrets (Supabase, projeto secretaria-agentic):
//   SANWEY_CRM_SUPABASE_URL       ex: https://adizvduyfzfftyswkijj.supabase.co
//   SANWEY_CRM_SERVICE_ROLE_KEY   service_role do projeto do CRM

import {
  createClient,
  type SupabaseClient,
} from "https://esm.sh/@supabase/supabase-js@2.45.4";

export interface CrmDeps {
  env: (key: string) => string | undefined;
}

export function defaultCrmDeps(): CrmDeps {
  return { env: (k) => Deno.env.get(k) };
}

export function hasCrmConfig(env: CrmDeps["env"] = (k) => Deno.env.get(k)): boolean {
  return Boolean(env("SANWEY_CRM_SUPABASE_URL") && env("SANWEY_CRM_SERVICE_ROLE_KEY"));
}

function getCrmClient(deps: CrmDeps): SupabaseClient {
  const url = deps.env("SANWEY_CRM_SUPABASE_URL");
  const key = deps.env("SANWEY_CRM_SERVICE_ROLE_KEY");
  if (!url || !key) {
    throw new Error(
      "CRM da Sanwey não configurado: faltam SANWEY_CRM_SUPABASE_URL/SANWEY_CRM_SERVICE_ROLE_KEY",
    );
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

// ─── Leads (funil de vendas) ─────────────────────────────────────────────────

export interface CrmLead {
  company: string;
  stage: string;
  value: number | null;
  probability: number | null;
  next_follow_up: string | null;
  owner: string | null;
  sector: string | null;
  city: string | null;
  created_at: string;
}

export interface ListCrmLeadsInput {
  stage?: string;
  limit?: number;
}

export async function listCrmLeads(
  input: ListCrmLeadsInput,
  deps: CrmDeps = defaultCrmDeps(),
): Promise<CrmLead[]> {
  const client = getCrmClient(deps);
  // .not(is, true) em vez de .eq(is_demo, false) — não descarta linhas com
  // is_demo NULL (eq com false exclui NULL também, o que esconderia leads reais).
  let q = client
    .from("leads")
    .select("company, stage, value, probability, next_follow_up, owner, sector, city, created_at")
    .not("is_demo", "is", true)
    .order("created_at", { ascending: false })
    .limit(input.limit && input.limit > 0 ? input.limit : 20);
  if (input.stage) q = q.ilike("stage", `%${input.stage}%`);

  const { data, error } = await q;
  if (error) throw new Error(`CRM leads query falhou: ${error.message}`);
  return (data ?? []) as CrmLead[];
}

// ─── Campanhas de marketing ──────────────────────────────────────────────────

export interface CrmCampaign {
  name: string;
  channel: string | null;
  stage: string;
  launch_date: string | null;
  end_date: string | null;
  budget: number | null;
  performance_score: number | null;
  agency_name: string | null;
}

export interface ListCrmCampaignsInput {
  stage?: string;
  limit?: number;
}

export async function listCrmCampaigns(
  input: ListCrmCampaignsInput,
  deps: CrmDeps = defaultCrmDeps(),
): Promise<CrmCampaign[]> {
  const client = getCrmClient(deps);
  let q = client
    .from("marketing_campaigns")
    .select("name, channel, stage, launch_date, end_date, budget, performance_score, agency_name")
    .order("launch_date", { ascending: false })
    .limit(input.limit && input.limit > 0 ? input.limit : 20);
  if (input.stage) q = q.ilike("stage", `%${input.stage}%`);

  const { data, error } = await q;
  if (error) throw new Error(`CRM campanhas query falhou: ${error.message}`);
  return (data ?? []) as CrmCampaign[];
}

// ─── Entregas de marketing (pedidos internos pra agência) ───────────────────

export interface CrmDeliverable {
  title: string;
  requester_name: string | null;
  department: string | null;
  priority: string | null;
  deadline: string | null;
  stage: string;
  assignee: string | null;
}

export interface ListCrmDeliverablesInput {
  stage?: string;
  limit?: number;
}

export async function listCrmDeliverables(
  input: ListCrmDeliverablesInput,
  deps: CrmDeps = defaultCrmDeps(),
): Promise<CrmDeliverable[]> {
  const client = getCrmClient(deps);
  let q = client
    .from("marketing_deliverables")
    .select("title, requester_name, department, priority, deadline, stage, assignee")
    .order("deadline", { ascending: true })
    .limit(input.limit && input.limit > 0 ? input.limit : 20);
  if (input.stage) q = q.ilike("stage", `%${input.stage}%`);

  const { data, error } = await q;
  if (error) throw new Error(`CRM entregas query falhou: ${error.message}`);
  return (data ?? []) as CrmDeliverable[];
}

// ─── Cotações de fornecedor ───────────────────────────────────────────────────

export interface CrmSupplierQuote {
  title: string;
  deadline: string | null;
  status: string;
  response_value: number | null;
}

export interface ListSupplierQuotesInput {
  status?: string;
  limit?: number;
}

export async function listSupplierQuotes(
  input: ListSupplierQuotesInput,
  deps: CrmDeps = defaultCrmDeps(),
): Promise<CrmSupplierQuote[]> {
  const client = getCrmClient(deps);
  let q = client
    .from("marketing_supplier_quotes")
    .select("title, deadline, status, response_value")
    .order("deadline", { ascending: true })
    .limit(input.limit && input.limit > 0 ? input.limit : 20);
  if (input.status) q = q.ilike("status", `%${input.status}%`);

  const { data, error } = await q;
  if (error) throw new Error(`CRM cotações query falhou: ${error.message}`);
  return (data ?? []) as CrmSupplierQuote[];
}

// ─── System prompt block ───────────────────────────────────────────────────────

export function buildCrmSystemBlock(configured: boolean): string {
  if (!configured) {
    return `ACESSO AO CRM SANWEY (leads e marketing)
- Não configurado. Se Daniel pedir leads, campanhas, entregas ou cotações, diga que o CRM ainda não está integrado.`;
  }
  return `ACESSO AO CRM SANWEY (leads e marketing — sanwey-gestao.netlify.app)
- 4 tools de leitura (read-only — nenhuma cria/edita nada no CRM ainda):
  - list_crm_leads(stage?, limit?): funil de vendas. Ignora leads de demonstração automaticamente.
  - list_marketing_campaigns(stage?, limit?): campanhas de marketing.
  - list_marketing_deliverables(stage?, limit?): pedidos internos pra agência (entregas de marketing).
  - list_supplier_quotes(status?, limit?): cotações de fornecedor da área de marketing.
- \`stage\`/\`status\` filtram por trecho (case-insensitive) — não precisa ser exato.`;
}
