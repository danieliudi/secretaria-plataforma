import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { upsertTenantSecret, readTenantSecret } from "@/lib/tenant-provisioning";
import {
  createClickUpList,
  createGoogleTasksList,
  createMicrosoftTodoList,
  createNotionDatabase,
  createSanweyTasksList,
  createTrelloList,
} from "@/lib/task-list-create";

const VALID_PROVIDERS = new Set(["clickup", "notion", "trello", "google_tasks", "microsoft_todo", "sanwey_tasks"]);
const DEFAULT_FRENTE = "geral";

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "não autenticado" }, { status: 401 });
  }

  let body: { provider?: unknown; token?: unknown; trello_api_key?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  const provider = typeof body.provider === "string" ? body.provider : "";
  if (!VALID_PROVIDERS.has(provider)) {
    return NextResponse.json({ error: `provider inválido: '${provider}'` }, { status: 400 });
  }

  // Sem token pra Google Tasks/Microsoft To Do — reusam o refresh token que
  // já veio do login (Google/Outlook).
  const needsToken = provider !== "google_tasks" && provider !== "microsoft_todo";
  const token = needsToken && typeof body.token === "string" ? body.token.trim() : "";
  if (needsToken && !token) {
    return NextResponse.json({ error: "token é obrigatório pra essa plataforma" }, { status: 400 });
  }
  const trelloApiKey = provider === "trello" && typeof body.trello_api_key === "string"
    ? body.trello_api_key.trim()
    : "";

  const admin = createServiceClient();
  const { data: tenant, error: loadErr } = await admin
    .from("tenants")
    .select(
      "id, frentes, is_platform_owner, task_provider_token_secret_id, trello_api_key_secret_id, task_provider, task_provider_list_map, google_refresh_token_secret_id, outlook_refresh_token_secret_id",
    )
    .eq("auth_user_id", user.id)
    .maybeSingle();

  if (loadErr || !tenant) {
    return NextResponse.json(
      { error: "tenant não encontrado — complete o passo de persona primeiro" },
      { status: 404 },
    );
  }

  // `sanwey_tasks` é o "Meu To-Do" pessoal do dono da plataforma dentro do
  // sanwey-crm — não é um produto que outra conta possa usar (o token é o
  // PERSONAL_TASKS_AGENT_KEY de outra Edge Function). O wizard já esconde a
  // opção de quem não é dono; este portão é o que vale, porque a tela é só
  // uma sugestão: um POST direto aqui contornaria o filtro do React.
  if (provider === "sanwey_tasks" && !tenant.is_platform_owner) {
    return NextResponse.json({ error: `provider inválido: '${provider}'` }, { status: 400 });
  }

  let secretId = tenant.task_provider_token_secret_id as string | null;
  let trelloApiKeySecretId = tenant.trello_api_key_secret_id as string | null;
  try {
    if (token) {
      secretId = await upsertTenantSecret(admin, secretId, token, `task_provider_${tenant.id}`);
    }
    if (trelloApiKey) {
      trelloApiKeySecretId = await upsertTenantSecret(admin, trelloApiKeySecretId, trelloApiKey, `trello_api_key_${tenant.id}`);
    }
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }

  // Credenciais reais que vão criar as listas — Google/Microsoft usam o
  // refresh token do login; os outros usam o token que acabou de ser colado
  // (não o secretId salvo, porque nem sempre há um novo — reusa o que veio
  // no body desta chamada, que é sempre o valor em claro mais recente).
  let googleRefreshToken = "";
  let outlookRefreshToken = "";
  try {
    if (provider === "google_tasks") {
      if (!tenant.google_refresh_token_secret_id) {
        return NextResponse.json({ error: "Conecta sua conta Google primeiro (passo anterior)." }, { status: 400 });
      }
      googleRefreshToken = await readTenantSecret(admin, tenant.google_refresh_token_secret_id);
    }
    if (provider === "microsoft_todo") {
      if (!tenant.outlook_refresh_token_secret_id) {
        return NextResponse.json({ error: "Conecta sua conta Outlook primeiro (passo anterior)." }, { status: 400 });
      }
      outlookRefreshToken = await readTenantSecret(admin, tenant.outlook_refresh_token_secret_id);
    }
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }

  // Reaproveita o map já salvo se a pessoa está reabrindo este passo (editar)
  // com o MESMO provider — troca de provider zera o map (listas de um
  // provider não fazem sentido pra outro).
  const existingMap = (
    tenant.task_provider === provider ? (tenant.task_provider_list_map as Record<string, string> | null) : null
  ) ?? {};
  const existingKeysLower = new Set(Object.keys(existingMap).map((k) => k.toLowerCase()));

  const frentesTenant = ((tenant.frentes as string[] | null) ?? []).filter(Boolean);
  const frentesAlvo = frentesTenant.length > 0 ? frentesTenant : [DEFAULT_FRENTE];
  const frentesFaltando = frentesAlvo.filter((f) => !existingKeysLower.has(f.toLowerCase()));

  async function criarLista(frente: string): Promise<{ id: string; name: string }> {
    if (provider === "google_tasks") return createGoogleTasksList(googleRefreshToken, frente);
    if (provider === "microsoft_todo") return createMicrosoftTodoList(outlookRefreshToken, frente);
    if (provider === "clickup") return createClickUpList(token, frente);
    if (provider === "notion") return createNotionDatabase(token, frente);
    if (provider === "sanwey_tasks") return createSanweyTasksList(token, frente);
    // trello
    const apiKey = trelloApiKey || process.env.TRELLO_API_KEY;
    if (!apiKey) {
      throw new Error(
        "Criação automática do Trello não está configurada ainda — fale com quem administra a plataforma, ou cole sua própria API key acima.",
      );
    }
    return createTrelloList(apiKey, token, frente);
  }

  const resultados = await Promise.allSettled(frentesFaltando.map((frente) => criarLista(frente)));

  const novoMap: Record<string, string> = { ...existingMap };
  const criadas: string[] = [];
  const falhas: Array<{ frente: string; erro: string }> = [];
  resultados.forEach((resultado, i) => {
    const frente = frentesFaltando[i];
    if (resultado.status === "fulfilled") {
      novoMap[frente] = resultado.value.id;
      criadas.push(frente);
    } else {
      falhas.push({ frente, erro: String(resultado.reason instanceof Error ? resultado.reason.message : resultado.reason) });
    }
  });

  // Quem termina o wizard sem declarar frente nenhuma ganha uma lista chamada
  // `DEFAULT_FRENTE` — mas até 03/09/2026 esse nome NÃO era gravado em
  // `tenants.frentes`, e as duas fontes ficavam se contradizendo dentro do
  // MESMO system prompt: o bloco do provider dizia "Frentes com Notion
  // configurado: geral" enquanto o bloco de persona dizia que o usuário não
  // tem frente nenhuma.
  //
  // O efeito real (Erika, 02/09): ela pediu pra criar uma tarefa, a secretária
  // não soube em qual frente, e acabou afirmando três vezes que "o Notion não
  // está integrado" — com a integração funcionando e o database criado. Diante
  // de duas afirmações incompatíveis, o modelo escolheu a errada e ainda
  // reforçou ("não é instabilidade"). Sincronizar aqui é o que impede a
  // contradição de existir.
  const frentesParaGravar = frentesTenant.length > 0 ? frentesTenant : [DEFAULT_FRENTE];

  const { error } = await admin
    .from("tenants")
    .update({
      task_provider: provider,
      task_provider_list_map: novoMap,
      task_provider_token_secret_id: secretId,
      trello_api_key_secret_id: trelloApiKeySecretId,
      frentes: frentesParaGravar,
      updated_at: new Date().toISOString(),
    })
    .eq("id", tenant.id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, criadas, falhas });
}
