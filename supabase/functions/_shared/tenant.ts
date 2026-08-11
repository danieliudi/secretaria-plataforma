import { getSupabaseClient } from "./supabase.ts";

export const DEFAULT_TENANT_SLUG = "daniel";

export type TaskProviderKind = "clickup" | "notion" | "trello" | "google_tasks";

export interface Tenant {
  id: string;
  slug: string;
  is_platform_owner: boolean;
  nome: string;
  cargo: string | null;
  frentes: string[];
  persona: Record<string, unknown>;
  task_provider: TaskProviderKind;
  task_provider_list_map: Record<string, unknown>;
  task_provider_token_secret_id: string | null;
  trello_api_key_secret_id: string | null;
  google_client_id: string | null;
  google_client_secret_secret_id: string | null;
  google_refresh_token_secret_id: string | null;
  ga4_property_map: Record<string, unknown>;
  whatsapp_evolution_instance: string | null;
  whatsapp_evolution_api_key_secret_id: string | null;
  telegram_bot_token_secret_id: string | null;
  telegram_webhook_secret_id: string | null;
  telegram_authorized_chat_id: number | null;
  owner_whatsapp_jid: string | null;
  active: boolean;
  usa_vocativo: boolean;
  tratamento: string | null;
  whatsapp_authorized_number: string | null;
  whatsapp_link_code: string | null;
  whatsapp_link_code_expires_at: string | null;
}

const TENANT_COLUMNS = `
  id, slug, is_platform_owner, nome, cargo, frentes, persona,
  task_provider, task_provider_list_map, task_provider_token_secret_id,
  trello_api_key_secret_id,
  google_client_id, google_client_secret_secret_id, google_refresh_token_secret_id,
  ga4_property_map,
  whatsapp_evolution_instance, whatsapp_evolution_api_key_secret_id,
  telegram_bot_token_secret_id, telegram_webhook_secret_id, telegram_authorized_chat_id,
  owner_whatsapp_jid, active, usa_vocativo, tratamento,
  whatsapp_authorized_number, whatsapp_link_code, whatsapp_link_code_expires_at
`;

// ATENÇÃO: comparação EXATA (`eq`), nunca `ilike`. Com `ilike`, o `%` do
// chamador vira curinga e casa com o PRIMEIRO tenant ativo da tabela — dava pra
// assumir a identidade de outro usuário sem nem saber o slug dele, e enumerar a
// base inteira caractere a caractere. Slugs são gerados em minúsculas
// (lib/tenant-provisioning.ts), então normalizar a entrada basta.
export async function getTenantBySlug(slug: string): Promise<Tenant | null> {
  const { data, error } = await getSupabaseClient()
    .from("tenants")
    .select(TENANT_COLUMNS)
    .eq("slug", slug.trim().toLowerCase())
    .eq("active", true)
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`tenants lookup (slug) falhou: ${error.message}`);
  return (data as Tenant | null) ?? null;
}

export async function getTenantByWhatsAppInstance(instance: string): Promise<Tenant | null> {
  const { data, error } = await getSupabaseClient()
    .from("tenants")
    .select(TENANT_COLUMNS)
    .eq("whatsapp_evolution_instance", instance.trim())
    .eq("active", true)
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`tenants lookup (whatsapp_evolution_instance) falhou: ${error.message}`);
  return (data as Tenant | null) ?? null;
}

/** Carrega o tenant do Daniel (fallback padrão pra qualquer canal sem roteamento explícito). */
export async function getDefaultTenant(): Promise<Tenant | null> {
  return getTenantBySlug(DEFAULT_TENANT_SLUG);
}

// ─── Número compartilhado (autorização por telefone) ────────────────────────
//
// Resolve pelo REMETENTE (`from`), não pela instância que recebeu — o
// inverso de getTenantByWhatsAppInstance. Por isso getTenantByAuthorizedPhone
// NÃO tem fallback padrão (ao contrário de todo resolver acima): sem match,
// devolve null e quem chama decide recusar — usar o tenant do Daniel aqui
// vazaria contexto dele pra qualquer desconhecido que mandar mensagem pro
// número compartilhado.

/**
 * Normaliza um JID do WhatsApp (Evolution: "5511999999999@s.whatsapp.net")
 * pro E.164 salvo em whatsapp_authorized_number ("+5511999999999"). Grupos
 * (`@g.us`) e remetentes sem dígito nenhum nunca autorizam — devolve null.
 */
export function normalizeWhatsAppJidToE164(jid: string): string | null {
  if (jid.includes("@g.us")) return null;
  const digits = jid.split("@")[0].replace(/\D/g, "");
  return digits ? `+${digits}` : null;
}

export async function getTenantByAuthorizedPhone(fromE164: string): Promise<Tenant | null> {
  const { data, error } = await getSupabaseClient()
    .from("tenants")
    .select(TENANT_COLUMNS)
    .eq("whatsapp_authorized_number", fromE164)
    .eq("active", true)
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`tenants lookup (whatsapp_authorized_number) falhou: ${error.message}`);
  return (data as Tenant | null) ?? null;
}

// Sem 0/O/1/I — evita confusão ao ler/digitar o código no WhatsApp.
const LINK_CODE_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
const LINK_CODE_LENGTH = 6;
const LINK_CODE_TTL_MIN = 30;

// Gerador CRIPTOGRÁFICO (não Math.random): este código é o ÚNICO fator que
// autoriza um telefone a assumir uma conta. Com Math.random o estado do PRNG é
// reconstruível a partir de poucas saídas — bastava gerar vários códigos
// próprios pra prever os dos outros. O módulo evita o viés de `% length`
// descartando os valores da cauda incompleta do byte.
function generateWhatsAppLinkCode(): string {
  const limite = 256 - (256 % LINK_CODE_ALPHABET.length);
  let code = "";
  while (code.length < LINK_CODE_LENGTH) {
    const bytes = crypto.getRandomValues(new Uint8Array(LINK_CODE_LENGTH));
    for (const b of bytes) {
      if (b >= limite) continue;
      code += LINK_CODE_ALPHABET[b % LINK_CODE_ALPHABET.length];
      if (code.length === LINK_CODE_LENGTH) break;
    }
  }
  return code;
}

/** Gera (substituindo qualquer pendente) o código de vínculo do tenant. Chamado pelo onboarding self-serve. */
export async function createWhatsAppLinkCode(tenantId: string): Promise<{ code: string; expiresAt: string }> {
  const code = generateWhatsAppLinkCode();
  const expiresAt = new Date(Date.now() + LINK_CODE_TTL_MIN * 60_000).toISOString();
  const { error } = await getSupabaseClient()
    .from("tenants")
    .update({ whatsapp_link_code: code, whatsapp_link_code_expires_at: expiresAt })
    .eq("id", tenantId);
  if (error) throw new Error(`whatsapp_link_code update falhou: ${error.message}`);
  return { code, expiresAt };
}

/**
 * Tenta consumir um código de vínculo: se `text` bate com um código
 * pendente e não vencido de algum tenant, autoriza `fromE164` pra esse
 * tenant (grava whatsapp_authorized_number, limpa o código) e devolve o
 * tenant já atualizado. Sem match (ou vencido), devolve null — quem chama
 * decide a mensagem de recusa. Number já autorizado a OUTRO tenant faz o
 * update falhar (constraint unique) — propaga como erro, não sobrescreve.
 */
export async function consumeWhatsAppLinkCode(text: string, fromE164: string): Promise<Tenant | null> {
  const code = text.trim().toUpperCase();
  if (!code) return null;

  const { data, error } = await getSupabaseClient()
    .from("tenants")
    .select(TENANT_COLUMNS)
    .eq("whatsapp_link_code", code)
    .eq("active", true)
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`whatsapp_link_code lookup falhou: ${error.message}`);
  const tenant = data as Tenant | null;
  if (!tenant) return null;
  if (!tenant.whatsapp_link_code_expires_at || new Date(tenant.whatsapp_link_code_expires_at) < new Date()) {
    return null;
  }

  const { error: updateErr } = await getSupabaseClient()
    .from("tenants")
    .update({
      whatsapp_authorized_number: fromE164,
      whatsapp_link_code: null,
      whatsapp_link_code_expires_at: null,
    })
    .eq("id", tenant.id);
  if (updateErr) throw new Error(`whatsapp_authorized_number update falhou: ${updateErr.message}`);

  return {
    ...tenant,
    whatsapp_authorized_number: fromE164,
    whatsapp_link_code: null,
    whatsapp_link_code_expires_at: null,
  };
}

/** Lê um segredo do Vault pelo uuid. null (id ou valor) vira undefined — cai no fallback de env global. */
async function readSecret(secretId: string | null): Promise<string | undefined> {
  if (!secretId) return undefined;
  const { data, error } = await getSupabaseClient().rpc("tenant_secret_read", { p_id: secretId });
  if (error) throw new Error(`tenant_secret_read falhou: ${error.message}`);
  return (data as string | null) ?? undefined;
}

// ─── Telegram: secret_token do webhook + chat autorizado ────────────────────
//
// O Telegram manda de volta, em TODA chamada real de webhook, o valor
// configurado como `secret_token` no setWebhook, no header
// X-Telegram-Bot-Api-Secret-Token. Sem essa checagem, qualquer um que
// descubra a URL `/telegram/<slug>` pode forjar um POST direto — o endpoint
// tem verify_jwt desligado (é um webhook público) e processava a mensagem
// como se fosse real, com as credenciais daquele tenant.

/** Lê o secret_token do webhook do tenant. undefined = tenant não configurou (Telegram desligado pra ele). */
export async function getTelegramWebhookSecret(tenant: Tenant): Promise<string | undefined> {
  return readSecret(tenant.telegram_webhook_secret_id);
}

/**
 * Confere (ou vincula, na primeira vez) o chat_id autorizado a falar com o
 * bot deste tenant — trust-on-first-use, equivalente ao
 * whatsapp_authorized_number adaptado pro modelo de bot próprio por tenant
 * do Telegram. A PRIMEIRA mensagem que passar pela validação de
 * secret_token vira o dono; chat_id diferente depois disso é recusado.
 * UPDATE condicional (`is(...,null)`) evita corrida entre duas primeiras
 * mensagens simultâneas roubando o vínculo uma da outra.
 */
export async function authorizeTelegramChatId(tenant: Tenant, chatId: number): Promise<boolean> {
  if (tenant.telegram_authorized_chat_id !== null) {
    return tenant.telegram_authorized_chat_id === chatId;
  }
  const { data, error } = await getSupabaseClient()
    .from("tenants")
    .update({ telegram_authorized_chat_id: chatId })
    .eq("id", tenant.id)
    .is("telegram_authorized_chat_id", null)
    .select("id")
    .maybeSingle();
  if (error) throw new Error(`telegram_authorized_chat_id update falhou: ${error.message}`);
  if (data) return true;

  // Perdeu a corrida pro vínculo — confere quem ganhou antes de recusar.
  const { data: row, error: readErr } = await getSupabaseClient()
    .from("tenants")
    .select("telegram_authorized_chat_id")
    .eq("id", tenant.id)
    .maybeSingle();
  if (readErr) throw new Error(`telegram_authorized_chat_id leitura falhou: ${readErr.message}`);
  return (row as { telegram_authorized_chat_id: number | null } | null)?.telegram_authorized_chat_id === chatId;
}

const PROVIDER_LIST_MAP_ENV_KEY: Record<TaskProviderKind, string> = {
  clickup: "CLICKUP_LIST_MAP",
  notion: "NOTION_DATABASE_MAP",
  trello: "TRELLO_LIST_MAP",
  google_tasks: "GOOGLE_TASKS_LIST_MAP",
};

// ClickUp/Notion/Google Tasks usam 1 token só; Trello precisa de key+token —
// o secret genérico abaixo vira TRELLO_API_TOKEN, e a API key tem sua própria
// coluna (`trello_api_key_secret_id`, opcional). Sem ela, TRELLO_API_KEY cai
// no env global — mesmo comportamento de antes, agora só um fallback.
const PROVIDER_TOKEN_ENV_KEY: Record<TaskProviderKind, string> = {
  clickup: "CLICKUP_API_TOKEN",
  notion: "NOTION_API_TOKEN",
  trello: "TRELLO_API_TOKEN",
  google_tasks: "", // Google Tasks reusa as credenciais do Google — sem token próprio.
};

/**
 * Chaves que TODO tenant pode herdar do ambiente global, porque não são de
 * ninguém — são infraestrutura da plataforma (contas de API pagas pela
 * plataforma, endereços de serviço, o app OAuth compartilhado).
 *
 * Tudo que NÃO está aqui é credencial ou dado PESSOAL de alguém. Para essas,
 * ausência tem que ser erro, nunca herança: o `?? Deno.env.get(key)` que
 * existia antes fazia um usuário novo sem Google conectado operar na agenda e
 * no Gmail do dono da plataforma, e dava a todo mundo acesso de leitura ao CRM
 * da empresa. Só o tenant marcado `is_platform_owner` continua herdando —
 * afinal os secrets globais são literalmente as contas dele.
 */
const SHARED_INFRA_KEYS = new Set([
  // Contas de API da plataforma
  "ANTHROPIC_API_KEY",
  "GROQ_API_KEY",
  // Infra do próprio Supabase
  "SUPABASE_URL",
  "SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  // Endereço do servidor Evolution (a credencial e a instância NÃO entram aqui)
  "EVOLUTION_API_URL",
  // Instância compartilhada da plataforma (número único) — ver reflex/index.ts
  "PLATFORM_EVOLUTION_INSTANCE",
  "PLATFORM_EVOLUTION_API_KEY",
  // App OAuth do Google: é o mesmo pra todos por design (ver README) — o que é
  // pessoal é o refresh token, que continua fora desta lista.
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
  // Key de APLICAÇÃO do Trello (o token de acesso é que é pessoal).
  "TRELLO_API_KEY",
]);

/**
 * Resolve os segredos do Vault do tenant e devolve um `env` SÍNCRONO,
 * compatível com toda função `deps.env` existente no código — resolve tudo
 * ANTES (não dá pra fazer RPC async dentro de um `(key) => string` síncrono).
 *
 * Precedência: segredo do próprio tenant → (só pra infra compartilhada, ou se
 * o tenant for o dono da plataforma) ambiente global → undefined.
 */
export async function buildTenantEnv(
  tenant: Tenant,
): Promise<(key: string) => string | undefined> {
  const [googleClientSecret, googleRefreshToken, taskProviderToken, trelloApiKey, evolutionApiKey, telegramBotToken] =
    await Promise.all([
      readSecret(tenant.google_client_secret_secret_id),
      readSecret(tenant.google_refresh_token_secret_id),
      readSecret(tenant.task_provider_token_secret_id),
      readSecret(tenant.trello_api_key_secret_id),
      readSecret(tenant.whatsapp_evolution_api_key_secret_id),
      readSecret(tenant.telegram_bot_token_secret_id),
    ]);

  const overrides = new Map<string, string>();
  if (tenant.google_client_id) overrides.set("GOOGLE_CLIENT_ID", tenant.google_client_id);
  if (googleClientSecret) overrides.set("GOOGLE_CLIENT_SECRET", googleClientSecret);
  if (googleRefreshToken) overrides.set("GOOGLE_REFRESH_TOKEN", googleRefreshToken);
  if (Object.keys(tenant.ga4_property_map ?? {}).length > 0) {
    overrides.set("GA4_PROPERTY_MAP", JSON.stringify(tenant.ga4_property_map));
  }

  overrides.set("TASK_PROVIDER", tenant.task_provider);
  const tokenKey = PROVIDER_TOKEN_ENV_KEY[tenant.task_provider];
  if (tokenKey && taskProviderToken) overrides.set(tokenKey, taskProviderToken);
  if (trelloApiKey) overrides.set("TRELLO_API_KEY", trelloApiKey);
  if (Object.keys(tenant.task_provider_list_map ?? {}).length > 0) {
    overrides.set(PROVIDER_LIST_MAP_ENV_KEY[tenant.task_provider], JSON.stringify(tenant.task_provider_list_map));
  }

  if (tenant.whatsapp_evolution_instance) overrides.set("EVOLUTION_INSTANCE", tenant.whatsapp_evolution_instance);
  if (evolutionApiKey) overrides.set("EVOLUTION_API_KEY", evolutionApiKey);
  if (tenant.owner_whatsapp_jid) overrides.set("OWNER_WHATSAPP", tenant.owner_whatsapp_jid);
  if (telegramBotToken) overrides.set("TELEGRAM_BOT_TOKEN", telegramBotToken);

  return (key: string): string | undefined => {
    const doTenant = overrides.get(key);
    if (doTenant !== undefined) return doTenant;
    if (SHARED_INFRA_KEYS.has(key) || tenant.is_platform_owner) return Deno.env.get(key);
    // Credencial pessoal que este tenant não configurou: devolve undefined pra
    // quem chama falhar de forma visível, em vez de silenciosamente usar a do
    // dono da plataforma.
    return undefined;
  };
}
