// Proativo (agendado por pg_cron): resumo diário, relatório semanal, lembretes
// de agenda e alertas de prazo do gerenciador de tarefas (Agência Beehave).
//
// Modos (POST { task }):
//   - "brief":     resumo do dia (agenda + tarefas por cliente, via /fast).
//   - "weekly":    panorama da semana da Beehave (via /fast).
//   - "reminders": eventos de agenda começando dentro da janela → lembrete.
//   - "alerts":    tasks vencendo/vencidas (TaskProvider ativo) → alerta (dedup).
//   - "scheduled": lembretes que o Daniel agendou via tool schedule_reminder
//                  (suporta recorrência: daily/weekly/monthly_first_business_day).
//   - "marketing": review semanal por frente (GA4 + tarefas) com otimizações.
//   - "evening_recap": recap de fim de dia (o que ficou em aberto hoje).
//
// Envio: roteado por canal (WhatsApp/Evolution ou Telegram) conforme o user_id.
// pg_cron chama via pg_net (verify_jwt). Nada dispara sozinho sem job no pg_cron.
//
// Tenant: todo o arquivo roda pro tenant DEFAULT_TENANT_SLUG (hoje só o
// Daniel usa proativos). O `env` é resolvido 1x por invocação (ver Deno.serve)
// e passado pra tudo que hoje tem override por tenant — Calendar (Google),
// GA4, TaskProvider e OWNER_WHATSAPP/canal. Sem override no tenant, cai no
// secret global (Deno.env.get) — zero regressão.

import { getSupabaseClient } from "../_shared/supabase.ts";
import { getGoogleAccessToken } from "../_shared/google-oauth.ts";
import { sendWhatsAppImage, sendWhatsAppText } from "../_shared/whatsapp.ts";
import { sendTelegramMessage } from "../_shared/telegram.ts";
import { channelFromUserId, telegramChatId } from "../_shared/channel.ts";
import { getGa4Snapshot, tryLoadGa4Map } from "../_shared/ga4.ts";
import { nextOccurrence, type RecurrenceType } from "../_shared/scheduled-reminders.ts";
import { getTaskProvider } from "../_shared/task-provider-factory.ts";
import { getTenantBySlug, buildTenantEnv, DEFAULT_TENANT_SLUG } from "../_shared/tenant.ts";
import { getSectorNewsBlock } from "../_shared/news.ts";
import { nomeCurto, pendentesDeConfirmacao } from "../_shared/confirmacoes.ts";
import { type CalendarAttendee, getEventsBetween, getEventsByDate } from "../fast/tools/calendar-read.ts";
import { listaRelacionamentosIgnorados } from "../fast/tools/relacionamento.ts";
import { buscaContatoPorEmail } from "../fast/tools/redigir-supabase.ts";
import { decideEnvio } from "../_shared/envio-decisao.ts";
import { enviaTemplate, temCredencialMeta } from "../_shared/whatsapp-oficial.ts";
import { appendAssistantMessage } from "../_shared/conversation.ts";
import { isInternalCall, respostaNaoAutorizado } from "../_shared/internal-auth.ts";
import { apelidoDeUsuario, semDadoPessoal } from "../_shared/log-seguro.ts";
import {
  cargaPorDia,
  detectaConflitos,
  detectaMaratona,
  DIA_PESADO_MIN,
  duracaoTexto,
  MIN_TAREFAS_ATRASADAS,
  primeiroBuraco,
  priorizaAtrasadas,
  type EventoAgenda,
} from "../_shared/agenda-analise.ts";
import {
  consolidateUserProfile,
  defaultConsolidationDeps,
  listUsersParaConsolidar,
} from "../_shared/profile.ts";

type EnvFn = (key: string) => string | undefined;

// Frentes com operação de agência (Beehave) — únicas com resumo de notícias
// no brief por ora. Ampliar aqui se outra frente ganhar cobertura de imprensa.
const NEWS_FRENTES: Array<"resibag" | "sanwey"> = ["resibag", "sanwey"];

// Destinatário dos avisos. Secret obrigatório — sem fallback pra não errar número.
function ownerJid(env: EnvFn): string {
  const owner = env("OWNER_WHATSAPP");
  if (!owner) throw new Error("OWNER_WHATSAPP não configurado");
  return owner;
}

const LEAD_MIN = 10; // antecedência do lembrete de agenda
const SCAN_AHEAD_MIN = 15; // largura da varredura de agenda
const ALERT_AHEAD_MS = 24 * 60 * 60_000; // alerta tasks vencendo nas próx. 24h
// Janela do prep de reunião: cedo o bastante pra dar tempo de reação, tarde o
// bastante pra estar fresco na cabeça — mesmo raciocínio do LEAD_MIN acima,
// só que numa faixa mais larga (aprovado no mockup como "30-40min antes").
const PREP_LEAD_MIN = 30;
const PREP_SCAN_AHEAD_MIN = 40;
const DESPESAS_JANELA_DIAS = 30;
// Despesa fora do padrão: varre despesas CRIADAS na última hora (não pela
// data do recibo — created_at), pra pegar o lançamento logo depois que o
// chefe confirma o registro (mockup aprovado 20/08/2026).
const DESPESA_ANOMALA_SCAN_MIN = 60;
const DESPESA_ANOMALA_MULTIPLICADOR = 2.5;
const DESPESA_ANOMALA_VALOR_MINIMO_CENTAVOS = 5000; // R$ 50 — piso pra não alertar gasto pequeno
const DESPESA_ANOMALA_AMOSTRA_MINIMA = 3; // categoria nova (menos que isso) nunca dispara
const DESPESA_ANOMALA_BASELINE_LIMITE = 30; // teto de linhas buscadas pra calcular a média
// Relação esfriando: alguém que você costuma se reunir sumiu da agenda. Sinal
// é PARTICIPANTE DE EVENTO (Calendar), não troca de mensagem — a Mia não vê a
// conversa de WhatsApp com terceiros, só a própria (mockup aprovado 20/08/2026).
const RELACAO_LOOKBACK_DIAS = 180; // 6 meses pra decidir quem é contato "regular"
const RELACAO_MIN_REUNIOES = 2; // encontro único não conta como relação a acompanhar
const RELACAO_MAX_PARTICIPANTES = 3; // inclui você — filtra reunião grande/all-hands
const RELACAO_GAP_MIN_DIAS = 35; // 5 semanas sem encontro
const RELACAO_MAX_CARDS_POR_EXECUCAO = 3; // resto fica pra fila do dia seguinte
const TZ = "America/Sao_Paulo";

const CALENDAR_BASE =
  "https://www.googleapis.com/calendar/v3/calendars/primary/events";

// ─── helpers de formatação ───────────────────────────────────────────────────

function fmtTime(iso: string): string {
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: TZ,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(iso));
}

function fmtDateTime(ms: number): string {
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: TZ,
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(ms));
}

// ─── /fast (reuso do loop de tools pra compor textos) ────────────────────────

async function askFast(prompt: string, env: EnvFn): Promise<string> {
  const url = env("SUPABASE_URL");
  const key = env("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) throw new Error("SUPABASE_URL/SERVICE_ROLE_KEY ausentes");
  const res = await fetch(`${url}/functions/v1/fast`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "apikey": key,
      "Authorization": `Bearer ${key}`,
    },
    // tenant_slug: /fast resolve o mesmo tenant e usa o Vault dele (Calendar
    // incluso) em vez do env global — ver fast/index.ts.
    body: JSON.stringify({ text: prompt, tenant_slug: DEFAULT_TENANT_SLUG }),
  });
  const data = (await res.json()) as { message?: string };
  return (data.message ?? "").trim();
}

// ─── Agenda (Google Calendar) ────────────────────────────────────────────────

interface UpcomingEvent {
  id: string;
  title: string;
  startISO: string;
  location: string | null;
}

async function getUpcoming(aheadMin: number, env: EnvFn): Promise<UpcomingEvent[]> {
  const token = await getGoogleAccessToken({ env, fetch });
  const now = new Date();
  const url = new URL(CALENDAR_BASE);
  url.searchParams.set("timeMin", now.toISOString());
  url.searchParams.set(
    "timeMax",
    new Date(now.getTime() + aheadMin * 60_000).toISOString(),
  );
  url.searchParams.set("singleEvents", "true");
  url.searchParams.set("orderBy", "startTime");

  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    throw new Error(`Calendar list ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  const data = (await res.json()) as {
    items?: Array<
      { id?: string; summary?: string; location?: string; start?: { dateTime?: string } }
    >;
  };
  return (data.items ?? [])
    .filter((e) => e.start?.dateTime)
    .map((e) => ({
      id: e.id ?? crypto.randomUUID(),
      title: e.summary ?? "(sem título)",
      startISO: e.start!.dateTime!,
      location: e.location ?? null,
    }));
}

// ─── Tasks proativas ─────────────────────────────────────────────────────────

// Tasks com prazo, no TaskProvider ativo (ClickUp/Notion/Trello/Google Tasks
// — ver TASK_PROVIDER), convertidas pro formato interno usado por
// runAlerts/runMarketing (due_date ISO → dueMs epoch, mais fácil de comparar).
interface TaskDue {
  id: string;
  name: string;
  dueMs: number;
  frente: string;
  /** Nem toda plataforma tem sub-lista (Notion/Google Tasks não têm). */
  list?: string;
  url: string;
}

async function getTasksWithDue(env: EnvFn): Promise<TaskDue[]> {
  const tasks = await getTaskProvider(env).listAllOpenTasksWithDue();
  return tasks.map((t) => ({
    id: t.id,
    name: t.name,
    dueMs: new Date(t.due_date!).getTime(),
    frente: t.frente,
    list: t.list,
    url: t.url,
  }));
}

// Lembretes de agenda: evento começando dentro de LEAD_MIN ainda não avisado.
async function runReminders(env: EnvFn, tenantId: string): Promise<{ sent: number; scanned: number }> {
  const sb = getSupabaseClient();
  const now = Date.now();
  const events = await getUpcoming(SCAN_AHEAD_MIN, env);
  let sent = 0;

  for (const ev of events) {
    const minsUntil = (new Date(ev.startISO).getTime() - now) / 60_000;
    if (minsUntil > LEAD_MIN || minsUntil < -1) continue;

    const { data: existing } = await sb
      .from("reminders_sent")
      .select("id")
      .eq("event_id", ev.id)
      .eq("event_start", ev.startISO)
      .limit(1);
    if (existing && existing.length > 0) continue;

    const loc = ev.location ? ` — ${ev.location}` : "";
    const mins = Math.max(0, Math.round(minsUntil));
    const text = `⏰ Em ~${mins} min: ${ev.title} (${fmtTime(ev.startISO)})${loc}`;
    await sendWhatsAppText(ownerJid(env), text, { fetch, env });
    await appendAssistantMessage(ownerJid(env), text, tenantId);
    await sb.from("reminders_sent").insert({ event_id: ev.id, event_start: ev.startISO, title: ev.title });
    sent++;
  }
  return { sent, scanned: events.length };
}

// ─── prep de reunião ────────────────────────────────────────────────────────

/** Nome de frente que aparece no título do evento — comparação simples por substring, sem acento-sensibilidade. */
function matchFrente(titulo: string, frentes: string[]): string | null {
  const alvo = titulo.toLowerCase();
  return frentes.find((f) => f.trim() && alvo.includes(f.trim().toLowerCase())) ?? null;
}

function formatBRL(centavos: number): string {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(centavos / 100);
}

/** "YYYY-MM-DD" de N dias atrás, em SP — pro filtro `gte` de data_despesa. */
function diasAtras(n: number): string {
  const d = new Date(Date.now() - n * 24 * 3600_000);
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(d);
}

interface DespesaResumo {
  id: string;
  valor_centavos: number;
  data_despesa: string;
  estabelecimento: string;
}

/**
 * Antes de uma reunião cujo título bate com uma frente do tenant, junta as
 * despesas recentes dessa frente — cruza agenda + despesas, sem tabela nova
 * (mockup aprovado 20/08/2026). Só dispara se achar despesa: reunião sem
 * gasto relacionado não gera card, pra não virar ruído (mesmo princípio do
 * conflito de agenda — card é exceção, não rotina).
 */
async function runPrepReuniao(
  env: EnvFn,
  tenantId: string,
  frentes: string[],
  dryRun = false,
): Promise<{ sent: number; scanned: number; motivo?: string; card_kb?: number }> {
  const sb = getSupabaseClient();
  const now = Date.now();
  const events = frentes.length > 0 ? await getUpcoming(PREP_SCAN_AHEAD_MIN, env) : [];

  const { CARD, caixaAcoes, cardShell, el, renderCardPngBase64 } = await import("../_shared/card.ts");

  function linhaDespesa(d: DespesaResumo): ReturnType<typeof el> {
    const dataCurta = new Intl.DateTimeFormat("pt-BR", { timeZone: TZ, day: "2-digit", month: "short" })
      .format(new Date(`${d.data_despesa}T12:00:00`)).replace(".", "");
    return el(
      "div",
      { display: "flex", gap: 12, alignItems: "center", padding: "9px 0", borderBottom: `1px solid ${CARD.line}` },
      el("div", { display: "flex", width: 62, fontSize: 17, color: CARD.mut }, dataCurta),
      el("div", { display: "flex", flex: 1, fontSize: 19, fontWeight: 600, color: CARD.fg }, d.estabelecimento),
      el("div", { display: "flex", fontSize: 17, color: CARD.mut }, formatBRL(d.valor_centavos)),
    );
  }

  async function montaCard(
    frente: string,
    tituloEvento: string,
    horaEvento: string,
    despesas: DespesaResumo[],
  ): Promise<{ png: string; total: number; texto: string }> {
    const total = despesas.reduce((s, d) => s + d.valor_centavos, 0);
    const linhas = despesas.slice(0, 3).map(linhaDespesa);
    const png = await renderCardPngBase64(
      cardShell(
        "PRÓXIMA REUNIÃO",
        tituloEvento,
        horaEvento,
        [
          el(
            "div",
            { display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 4 },
            el("div", { display: "flex", fontSize: 16, color: CARD.mut }, `gasto com ${frente} · últimos ${DESPESAS_JANELA_DIAS} dias`),
            el("div", { display: "flex", fontSize: 19, fontWeight: 700, color: CARD.fg }, formatBRL(total)),
          ),
          el("div", { display: "flex", flexDirection: "column" }, ...linhas),
          caixaAcoes(["Quer que eu prepare um resumo pra levar na reunião?"]),
        ],
        "sinal · agenda + despesas",
      ),
    );
    const texto = `Sua próxima reunião é "${tituloEvento}" (${horaEvento}) — vocês tiveram ` +
      `${despesas.length} despesa${despesas.length === 1 ? "" : "s"} com ${frente} nos últimos ` +
      `${DESPESAS_JANELA_DIAS} dias, total de ${formatBRL(total)}. Quer que eu prepare um resumo?`;
    return { png, total, texto };
  }

  let sent = 0;
  for (const ev of events) {
    const minsUntil = (new Date(ev.startISO).getTime() - now) / 60_000;
    if (minsUntil > PREP_SCAN_AHEAD_MIN || minsUntil < PREP_LEAD_MIN) continue;

    const frente = matchFrente(ev.title, frentes);
    if (!frente) continue;

    const chave = `${ev.id}-${ev.startISO}`;
    const { data: jaAvisado } = await sb
      .from("avisos_enviados")
      .select("id")
      .eq("tenant_id", tenantId)
      .eq("tipo", "prep_reuniao")
      .eq("chave", chave)
      .limit(1);
    if (jaAvisado && jaAvisado.length > 0) continue;

    const { data: despesasData } = await sb
      .from("despesas")
      .select("id, valor_centavos, data_despesa, estabelecimento")
      .eq("tenant_id", tenantId)
      .ilike("frente", frente)
      .gte("data_despesa", diasAtras(DESPESAS_JANELA_DIAS))
      .order("data_despesa", { ascending: false })
      .limit(10);
    const despesas = (despesasData ?? []) as DespesaResumo[];
    if (despesas.length === 0) continue;

    const { png, texto } = await montaCard(frente, ev.title, fmtTime(ev.startISO), despesas);
    const jid = ownerJid(env);
    await sendWhatsAppImage(jid, { base64: png, fileName: "prep-reuniao.png" }, { fetch, env });
    await sendWhatsAppText(jid, texto, { fetch, env });
    await appendAssistantMessage(jid, texto, tenantId);
    await sb.from("avisos_enviados").insert({ tenant_id: tenantId, tipo: "prep_reuniao", chave });
    sent++;
  }

  if (sent === 0 && dryRun) {
    // Sem evento real casando frente+despesa agora — renderiza um exemplo só
    // pra exercer o pipeline satori/resvg (mesmo motivo do runAgendaCheck).
    const exemplo: DespesaResumo[] = [
      { id: "x1", valor_centavos: 18000, data_despesa: diasAtras(2), estabelecimento: "Posto Shell — combustível" },
      { id: "x2", valor_centavos: 96000, data_despesa: diasAtras(8), estabelecimento: "Gráfica — material comercial" },
      { id: "x3", valor_centavos: 10000, data_despesa: diasAtras(15), estabelecimento: "Uber — visita cliente" },
    ];
    const { png } = await montaCard("Resibag", "Resibag · Alinhamento diário", "09:00", exemplo);
    return { sent: 0, scanned: events.length, motivo: "dry run — card renderizado, nada enviado", card_kb: Math.round(png.length * 0.75 / 1024) };
  }

  return { sent, scanned: events.length };
}

// ─── despesa fora do padrão ─────────────────────────────────────────────────

interface DespesaRecente {
  id: string;
  valor_centavos: number;
  data_despesa: string;
  estabelecimento: string;
  categoria: string;
  frente: string | null;
  created_at: string;
}

/**
 * Despesa lançada muito acima da média da própria categoria+frente — "a Mia
 * discordando ativamente, não só informando" (mockup aprovado 20/08/2026,
 * card nº 2 da lista de proativos retomada). Compara SÓ dentro da mesma
 * categoria+frente: categoria nova (menos de `DESPESA_ANOMALA_AMOSTRA_MINIMA`
 * despesas anteriores) nunca dispara — primeira vez não é "fora do padrão", é
 * "sem histórico ainda" pra comparar.
 */
async function runDespesaAnomala(
  env: EnvFn,
  tenantId: string,
  dryRun = false,
): Promise<{ sent: number; scanned: number; motivo?: string; card_kb?: number }> {
  const sb = getSupabaseClient();
  const desde = new Date(Date.now() - DESPESA_ANOMALA_SCAN_MIN * 60_000).toISOString();

  const { data: recentesData } = await sb
    .from("despesas")
    .select("id, valor_centavos, data_despesa, estabelecimento, categoria, frente, created_at")
    .eq("tenant_id", tenantId)
    .not("categoria", "is", null)
    .gte("created_at", desde)
    .order("created_at", { ascending: false })
    .limit(50);
  const recentes = (recentesData ?? []) as DespesaRecente[];

  const { barrasComparacao, CARD, caixaAcoes, cardShell, el, renderCardPngBase64 } = await import(
    "../_shared/card.ts"
  );

  function montaCard(
    d: DespesaRecente,
    mediaCentavos: number,
    amostra: number,
    multiplicador: number,
  ): ReturnType<typeof cardShell> {
    const dataCurta = new Intl.DateTimeFormat("pt-BR", { timeZone: TZ, day: "2-digit", month: "short" })
      .format(new Date(`${d.data_despesa}T12:00:00`)).replace(".", "");
    const rotuloMedia = d.frente ? `${d.categoria} · ${d.frente}` : d.categoria;
    return cardShell(
      "FORA DO PADRÃO",
      d.estabelecimento,
      dataCurta,
      [
        el(
          "div",
          { display: "flex", justifyContent: "space-between", marginBottom: 14 },
          el(
            "div",
            { display: "flex", flexDirection: "column" },
            el("div", { display: "flex", fontSize: 13, color: CARD.mut }, "REGISTRADO"),
            el("div", { display: "flex", fontSize: 25, fontWeight: 700, color: CARD.crit, marginTop: 3 }, formatBRL(d.valor_centavos)),
          ),
          el(
            "div",
            { display: "flex", flexDirection: "column", alignItems: "flex-end" },
            el("div", { display: "flex", fontSize: 13, color: CARD.mut }, `MÉDIA · ${rotuloMedia}`),
            el("div", { display: "flex", fontSize: 22, fontWeight: 600, color: CARD.mut, marginTop: 3 }, formatBRL(mediaCentavos)),
          ),
        ),
        barrasComparacao(
          { rotulo: "Este gasto", valor: d.valor_centavos, texto: formatBRL(d.valor_centavos) },
          { rotulo: `Média (${amostra})`, valor: mediaCentavos, texto: formatBRL(mediaCentavos) },
        ),
        el(
          "div",
          { display: "flex", fontSize: 16, fontWeight: 600, color: CARD.warn, marginTop: 4 },
          `${multiplicador.toFixed(1)}x acima da média das últimas ${amostra} despesas dessa categoria`,
        ),
        caixaAcoes([
          "Confere se o valor tá certo — não foi erro de leitura?",
          "Se for legítimo, quer que eu registre uma nota pra não alertar de novo nessa faixa?",
        ]),
      ],
      "sinal · despesas",
    );
  }

  let sent = 0;
  for (const d of recentes) {
    if (!d.categoria) continue;

    const { data: jaAvisado } = await sb
      .from("avisos_enviados")
      .select("id")
      .eq("tenant_id", tenantId)
      .eq("tipo", "despesa_anomala")
      .eq("chave", d.id)
      .limit(1);
    if (jaAvisado && jaAvisado.length > 0) continue;

    let baselineQuery = sb
      .from("despesas")
      .select("valor_centavos")
      .eq("tenant_id", tenantId)
      .eq("categoria", d.categoria)
      .neq("id", d.id)
      .order("data_despesa", { ascending: false })
      .limit(DESPESA_ANOMALA_BASELINE_LIMITE);
    baselineQuery = d.frente ? baselineQuery.eq("frente", d.frente) : baselineQuery.is("frente", null);
    const { data: baselineData } = await baselineQuery;
    const baseline = (baselineData ?? []) as Array<{ valor_centavos: number }>;
    if (baseline.length < DESPESA_ANOMALA_AMOSTRA_MINIMA) continue;
    if (d.valor_centavos < DESPESA_ANOMALA_VALOR_MINIMO_CENTAVOS) continue;

    const mediaCentavos = Math.round(baseline.reduce((s, b) => s + b.valor_centavos, 0) / baseline.length);
    const multiplicador = d.valor_centavos / mediaCentavos;
    if (multiplicador < DESPESA_ANOMALA_MULTIPLICADOR) continue;

    const png = await renderCardPngBase64(montaCard(d, mediaCentavos, baseline.length, multiplicador));
    const jid = ownerJid(env);
    const rotuloFrente = d.frente ? ` (frente ${d.frente})` : "";
    const dataFmt = new Intl.DateTimeFormat("pt-BR", { timeZone: TZ, day: "2-digit", month: "2-digit" })
      .format(new Date(`${d.data_despesa}T12:00:00`));
    const texto = `${d.estabelecimento}, ${formatBRL(d.valor_centavos)}, ${dataFmt}, categoria ${d.categoria}${rotuloFrente} — ` +
      `${multiplicador.toFixed(1)}x acima da média (${formatBRL(mediaCentavos)}). Confere se tá certo?`;
    await sendWhatsAppImage(jid, { base64: png, fileName: "despesa-anomala.png" }, { fetch, env });
    await sendWhatsAppText(jid, texto, { fetch, env });
    await appendAssistantMessage(jid, texto, tenantId);
    await sb.from("avisos_enviados").insert({ tenant_id: tenantId, tipo: "despesa_anomala", chave: d.id });
    sent++;
  }

  if (sent === 0 && dryRun) {
    // Sem despesa real batendo o limiar agora — renderiza um exemplo só pra
    // exercer o pipeline satori/resvg (mesmo motivo dos outros dry runs).
    const exemplo: DespesaRecente = {
      id: "exemplo",
      valor_centavos: 85000,
      data_despesa: diasAtras(0),
      estabelecimento: "Posto Ipiranga — viagem SP",
      categoria: "combustível",
      frente: "resibag",
      created_at: new Date().toISOString(),
    };
    const mediaExemplo = 18000;
    const png = await renderCardPngBase64(montaCard(exemplo, mediaExemplo, 5, exemplo.valor_centavos / mediaExemplo));
    return {
      sent: 0,
      scanned: recentes.length,
      motivo: "dry run — card renderizado, nada enviado",
      card_kb: Math.round(png.length * 0.75 / 1024),
    };
  }

  return { sent, scanned: recentes.length };
}

// ─── relação esfriando ──────────────────────────────────────────────────────

interface ContatoAgenda {
  email: string;
  nome: string | null;
  datas: Date[];
}

/**
 * Alguém que você costuma se REUNIR sumiu da agenda por um tempo. Sinal é
 * participante de evento do Calendar — NÃO troca de mensagem: a Mia não vê a
 * conversa de WhatsApp com terceiros, só a que ela mesma tem com você (mockup
 * aprovado 20/08/2026, escopo reduzido do item nº 3 da lista de proativos).
 * Só considera evento pequeno (≤ RELACAO_MAX_PARTICIPANTES, você incluído) —
 * reunião grande/all-hands não é sinal de relação pessoal.
 */
async function runRelacionamentoEsfriando(
  env: EnvFn,
  tenantId: string,
  dryRun = false,
): Promise<{ sent: number; candidatos: number; motivo?: string; card_kb?: number }> {
  const sb = getSupabaseClient();
  const agora = new Date();
  const desde = new Date(agora.getTime() - RELACAO_LOOKBACK_DIAS * 24 * 3600_000);
  const eventos = await getEventsBetween(desde.toISOString(), agora.toISOString(), {
    getAccessToken: () => getGoogleAccessToken({ env, fetch }),
    fetch,
    now: () => agora,
  });

  const porEmail = new Map<string, ContatoAgenda>();
  for (const ev of eventos) {
    // Teto de tamanho conta TODOS os participantes (você incluído) — um 1:1
    // tem 2. `attendees` já vem sem sala/equipamento (mapAttendees filtra).
    if (ev.attendees.length > RELACAO_MAX_PARTICIPANTES) continue;
    const data = new Date(ev.startISO);
    if (Number.isNaN(data.getTime())) continue;
    for (const p of ev.attendees) {
      if (p.eu) continue;
      const atual = porEmail.get(p.email) ?? { email: p.email, nome: p.nome, datas: [] };
      if (p.nome) atual.nome = p.nome; // fica com o nome mais recente que o Google mandou
      atual.datas.push(data);
      porEmail.set(p.email, atual);
    }
  }

  const ignorados = await listaRelacionamentosIgnorados(tenantId);
  const candidatos = [...porEmail.values()]
    .filter((c) => !ignorados.has(c.email))
    .filter((c) => c.datas.length >= RELACAO_MIN_REUNIOES)
    .map((c) => {
      const ultima = new Date(Math.max(...c.datas.map((d) => d.getTime())));
      const gapDias = Math.floor((agora.getTime() - ultima.getTime()) / 86_400_000);
      return { email: c.email, nome: c.nome, ultima, gapDias, totalReunioes: c.datas.length };
    })
    .filter((c) => c.gapDias >= RELACAO_GAP_MIN_DIAS)
    .sort((a, b) => b.gapDias - a.gapDias);

  const { CARD, caixaAcoes, cardShell, el, renderCardPngBase64 } = await import("../_shared/card.ts");

  function montaCard(
    nomeExibido: string,
    ultima: Date,
    gapDias: number,
    totalReunioes: number,
  ): ReturnType<typeof cardShell> {
    const dataCurta = new Intl.DateTimeFormat("pt-BR", { timeZone: TZ, day: "2-digit", month: "short" })
      .format(ultima).replace(".", "");
    const dataLonga = new Intl.DateTimeFormat("pt-BR", { timeZone: TZ, day: "2-digit", month: "long" }).format(ultima);
    const meses = Math.round(RELACAO_LOOKBACK_DIAS / 30);
    return cardShell(
      "ESFRIANDO",
      nomeExibido,
      dataCurta,
      [
        el(
          "div",
          { display: "flex", alignItems: "baseline", gap: 10, marginBottom: 8 },
          el("div", { display: "flex", fontSize: 36, fontWeight: 700, color: CARD.crit }, `${gapDias} dias`),
          el("div", { display: "flex", fontSize: 15, color: CARD.mut }, "sem reunião"),
        ),
        el(
          "div",
          { display: "flex", fontSize: 14, color: CARD.mut, marginBottom: 4 },
          `${totalReunioes} encontro${totalReunioes === 1 ? "" : "s"} nos últimos ${meses} meses — o último foi em ${dataLonga}`,
        ),
        caixaAcoes([`Quer que eu ajude a marcar um catch-up com ${nomeExibido}?`]),
      ],
      "sinal · sua agenda",
    );
  }

  let sent = 0;
  for (const c of candidatos.slice(0, RELACAO_MAX_CARDS_POR_EXECUCAO)) {
    // Chave = pessoa + data do último encontro: se vocês se encontrarem de
    // novo, a chave muda e o alerta "reseta" sozinho pro próximo gap.
    const chave = `${c.email}-${c.ultima.toISOString().slice(0, 10)}`;
    const { data: jaAvisado } = await sb
      .from("avisos_enviados")
      .select("id")
      .eq("tenant_id", tenantId)
      .eq("tipo", "relacionamento_esfriando")
      .eq("chave", chave)
      .limit(1);
    if (jaAvisado && jaAvisado.length > 0) continue;

    const nomeExibido = c.nome ?? c.email;
    const png = await renderCardPngBase64(montaCard(nomeExibido, c.ultima, c.gapDias, c.totalReunioes));
    const jid = ownerJid(env);
    const dataFmt = new Intl.DateTimeFormat("pt-BR", { timeZone: TZ, day: "2-digit", month: "2-digit" }).format(c.ultima);
    const texto = `${nomeExibido}, ${c.totalReunioes} reunião${c.totalReunioes === 1 ? "" : "ões"} nos últimos ` +
      `${Math.round(RELACAO_LOOKBACK_DIAS / 30)} meses, a última em ${dataFmt} — ${c.gapDias} dias atrás. ` +
      `Quer que eu ajude a remarcar?`;
    await sendWhatsAppImage(jid, { base64: png, fileName: "relacionamento-esfriando.png" }, { fetch, env });
    await sendWhatsAppText(jid, texto, { fetch, env });
    await appendAssistantMessage(jid, texto, tenantId);
    await sb.from("avisos_enviados").insert({ tenant_id: tenantId, tipo: "relacionamento_esfriando", chave });
    sent++;
  }

  if (sent === 0 && dryRun) {
    // Sem candidato real batendo o limiar agora — renderiza um exemplo só
    // pra exercer o pipeline satori/resvg (mesmo motivo dos outros dry runs).
    const exemploUltima = new Date(agora.getTime() - 40 * 24 * 3600_000);
    const png = await renderCardPngBase64(montaCard("Marina Costa", exemploUltima, 40, 4));
    return {
      sent: 0,
      candidatos: candidatos.length,
      motivo: "dry run — card renderizado, nada enviado",
      card_kb: Math.round(png.length * 0.75 / 1024),
    };
  }

  return { sent, candidatos: candidatos.length };
}

// Alertas de prazo: tasks Beehave vencidas ou vencendo nas próximas 24h.
async function runAlerts(env: EnvFn, tenantId: string): Promise<{ sent: number; scanned: number }> {
  const sb = getSupabaseClient();
  const now = Date.now();
  const tasks = await getTasksWithDue(env);
  let sent = 0;

  for (const t of tasks) {
    const overdue = t.dueMs < now;
    const dueSoon = t.dueMs >= now && t.dueMs <= now + ALERT_AHEAD_MS;
    if (!overdue && !dueSoon) continue;

    // Dedup por task + due (se o prazo muda, alerta de novo). Nome da tabela
    // é legado (era ClickUp-only) — dedup funciona igual pra qualquer provider.
    const { data: existing } = await sb
      .from("clickup_alerts_sent")
      .select("id")
      .eq("task_id", t.id)
      .eq("due_ms", t.dueMs)
      .limit(1);
    if (existing && existing.length > 0) continue;

    const quando = overdue ? `venceu ${fmtDateTime(t.dueMs)}` : `vence ${fmtDateTime(t.dueMs)}`;
    const icon = overdue ? "🔴" : "🟡";
    const label = t.list ? `${t.frente}/${t.list}` : t.frente;
    const text = `${icon} Prazo Beehave — ${label}: "${t.name}" ${quando}`;
    await sendWhatsAppText(ownerJid(env), text, { fetch, env });
    await appendAssistantMessage(ownerJid(env), text, tenantId);
    await sb.from("clickup_alerts_sent").insert({ task_id: t.id, due_ms: t.dueMs, name: t.name });
    sent++;
  }
  return { sent, scanned: tasks.length };
}

// Avisa novidade do produto (tabela `atualizacoes`, ver /novidades no site)
// uma vez só, como bloco separado antes do resumo — não fica repetindo.
//
// Primeira vez que calculamos isto pra um tenant (novidade_vista_em NULL):
// marca como visto até agora SEM anunciar nada. Quem está começando agora
// não viveu o "antes" das entradas antigas — despejar histórico só confunde.
async function buildNovidadeBlock(tenantId: string): Promise<string | null> {
  const sb = getSupabaseClient();

  const { data: tenantRow, error: tErr } = await sb
    .from("tenants")
    .select("novidade_vista_em")
    .eq("id", tenantId)
    .maybeSingle();
  if (tErr || !tenantRow) {
    console.error("[cron] brief: falha ao ler novidade_vista_em:", semDadoPessoal(tErr?.message));
    return null;
  }

  const { data: entradas, error: eErr } = await sb
    .from("atualizacoes")
    .select("descricao, publicado_em")
    .order("publicado_em", { ascending: true });
  if (eErr || !entradas || entradas.length === 0) {
    if (eErr) console.error("[cron] brief: falha ao ler atualizacoes:", semDadoPessoal(eErr.message));
    return null;
  }

  const vistoEm = tenantRow.novidade_vista_em as string | null;
  const maisRecente = entradas[entradas.length - 1].publicado_em as string;

  if (!vistoEm) {
    await sb.from("tenants").update({ novidade_vista_em: maisRecente }).eq("id", tenantId);
    return null;
  }

  const naoVistas = entradas.filter((e) => (e.publicado_em as string) > vistoEm);
  if (naoVistas.length === 0) return null;

  await sb.from("tenants").update({ novidade_vista_em: maisRecente }).eq("id", tenantId);

  return naoVistas.length === 1
    ? `✨ Novidade: ${naoVistas[0].descricao}`
    : `✨ Novidades:\n${naoVistas.map((e) => `• ${e.descricao}`).join("\n")}`;
}

// Oferta de confirmação: compromissos de hoje em que alguém ainda não respondeu
// ao convite. Ver _shared/confirmacoes.ts pra regra (e pro porquê de "talvez" e
// "recusou" NÃO entrarem).
//
// POR QUE ESTE BLOCO É DETERMINÍSTICO, e não escrito pelo /fast como o resumo:
// ele afirma um fato sobre TERCEIRO ("a Ana não confirmou"). Modelo alucinando
// aqui faria o chefe cobrar quem já tinha confirmado — constrangimento com
// cliente, causado por nós. Texto montado em código não inventa convidado.
//
// Hoje roda junto do brief da manhã, sobre os compromissos DO DIA. A versão
// melhor (véspera, ~18h30, sobre o dia seguinte) só depende de uma linha nova
// no pg_cron chamando este mesmo caminho — a regra e o formato já servem.
async function buildConfirmacoesBlock(env: EnvFn, tenantId: string): Promise<string | null> {
  const hoje = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());

  // Reusa o leitor do /fast (com o mapeamento de convidados já coberto por
  // teste) em vez de duplicar o fetch de calendário que existe em getUpcoming.
  const eventos = await getEventsByDate(hoje, {
    getAccessToken: () => getGoogleAccessToken({ env, fetch }),
    fetch,
    now: () => new Date(),
  });

  const { avisos, total } = pendentesDeConfirmacao(eventos);
  if (avisos.length === 0) return null;

  // A flag do tenant. Uma consulta, não uma por convidado.
  const sb = getSupabaseClient();
  const { data: tRow } = await sb
    .from("tenants")
    .select("envio_oficial, nome")
    .eq("id", tenantId)
    .maybeSingle();
  const tenantLigouEnvio = Boolean(tRow?.envio_oficial);
  const nomeDoChefe = typeof tRow?.nome === "string" ? firstNameSimples(tRow.nome) : "";

  const enviados: string[] = [];
  const pendentesDeLink: string[] = [];

  for (const aviso of avisos) {
    const semEnvio: string[] = [];

    for (const convidado of aviso.pendentes) {
      const quem = nomeCurto(convidado);

      // Sem contato cadastrado não existe telefone, e sem telefone não existe
      // envio. Cai no link, que é onde a Yuka pede o número.
      let contato = null;
      try {
        contato = await buscaContatoPorEmail(tenantId, convidado.email);
      } catch (err) {
        console.error("[cron] busca de contato falhou:", semDadoPessoal(err));
      }
      if (!contato) {
        semEnvio.push(quem);
        continue;
      }

      const decisao = await decideEnvio({
        tenantId,
        tenantLigouEnvio,
        telefoneE164: contato.telefone_e164,
        template: "confirmacao_compromisso",
        variaveis: {
          destinatario: quem,
          remetente: nomeDoChefe || "seu contato",
          compromisso: aviso.titulo,
          dia: "hoje",
          hora: aviso.hora ?? "o horário combinado",
        },
        origemContato: "participante_evento",
        eventoId: aviso.eventoId,
      }, {
        estaForaDaLista: naoEstaNaListaDeSaida,
        jaEnviou: jaEnviouTemplate,
        temCredencial: temCredencialMeta,
      });

      if (decisao.via === "pular") continue;
      if (decisao.via === "link") {
        semEnvio.push(quem);
        continue;
      }

      const r = await enviaTemplate(decisao.payload, {
        tenantId,
        telefoneE164: contato.telefone_e164,
        template: "confirmacao_compromisso",
        origemContato: "participante_evento",
        eventoId: aviso.eventoId,
      });
      if (r.ok) enviados.push(`${quem} (${aviso.titulo})`);
      else {
        // Falha de envio volta pro link — o compromisso continua sem confirmar,
        // e calar sobre isso seria pior que a falha.
        console.error("[cron] envio de confirmação falhou:", semDadoPessoal(r.motivo));
        semEnvio.push(quem);
      }
    }

    if (semEnvio.length > 0) {
      const hora = aviso.hora ? `${aviso.hora} · ` : "";
      pendentesDeLink.push(`• ${hora}${aviso.titulo} — ${semEnvio.join(", ")}`);
    }
  }

  const partes: string[] = [];

  if (enviados.length > 0) {
    partes.push(
      `✅ Já confirmei pra você:\n\n${enviados.map((e) => `• ${e}`).join("\n")}\n\n` +
        `Te aviso assim que responderem.`,
    );
  }

  if (pendentesDeLink.length > 0) {
    const sobrando = total - avisos.length;
    const rodape = sobrando > 0
      ? `\n(e mais ${sobrando} compromisso${sobrando === 1 ? "" : "s"} na mesma situação)`
      : "";
    partes.push(
      `⚠️ Ainda sem confirmação pra hoje:\n\n${pendentesDeLink.join("\n")}${rodape}\n\n` +
        `Quer que eu escreva a confirmação? É só dizer pra quem.`,
    );
  }

  return partes.length > 0 ? partes.join("\n\n———\n\n") : null;
}

/** Primeiro nome, sem depender do módulo de persona (que é do /fast). */
function firstNameSimples(nomeCompleto: string): string {
  return nomeCompleto.trim().split(/\s+/)[0] ?? "";
}

/** `DecisaoDeps.estaForaDaLista` — consulta global, sem tenant. */
async function naoEstaNaListaDeSaida(telefoneE164: string): Promise<boolean> {
  const sb = getSupabaseClient();
  const { data, error } = await sb
    .from("whatsapp_opt_out")
    .select("telefone_e164")
    .eq("telefone_e164", telefoneE164)
    .maybeSingle();
  // Erro PROPAGA de propósito: decideEnvio trata exceção como "cai no link".
  // Engolir aqui e devolver false faria o envio prosseguir sem ter verificado.
  if (error) throw new Error(error.message);
  return data !== null;
}

/** `DecisaoDeps.jaEnviou` — evita dois avisos do mesmo compromisso. */
async function jaEnviouTemplate(
  tenantId: string,
  telefoneE164: string,
  template: string,
  eventoId?: string,
): Promise<boolean> {
  const sb = getSupabaseClient();
  let q = sb
    .from("envios_whatsapp")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("telefone_e164", telefoneE164)
    .eq("template", template);
  q = eventoId ? q.eq("evento_id", eventoId) : q.is("evento_id", null);
  const { data, error } = await q.limit(1);
  if (error) throw new Error(error.message);
  return Array.isArray(data) && data.length > 0;
}

// Resumo diário: agenda + tarefas por cliente (via /fast) + notícias de setor
// (Resibag/Sanwey, últimos 3 dias via RSS — ver _shared/news.ts).
async function runBrief(env: EnvFn, tenantId: string): Promise<{ len: number }> {
  try {
    const novidade = await buildNovidadeBlock(tenantId);
    if (novidade) {
      await sendWhatsAppText(ownerJid(env), novidade, { fetch, env });
      await appendAssistantMessage(ownerJid(env), novidade, tenantId);
    }
  } catch (err) {
    console.error("[cron] brief: bloco de novidade falhou:", semDadoPessoal(err));
  }

  let newsBlock = "";
  try {
    newsBlock = await getSectorNewsBlock(NEWS_FRENTES);
  } catch (err) {
    console.error("[cron] brief: notícias falharam:", semDadoPessoal(err));
  }

  const prompt =
    "Monte meu resumo da manhã, conciso e em tópicos curtos. Inclua: " +
    "(1) os compromissos de hoje na minha agenda, com horário; " +
    "(2) por cliente da Beehave (Resibag, Sanwey): entregas/tarefas com prazo " +
    "pra hoje ou atrasadas, e reuniões pautadas; " +
    "(3) um resumo curto (2-4 linhas) das notícias mais relevantes de Resibag e " +
    "Sanwey com base SÓ nos dados abaixo — eles já vêm organizados por categoria " +
    "(gatilho regulatório, radar competitivo, sinal de demanda/risco); priorize " +
    "gatilho regulatório e sinal de demanda (viram janela de urgência comercial), " +
    "não invente nada além do que está listado, e se não houver nada relevante " +
    "diga isso em uma linha. " +
    "Se algum bloco estiver vazio, diga em uma linha. Não faça perguntas, só entregue." +
    (newsBlock ? `\n\nNOTÍCIAS DO SETOR (últimos dias, por categoria):\n${newsBlock}` : "");

  const text = await askFast(prompt, env) || "Sem itens pra hoje. Bom dia!";
  await sendWhatsAppText(ownerJid(env), text, { fetch, env });
  await appendAssistantMessage(ownerJid(env), text, tenantId);

  // Depois do resumo, e em try próprio: falha de calendário aqui não pode
  // derrubar um brief que já foi entregue com sucesso.
  try {
    const confirmacoes = await buildConfirmacoesBlock(env, tenantId);
    if (confirmacoes) {
      await sendWhatsAppText(ownerJid(env), confirmacoes, { fetch, env });
      // Vai pro histórico pra que, quando o chefe responder "pode escrever pra
      // Ana", o /fast saiba de qual reunião ele está falando.
      await appendAssistantMessage(ownerJid(env), confirmacoes, tenantId);
    }
  } catch (err) {
    console.error("[cron] brief: bloco de confirmações falhou:", semDadoPessoal(err));
  }

  return { len: text.length };
}

// Entrega roteada: escolhe o sender pelo canal embutido no user_id.
// WhatsApp usa o remoteJid (== user_id); Telegram extrai o chat_id de "tg:".
async function deliverTo(userId: string, text: string, env: EnvFn): Promise<void> {
  if (channelFromUserId(userId) === "telegram") {
    await sendTelegramMessage(telegramChatId(userId), text, { fetch, env });
  } else {
    await sendWhatsAppText(userId, text, { fetch, env });
  }
}

// Lembretes agendados: varre scheduled_reminders pendentes e vencidos.
// Cada um vira mensagem NO CANAL que o criou (user_id); marca sent_at p/ não repetir.
// Recorrentes (recurrence != null): depois de entregar, insere uma NOVA linha
// pendente com o próximo fire_at — a linha original fica marcada sent_at,
// preservando histórico de disparos.
async function runScheduled(env: EnvFn, tenantId: string): Promise<{ sent: number; scanned: number }> {
  const sb = getSupabaseClient();
  const nowISO = new Date().toISOString();

  // Só os lembretes DESTE tenant: sem o filtro, os lembretes que outros
  // usuários criaram eram entregues com as credenciais do dono da plataforma —
  // nunca chegavam ao destinatário certo, nunca eram marcados como enviados, e
  // reentravam no loop para sempre.
  const { data, error } = await sb
    .from("scheduled_reminders")
    .select("id, user_id, text, fire_at, recurrence")
    .eq("tenant_id", tenantId)
    .lte("fire_at", nowISO)
    .is("sent_at", null)
    .order("fire_at", { ascending: true })
    .limit(50);
  if (error) throw new Error(`scheduled_reminders load: ${error.message}`);

  const pending = (data ?? []) as Array<
    { id: string; user_id: string; text: string; fire_at: string; recurrence: RecurrenceType | null }
  >;
  let sent = 0;
  for (const r of pending) {
    try {
      await deliverTo(r.user_id, r.text, env);
      await appendAssistantMessage(r.user_id, r.text, tenantId);
      await sb
        .from("scheduled_reminders")
        .update({ sent_at: new Date().toISOString() })
        .eq("id", r.id);
      sent++;

      if (r.recurrence) {
        const next = nextOccurrence(new Date(r.fire_at), r.recurrence);
        const { error: insErr } = await sb.from("scheduled_reminders").insert({
          user_id: r.user_id,
          text: r.text,
          fire_at: next.toISOString(),
          recurrence: r.recurrence,
          tenant_id: tenantId,
        });
        if (insErr) {
          console.error(`[cron] recorrência '${r.id}' reagendar falhou:`, semDadoPessoal(insErr.message));
        }
      }
    } catch (err) {
      // Falha de envio: NÃO marca sent_at — próxima execução tenta de novo.
      console.error(`[cron] scheduled '${r.id}' send falhou:`, semDadoPessoal(err));
    }
  }
  return { sent, scanned: pending.length };
}

// Review semanal de marketing, por frente com GA4 configurado. Junta métricas
// do site (GA4) + entregas/prazos das tarefas e pede ao /fast uma análise:
// digest + otimizações acionáveis + cobrança em rascunho pra agência.
async function runMarketing(env: EnvFn, tenantId: string): Promise<{ sent: number; frentes: number }> {
  const map = tryLoadGa4Map(env);
  if (!map || Object.keys(map).length === 0) {
    return { sent: 0, frentes: 0 };
  }

  // Carrega as tasks com prazo uma vez e filtra por frente no loop.
  let allTasks: Awaited<ReturnType<typeof getTasksWithDue>> = [];
  try {
    allTasks = await getTasksWithDue(env);
  } catch (err) {
    console.error("[cron] marketing: tarefas falharam:", semDadoPessoal(err));
  }

  const owner = ownerJid(env);
  let sent = 0;
  const frentes = Object.keys(map);

  for (const frente of frentes) {
    let ga4Data: string;
    try {
      const snap = await getGa4Snapshot(frente, 28, {
        env,
        getAccessToken: () => getGoogleAccessToken({ env, fetch }),
        fetch,
      });
      ga4Data = JSON.stringify(snap);
    } catch (err) {
      ga4Data = `(GA4 indisponível: ${semDadoPessoal(err).slice(0, 120)})`;
    }

    const tasks = allTasks
      .filter((t) => t.frente.toLowerCase() === frente.toLowerCase())
      .map((t) => ({
        name: t.name,
        list: t.list,
        due: fmtDateTime(t.dueMs),
        overdue: t.dueMs < Date.now(),
      }));

    const prompt = `Você é a secretária do Daniel agindo como analista de marketing da frente "${frente}". ` +
      `Com base SÓ nos dados abaixo (NÃO invente números, NÃO chame ferramentas), monte um review semanal curto pro WhatsApp:\n` +
      `1) Digest do tráfego: 2-3 linhas citando sessões, variação % vs período anterior e principais canais.\n` +
      `2) 2-3 otimizações acionáveis, priorizando o que os dados sugerem (queda de canal, conversão, etc.).\n` +
      `3) Entregas: o que está atrasado ou vence essa semana. Se houver atraso, escreva um RASCUNHO curto de cobrança pra agência (Daniel revisa e envia).\n` +
      `Tom direto, pt-BR, sem encher linguiça. Se algum dado faltar, diga numa linha e siga.\n\n` +
      `DADOS GA4 (28 dias): ${ga4Data}\n\nENTREGAS: ${JSON.stringify(tasks)}`;

    try {
      const text = await askFast(prompt, env) || "Sem dados suficientes pro review essa semana.";
      const message = `📈 Review semanal — ${frente}\n\n${text}`;
      await sendWhatsAppText(owner, message, { fetch, env });
      await appendAssistantMessage(owner, message, tenantId);
      sent++;
    } catch (err) {
      console.error(`[cron] marketing '${frente}' falhou:`, semDadoPessoal(err));
    }
  }
  return { sent, frentes: frentes.length };
}

// Relatório semanal: panorama da Beehave (via /fast) + triagem de capturas
// rápidas paradas há mais de 7 dias (mesmo gatilho semanal, mensagem à parte
// — são assuntos diferentes: cliente da agência vs. inbox pessoal).
async function runWeekly(env: EnvFn, tenantId: string): Promise<{ len: number }> {
  const text = await askFast(
    "Monte um panorama da semana da Agência Beehave, em tópicos por cliente " +
      "(Resibag, Sanwey). Pra cada um liste as tarefas/entregas em aberto " +
      "com prazo nesta semana, o que está atrasado, e campanhas/pautas em andamento. " +
      "Seja objetivo, agrupe por cliente. Não faça perguntas, só entregue o panorama.",
    env,
  ) || "Sem itens em aberto na Beehave esta semana.";
  const panorama = `📊 Panorama da semana — Beehave\n\n${text}`;
  await sendWhatsAppText(ownerJid(env), panorama, { fetch, env });
  await appendAssistantMessage(ownerJid(env), panorama, tenantId);

  // Manutenção da memória de longo prazo — silenciosa, não vira mensagem.
  // Só toca em quem passou do limiar; pra maioria é um SELECT e nada mais.
  try {
    for (const userId of await listUsersParaConsolidar(tenantId)) {
      const r = await consolidateUserProfile(userId, defaultConsolidationDeps(tenantId));
      console.log(`[cron] perfil ${apelidoDeUsuario(userId)}: ${r.status} ${r.antes}→${r.depois}${r.motivo ? ` (${semDadoPessoal(r.motivo)})` : ""}`);
    }
  } catch (err) {
    console.error("[cron] consolidação de perfil falhou:", semDadoPessoal(err));
  }

  const stale = await getStaleCaptures(tenantId);
  if (stale.length > 0) {
    const lines = stale.map((c) => `• ${c.texto}`).join("\n");
    const staleMsg =
      `🗂️ Tem ${stale.length} nota(s) rápida(s) paradas há mais de 7 dias — quer que eu vire task, ou posso arquivar?\n\n${lines}`;
    await sendWhatsAppText(ownerJid(env), staleMsg, { fetch, env });
    await appendAssistantMessage(ownerJid(env), staleMsg, tenantId);
  }

  return { len: text.length };
}

// Capturas rápidas (save_quick_capture) sem triagem há mais de `days` dias —
// pra não deixar o inbox virar cemitério de notas esquecidas.
// Escopado pelo tenant dono da execução: sem o filtro, a triagem semanal
// levava as anotações de TODOS os usuários para o WhatsApp do dono da
// plataforma.
async function getStaleCaptures(tenantId: string, days = 7): Promise<Array<{ texto: string; ts: string }>> {
  const sb = getSupabaseClient();
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60_000).toISOString();
  const { data, error } = await sb
    .from("quick_capture")
    .select("texto, ts")
    .eq("tenant_id", tenantId)
    .eq("processado", false)
    .lt("ts", cutoff)
    .order("ts", { ascending: true })
    .limit(20);
  if (error) {
    console.error("[cron] stale captures load falhou:", semDadoPessoal(error.message));
    return [];
  }
  return (data ?? []) as Array<{ texto: string; ts: string }>;
}

// Recap de fim de dia: só com dados reais (tasks com prazo hoje que continuam
// abertas) — sem inventar o que foi concluído, isso o gerenciador de tarefas
// não devolve de forma confiável.
async function runEveningRecap(env: EnvFn, tenantId: string): Promise<{ len: number }> {
  const text = await askFast(
    "Monte meu recap de fim de dia, curto e em tópicos. Baseie-se SÓ nos dados " +
      "que você tem acesso (tarefas, agenda) — NÃO invente o que foi concluído " +
      "hoje, você não tem essa informação. Inclua: " +
      "(1) entregas/tarefas da Beehave (Resibag, Sanwey) que tinham prazo HOJE e " +
      "continuam abertas — pra cada uma, sugira reagendar pra amanhã ou pra quando " +
      "fizer sentido; " +
      "(2) se não sobrou nada em aberto com prazo hoje, diga isso e feche com um " +
      "reforço positivo curto (sem ser piegas). Tom direto, sem perguntas — só entregue.",
    env,
  ) || "Sem pendências de hoje em aberto. Bom descanso, chefe.";
  const message = `🌙 Recap do dia\n\n${text}`;
  await sendWhatsAppText(ownerJid(env), message, { fetch, env });
  await appendAssistantMessage(ownerJid(env), message, tenantId);
  return { len: text.length };
}

// ─── Agenda apertada (proativo por DETECÇÃO, não por horário) ───────────────
//
// Diferente de todo o resto deste arquivo: os outros proativos disparam porque
// deu a hora ("são 9h, manda o brief"). Este só fala quando ENCONTRA algo —
// uma sequência de reuniões coladas amanhã. Silêncio é o resultado normal.

/** Eventos com hora marcada (ignora dia-inteiro) num intervalo. */
async function getEventosEntre(deISO: string, ateISO: string, env: EnvFn): Promise<EventoAgenda[]> {
  const token = await getGoogleAccessToken({ env, fetch });
  const url = new URL(CALENDAR_BASE);
  url.searchParams.set("timeMin", deISO);
  url.searchParams.set("timeMax", ateISO);
  url.searchParams.set("singleEvents", "true");
  url.searchParams.set("orderBy", "startTime");

  const res = await fetch(url.toString(), { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`Calendar list ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = (await res.json()) as {
    items?: Array<{ summary?: string; start?: { dateTime?: string }; end?: { dateTime?: string } }>;
  };
  return (data.items ?? [])
    .filter((e) => e.start?.dateTime && e.end?.dateTime)
    .map((e) => ({
      titulo: e.summary ?? "(sem título)",
      inicio: new Date(e.start!.dateTime!),
      fim: new Date(e.end!.dateTime!),
    }));
}

// `dryRun` renderiza o card e devolve o tamanho SEM enviar nada. Existe pra
// validar que satori/resvg carregam no runtime — sem isso, a única forma de
// exercer o caminho de render é esperar uma agenda de verdade ficar apertada,
// e uma falha de import ficaria escondida por semanas.
async function runAgendaCheck(env: EnvFn, tenantId: string, dryRun = false): Promise<{ avisou: boolean; motivo?: string; card_kb?: number }> {
  // Janela: o dia de AMANHÃ inteiro, em SP. Roda de noite pra dar tempo de
  // reagir — avisar de manhã que o dia está impossível não ajuda em nada.
  const agora = new Date();
  const amanha = new Date(agora.getTime() + 24 * 3600_000);
  const y = Number(new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric" }).format(amanha));
  const mo = Number(new Intl.DateTimeFormat("en-CA", { timeZone: TZ, month: "2-digit" }).format(amanha));
  const d = Number(new Intl.DateTimeFormat("en-CA", { timeZone: TZ, day: "2-digit" }).format(amanha));
  const inicioDia = new Date(Date.UTC(y, mo - 1, d, 3, 0, 0)); // 00:00 SP = 03:00 UTC
  const fimDia = new Date(inicioDia.getTime() + 24 * 3600_000);

  const eventos = await getEventosEntre(inicioDia.toISOString(), fimDia.toISOString(), env);
  const real = detectaMaratona(eventos);
  // No dry run, sem maratona real, usa um exemplo só pra exercer o render.
  const maratona = real ?? (dryRun
    ? [
      { titulo: "Exemplo A", inicio: new Date(Date.now()), fim: new Date(Date.now() + 3600_000) },
      { titulo: "Exemplo B", inicio: new Date(Date.now() + 3600_000), fim: new Date(Date.now() + 7200_000) },
      { titulo: "Exemplo C", inicio: new Date(Date.now() + 7200_000), fim: new Date(Date.now() + 10800_000) },
    ]
    : null);
  if (!maratona) return { avisou: false, motivo: "agenda de amanhã sem sequência apertada" };

  const totalMin = (maratona[maratona.length - 1].fim.getTime() - maratona[0].inicio.getTime()) / 60_000;
  const fimMaratona = maratona[maratona.length - 1].fim;
  const dataCurta = new Intl.DateTimeFormat("pt-BR", { timeZone: TZ, day: "2-digit", month: "short" })
    .format(maratona[0].inicio).replace(".", "");

  // Almoço: a maratona atravessa a faixa 12h–13h30 sem deixar brecha?
  const horaFimSP = Number(new Intl.DateTimeFormat("pt-BR", { timeZone: TZ, hour: "2-digit", hour12: false }).format(fimMaratona));
  const comeuAlmoco = horaFimSP < 12;

  // Import preguiçoso: satori/resvg são pesados e só servem aqui. No topo,
  // uma falha de carregamento delas derrubaria TODAS as tarefas do cron
  // (brief, lembretes, alertas) — assim o estrago fica contido nesta.
  const { caixaAcoes, cardShell, el, linhaTimeline, renderCardPngBase64 } = await import(
    "../_shared/card.ts"
  );

  const linhas = maratona.map((ev, i) => {
    const hora = fmtTime(ev.inicio.toISOString());
    const dur = duracaoTexto((ev.fim.getTime() - ev.inicio.getTime()) / 60_000);
    const gapAnterior = i === 0
      ? dur
      : `${dur} · sem intervalo`;
    return linhaTimeline(hora, ev.titulo, gapAnterior, i === maratona.length - 1);
  });

  const acoes = [
    `${duracaoTexto(totalMin)} sem pausa${comeuAlmoco ? "" : ` e sem almoço até ${fmtTime(fimMaratona.toISOString())}`}.`,
    `Posso empurrar "${maratona[maratona.length - 1].titulo}" pra depois?`,
  ];

  const png = await renderCardPngBase64(
    cardShell(
      "AMANHÃ",
      `${maratona.length} compromissos seguidos`,
      dataCurta,
      [el("div", { display: "flex", flexDirection: "column" }, ...linhas), caixaAcoes(acoes)],
      "sinal · detectado na sua agenda",
    ),
  );

  if (dryRun) {
    return { avisou: false, motivo: "dry run — card renderizado, nada enviado", card_kb: Math.round(png.length * 0.75 / 1024) };
  }

  const jid = ownerJid(env);
  await sendWhatsAppImage(jid, { base64: png, fileName: "agenda-amanha.png" }, { fetch, env });

  // A bolha de texto NÃO é decoração: imagem não é buscável no WhatsApp, e é
  // ela que a pessoa consegue responder citando.
  const texto = `Amanhã você tem ${maratona.length} compromissos colados, das ` +
    `${fmtTime(maratona[0].inicio.toISOString())} às ${fmtTime(fimMaratona.toISOString())} — ` +
    `${duracaoTexto(totalMin)} sem pausa. Quer que eu empurre o último?`;
  await sendWhatsAppText(jid, texto, { fetch, env });
  await appendAssistantMessage(jid, texto, tenantId);

  return { avisou: true };
}

// ─── conflito de agenda ─────────────────────────────────────────────────────

/**
 * Chave de dedupe do conflito. Derivada dos horários, NÃO dos títulos: se a
 * pessoa renomear um compromisso, continua sendo o mesmo conflito e não vale
 * avisar de novo. Título também é dado da agenda dela — fora do banco de
 * controle, melhor.
 */
function chaveConflito(a: EventoAgenda, b: EventoAgenda): string {
  const [x, y] = [a.inicio.getTime(), b.inicio.getTime()].sort((p, q) => p - q);
  return `${x}-${y}`;
}

async function runConflitoCheck(
  env: EnvFn,
  tenantId: string,
  dryRun = false,
): Promise<{ avisou: boolean; motivo?: string; card_kb?: number }> {
  // Janela: de agora até o fim de amanhã. Conflito de daqui a duas semanas não
  // é urgente e ainda vai mudar de forma sozinho.
  const agora = new Date();
  const fimJanela = new Date(agora.getTime() + 48 * 3600_000);

  const eventos = await getEventosEntre(agora.toISOString(), fimJanela.toISOString(), env);
  const conflitos = detectaConflitos(eventos);
  const pior = conflitos[0] ?? (dryRun
    ? {
      a: { titulo: "Exemplo A", inicio: new Date(Date.now() + 3600_000), fim: new Date(Date.now() + 7200_000) },
      b: { titulo: "Exemplo B", inicio: new Date(Date.now() + 3600_000), fim: new Date(Date.now() + 5400_000) },
      sobreposicaoMin: 30,
    }
    : null);
  if (!pior) return { avisou: false, motivo: "nenhum conflito na agenda" };

  const chave = chaveConflito(pior.a, pior.b);
  const sb = getSupabaseClient();
  if (!dryRun) {
    const { data: jaAvisado } = await sb
      .from("avisos_enviados")
      .select("id")
      .eq("tenant_id", tenantId)
      .eq("tipo", "conflito_agenda")
      .eq("chave", chave)
      .limit(1);
    if (jaAvisado && jaAvisado.length > 0) {
      return { avisou: false, motivo: "conflito já avisado" };
    }
  }

  // Import preguiçoso, mesmo motivo do runAgendaCheck: satori/resvg são
  // pesadas e uma falha de carregamento delas no topo derrubaria todas as
  // outras tarefas do cron.
  const { caixaAcoes, cardShell, el, linhaConflito, renderCardPngBase64 } = await import(
    "../_shared/card.ts"
  );

  const inicioColisao = new Date(Math.max(pior.a.inicio.getTime(), pior.b.inicio.getTime()));
  const fimTardio = new Date(Math.max(pior.a.fim.getTime(), pior.b.fim.getTime()));
  // Teto pra sugestão de remarcação: 8h depois da colisão. Uma janela livre
  // às 23h é tecnicamente um buraco na agenda e uma péssima sugestão.
  const fimDoDia = new Date(inicioColisao.getTime() + 8 * 3600_000);
  const menor = pior.a.fim.getTime() - pior.a.inicio.getTime()
      <= pior.b.fim.getTime() - pior.b.inicio.getTime()
    ? pior.a
    : pior.b;
  const duracaoMenorMin = (menor.fim.getTime() - menor.inicio.getTime()) / 60_000;
  const buraco = primeiroBuraco(eventos, fimTardio, duracaoMenorMin, fimDoDia);

  const diaDaColisao = new Intl.DateTimeFormat("pt-BR", { timeZone: TZ, weekday: "long" })
    .format(inicioColisao)
    .toUpperCase();
  const dataCurta = new Intl.DateTimeFormat("pt-BR", { timeZone: TZ, day: "2-digit", month: "short" })
    .format(inicioColisao).replace(".", "");

  const linhas = [pior.a, pior.b].map((ev) =>
    linhaConflito(
      `${fmtTime(ev.inicio.toISOString())}–${fmtTime(ev.fim.toISOString())}`,
      ev.titulo,
      duracaoTexto((ev.fim.getTime() - ev.inicio.getTime()) / 60_000),
    )
  );

  const acoes = [
    `${duracaoTexto(pior.sobreposicaoMin)} de sobreposição.`,
    buraco
      ? `Empurro "${menor.titulo}" pras ${fmtTime(buraco.toISOString())}?`
      : `Quer que eu cancele ou remarque "${menor.titulo}"?`,
  ];

  const png = await renderCardPngBase64(
    cardShell(
      `CONFLITO · ${diaDaColisao}`,
      `Duas coisas às ${fmtTime(inicioColisao.toISOString())}`,
      dataCurta,
      [el("div", { display: "flex", flexDirection: "column" }, ...linhas), caixaAcoes(acoes)],
      "sinal · detectado na sua agenda",
    ),
  );

  if (dryRun) {
    return { avisou: false, motivo: "dry run — card renderizado, nada enviado", card_kb: Math.round(png.length * 0.75 / 1024) };
  }

  const jid = ownerJid(env);
  await sendWhatsAppImage(jid, { base64: png, fileName: "conflito-agenda.png" }, { fetch, env });
  const texto = `Você tem dois compromissos no mesmo horário: "${pior.a.titulo}" e ` +
    `"${pior.b.titulo}", às ${fmtTime(inicioColisao.toISOString())}. ` +
    (buraco ? `Posso empurrar o "${menor.titulo}" pras ${fmtTime(buraco.toISOString())}?` : "Quer que eu remarque um dos dois?");
  await sendWhatsAppText(jid, texto, { fetch, env });
  await appendAssistantMessage(jid, texto, tenantId);

  await sb.from("avisos_enviados").insert({ tenant_id: tenantId, tipo: "conflito_agenda", chave });
  return { avisou: true };
}

// ─── a semana à frente ──────────────────────────────────────────────────────

const ROTULOS_DIA = ["DOM", "SEG", "TER", "QUA", "QUI", "SEX", "SÁB"];

async function runSemanaCheck(env: EnvFn, tenantId: string, dryRun = false): Promise<{ avisou: boolean; motivo?: string; card_kb?: number }> {
  // Roda domingo à noite: a janela é a semana que começa amanhã.
  const agora = new Date();
  const y = Number(new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric" }).format(agora));
  const mo = Number(new Intl.DateTimeFormat("en-CA", { timeZone: TZ, month: "2-digit" }).format(agora));
  const d = Number(new Intl.DateTimeFormat("en-CA", { timeZone: TZ, day: "2-digit" }).format(agora));
  // 00:00 SP do dia seguinte = 03:00 UTC.
  const inicio = new Date(Date.UTC(y, mo - 1, d + 1, 3, 0, 0));
  const fim = new Date(inicio.getTime() + 7 * 24 * 3600_000);

  const eventos = await getEventosEntre(inicio.toISOString(), fim.toISOString(), env);
  const carga = cargaPorDia(eventos, inicio, 7);
  const totalCompromissos = carga.reduce((s, c) => s + c.compromissos, 0);
  if (totalCompromissos === 0 && !dryRun) {
    return { avisou: false, motivo: "semana sem compromisso — nada a dizer" };
  }

  const pesados = carga.filter((c) => c.minutosOcupados >= DIA_PESADO_MIN);
  const maisCheio = [...carga].sort((a, b) => b.minutosOcupados - a.minutosOcupados)[0];
  const maisVazio = [...carga]
    .filter((c) => c.diaSemana !== 0 && c.diaSemana !== 6)
    .sort((a, b) => a.minutosOcupados - b.minutosOcupados)[0];

  const { barrasSemana, caixaAcoes, cardShell, renderCardPngBase64 } = await import(
    "../_shared/card.ts"
  );

  const dias = carga.map((c) => ({
    rotulo: ROTULOS_DIA[c.diaSemana],
    minutos: c.minutosOcupados,
    pesado: c.minutosOcupados >= DIA_PESADO_MIN,
  }));

  const titulo = pesados.length === 0
    ? "Semana tranquila"
    : pesados.length === 1
    ? `${diaPorExtenso(pesados[0].diaSemana)} é o gargalo`
    : `${pesados.length} dias pesados`;

  const acoes: string[] = [
    `${duracaoTexto(maisCheio.minutosOcupados)} de compromisso ${diaPorExtenso(maisCheio.diaSemana).toLowerCase()}.`,
  ];
  if (maisVazio && maisVazio.minutosOcupados * 2 < maisCheio.minutosOcupados) {
    acoes.push(`${diaPorExtenso(maisVazio.diaSemana)} está aberta. Movo alguma coisa pra lá?`);
  }

  const periodo = `${new Intl.DateTimeFormat("pt-BR", { timeZone: TZ, day: "2-digit" }).format(inicio)}–` +
    `${new Intl.DateTimeFormat("pt-BR", { timeZone: TZ, day: "2-digit", month: "short" }).format(new Date(fim.getTime() - 1))}`
      .replace(".", "");

  const png = await renderCardPngBase64(
    cardShell("SEMANA QUE VEM", titulo, periodo, [barrasSemana(dias), caixaAcoes(acoes)], "sinal · sua semana"),
  );

  if (dryRun) {
    return { avisou: false, motivo: "dry run — card renderizado, nada enviado", card_kb: Math.round(png.length * 0.75 / 1024) };
  }

  const jid = ownerJid(env);
  await sendWhatsAppImage(jid, { base64: png, fileName: "semana.png" }, { fetch, env });
  const texto = `Sua semana tem ${totalCompromissos} compromisso${totalCompromissos === 1 ? "" : "s"}. ` +
    `${diaPorExtenso(maisCheio.diaSemana)} é o dia mais cheio, com ${duracaoTexto(maisCheio.minutosOcupados)}.` +
    (acoes.length > 1 ? ` ${acoes[1]}` : "");
  await sendWhatsAppText(jid, texto, { fetch, env });
  await appendAssistantMessage(jid, texto, tenantId);

  return { avisou: true };
}

function diaPorExtenso(diaSemana: number): string {
  return ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"][diaSemana];
}

// ─── tarefas atrasadas ──────────────────────────────────────────────────────

async function runAtrasadasCheck(env: EnvFn, tenantId: string, dryRun = false): Promise<{ avisou: boolean; motivo?: string; card_kb?: number }> {
  const agora = Date.now();
  const tarefas = await getTasksWithDue(env);
  const atrasadas = priorizaAtrasadas(
    tarefas
      .filter((t) => t.dueMs < agora)
      .map((t) => ({ titulo: t.name, diasAtraso: Math.floor((agora - t.dueMs) / 86_400_000) })),
  ) ?? (dryRun
    ? [
      { titulo: "Exemplo A", diasAtraso: 9 },
      { titulo: "Exemplo B", diasAtraso: 4 },
      { titulo: "Exemplo C", diasAtraso: 1 },
    ]
    : null);

  if (!atrasadas) {
    return { avisou: false, motivo: `menos de ${MIN_TAREFAS_ATRASADAS} tarefas atrasadas — silêncio` };
  }

  const { barrasAtraso, caixaAcoes, cardShell, renderCardPngBase64 } = await import(
    "../_shared/card.ts"
  );

  const pior = atrasadas[0];
  const dataCurta = new Intl.DateTimeFormat("pt-BR", { timeZone: TZ, day: "2-digit", month: "short" })
    .format(new Date()).replace(".", "");

  const png = await renderCardPngBase64(
    cardShell(
      "ATRASADAS",
      `${atrasadas.length} tarefa${atrasadas.length === 1 ? "" : "s"} venceu${atrasadas.length === 1 ? "" : "ram"}`,
      dataCurta,
      [
        barrasAtraso(atrasadas.map((t) => ({ titulo: t.titulo, dias: t.diasAtraso }))),
        caixaAcoes([
          pior.diasAtraso >= 7
            ? `"${pior.titulo}" já passou de uma semana.`
            : `A mais antiga está há ${pior.diasAtraso} dia${pior.diasAtraso === 1 ? "" : "s"} parada.`,
          "Quer remarcar os prazos ou fechar alguma?",
        ]),
      ],
      "sinal · suas tarefas",
    ),
  );

  if (dryRun) {
    return { avisou: false, motivo: "dry run — card renderizado, nada enviado", card_kb: Math.round(png.length * 0.75 / 1024) };
  }

  const jid = ownerJid(env);
  await sendWhatsAppImage(jid, { base64: png, fileName: "atrasadas.png" }, { fetch, env });
  const texto = `Você tem ${atrasadas.length} tarefa${atrasadas.length === 1 ? "" : "s"} atrasada${atrasadas.length === 1 ? "" : "s"}. ` +
    `A mais antiga é "${pior.titulo}", há ${pior.diasAtraso} dia${pior.diasAtraso === 1 ? "" : "s"}. ` +
    "Quer remarcar os prazos ou fechar alguma?";
  await sendWhatsAppText(jid, texto, { fetch, env });
  await appendAssistantMessage(jid, texto, tenantId);

  return { avisou: true };
}

// ─── aviso de cadastro novo (pro dono da plataforma) ────────────────────────

/**
 * Avisa o dono que alguém terminou o cadastro e está esperando aprovação.
 *
 * Só AVISA — aprovar acontece no /admin, atrás do login. Aprovação por
 * mensagem seria poder de administrador dentro de um canal de conversa: quem
 * pegasse o WhatsApp desbloqueado do dono liberaria quem quisesse.
 */
// Neutraliza marcação do WhatsApp (*negrito*, _itálico_, ~riscado~, `código`)
// e quebra de linha em texto que o PRÓPRIO usuário escolheu no cadastro —
// nome, cargo, frentes chegam aqui sem aprovação nenhuma ainda, então tratar
// como conteúdo hostil vale tanto quanto tratar e-mail de terceiro como tal.
// Sem isso, "nome" vira o lugar onde alguém tenta forjar uma linha de sistema
// dentro da notificação que o dono lê pra decidir se aprova.
function linhaSegura(texto: string, max = 80): string {
  return texto
    .replace(/[\r\n]+/g, " ")
    .replace(/[*_~`]/g, "")
    .trim()
    .slice(0, max);
}

async function runNovosCadastros(env: EnvFn): Promise<{ avisados: number }> {
  const sb = getSupabaseClient();
  const { data, error } = await sb
    .from("tenants")
    .select("id, slug, nome, cargo, frentes, channel_preference, auth_user_id, google_refresh_token_secret_id")
    .is("aprovado_em", null)
    .is("recusado_em", null)
    .is("avisado_em", null)
    .eq("active", true)
    .limit(20);
  if (error) throw new Error(`varredura de cadastros novos falhou: ${error.message}`);

  const pendentes = (data ?? []) as Array<{
    id: string;
    slug: string;
    nome: string | null;
    cargo: string | null;
    frentes: string[] | null;
    channel_preference: string | null;
    auth_user_id: string;
    google_refresh_token_secret_id: string | null;
  }>;
  if (pendentes.length === 0) return { avisados: 0 };

  const jid = ownerJid(env);
  let avisados = 0;
  for (const p of pendentes) {
    // Reivindica a linha ANTES de enviar, com UPDATE condicional — mesmo
    // padrão de authorizeTelegramChatId em _shared/tenant.ts. O wizard chama
    // esta task de forma best-effort e pode reenviar em paralelo (retry de
    // rede, duplo clique); sem essa corrida resolvida no banco, cada chamada
    // concorrente reenviaria o aviso pra TODOS os pendentes, não só pra quem
    // acabou de se cadastrar.
    const { data: reivindicado, error: claimErr } = await sb
      .from("tenants")
      .update({ avisado_em: new Date().toISOString() })
      .eq("id", p.id)
      .is("avisado_em", null)
      .select("id")
      .maybeSingle();
    if (claimErr) {
      console.error(`[cron] reivindicar aviso falhou (tenant ${p.id}): ${semDadoPessoal(claimErr.message)}`);
      continue;
    }
    if (!reivindicado) continue; // outra invocação já reivindicou esta linha

    // O e-mail não existe em `tenants` (mora em auth.users) e é o que faz o
    // dono RECONHECER quem se cadastrou — dois "João Silva" só se distinguem
    // por ele. Falha aqui não impede o aviso: nome já basta pra saber que tem
    // alguém esperando.
    let email = "";
    try {
      const { data: u } = await sb.auth.admin.getUserById(p.auth_user_id);
      email = u?.user?.email ?? "";
    } catch (err) {
      console.error(`[cron] e-mail do cadastro ${p.id} não carregou: ${semDadoPessoal(err)}`);
    }

    const nomeSeguro = p.nome?.trim() ? linhaSegura(p.nome) : "(sem nome)";
    const cargoSeguro = p.cargo?.trim() ? linhaSegura(p.cargo) : "";
    const frentesSeguras = (p.frentes ?? []).slice(0, 10).map((f) => linhaSegura(f, 40)).filter(Boolean);

    const linhas = [
      "🔔 *Cadastro novo esperando aprovação*",
      "",
      nomeSeguro,
      email,
      cargoSeguro ? `${cargoSeguro}${frentesSeguras.length ? ` · ${frentesSeguras.join(", ")}` : ""}` : "",
      "",
      `Google ${p.google_refresh_token_secret_id ? "conectado ✅" : "pendente"} · quer ${p.channel_preference ?? "—"}`,
      "",
      `Aprova em: ${Deno.env.get("APP_URL") ?? "https://sinal.app"}/admin`,
    ].filter((l) => l !== "");
    try {
      await sendWhatsAppText(jid, linhas.join("\n"), { fetch, env });
      avisados++;
    } catch (err) {
      // Envio falhou depois de reivindicado: libera de novo pra próxima
      // varredura tentar, em vez de perder o aviso em silêncio pra sempre.
      await sb.from("tenants").update({ avisado_em: null }).eq("id", p.id);
      console.error(`[cron] aviso de cadastro novo falhou (tenant ${p.id}): ${semDadoPessoal(err)}`);
    }
  }
  return { avisados };
}

// ─── feedback do usuário (bug reportado / melhoria sugerida) ────────────────
//
// Entram por dois caminhos (tool reportar_feedback no /fast, e o formulário do
// site) e os dois só GRAVAM a linha — o aviso sai daqui porque quem grava roda
// no env do tenant que reportou, que não tem a credencial de WhatsApp do dono
// da plataforma, e não deve ter.
//
// Mesmo padrão de runNovosCadastros: reivindica a linha com UPDATE condicional
// ANTES de enviar, pra duas execuções concorrentes (o site dispara na hora, o
// pg_cron varre de tempos em tempos) não mandarem o mesmo relato duas vezes.
const FEEDBACK_MAX_POR_EXECUCAO = 20;

const FEEDBACK_ROTULO: Record<string, string> = {
  bug: "🐞 *Problema reportado*",
  sugestao: "💡 *Sugestão*",
};

async function runFeedbackNovo(env: EnvFn): Promise<{ avisados: number }> {
  const sb = getSupabaseClient();
  const { data, error } = await sb
    .from("feedback")
    .select("id, tenant_id, tipo, canal, texto")
    .is("avisado_em", null)
    .order("criado_em", { ascending: true })
    .limit(FEEDBACK_MAX_POR_EXECUCAO);
  if (error) throw new Error(`varredura de feedback falhou: ${error.message}`);

  const pendentes = (data ?? []) as Array<{
    id: string;
    tenant_id: string;
    tipo: string;
    canal: string;
    texto: string;
  }>;
  if (pendentes.length === 0) return { avisados: 0 };

  // Nome de quem reportou, pra você saber de quem veio sem ter que consultar o
  // banco. Uma consulta só pros tenants envolvidos, não uma por linha.
  const nomePorTenant = new Map<string, string>();
  const { data: tenantsData } = await sb
    .from("tenants")
    .select("id, nome")
    .in("id", [...new Set(pendentes.map((p) => p.tenant_id))]);
  for (const t of (tenantsData ?? []) as Array<{ id: string; nome: string | null }>) {
    if (t.nome?.trim()) nomePorTenant.set(t.id, t.nome);
  }

  const jid = ownerJid(env);
  let avisados = 0;
  for (const f of pendentes) {
    const { data: reivindicado, error: claimErr } = await sb
      .from("feedback")
      .update({ avisado_em: new Date().toISOString() })
      .eq("id", f.id)
      .is("avisado_em", null)
      .select("id")
      .maybeSingle();
    if (claimErr) {
      console.error(`[cron] feedback ${f.id} não reivindicado: ${semDadoPessoal(claimErr.message)}`);
      continue;
    }
    if (!reivindicado) continue; // outra execução já pegou esta linha

    // linhaSegura corta e neutraliza — o texto é entrada não confiável do
    // usuário e vai pro WhatsApp do dono da plataforma.
    const quem = linhaSegura(nomePorTenant.get(f.tenant_id) ?? "(sem nome)", 80);
    const linhas = [
      FEEDBACK_ROTULO[f.tipo] ?? "*Feedback*",
      "",
      `De ${quem} · ${f.canal}`,
      "",
      linhaSegura(f.texto, 2000),
    ];
    try {
      await sendWhatsAppText(jid, linhas.join("\n"), { fetch, env });
      avisados++;
    } catch (err) {
      // Envio falhou depois de reivindicado: libera de novo pra próxima
      // varredura tentar, em vez de perder o relato em silêncio pra sempre.
      await sb.from("feedback").update({ avisado_em: null }).eq("id", f.id);
      console.error(`[cron] aviso de feedback ${f.id} falhou: ${semDadoPessoal(err)}`);
    }
  }
  return { avisados };
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json("Method Not Allowed", 405);

  // Sem trava, este endpoint era um botão público: qualquer um disparava
  // `brief`/`weekly`/`marketing` em loop — custo direto de API da Anthropic e
  // enxurrada de mensagens no WhatsApp do dono (brief, weekly, marketing e
  // evening_recap não têm proteção contra repetição).
  //
  // Exigir aqui não regride nada: os agendamentos do pg_cron autenticavam com
  // a chave publicável LEGADA, que foi desativada no projeto — ou seja, já
  // estavam falhando em silêncio. O SQL que reconfigura os agendamentos com a
  // chave correta acompanha esta mudança.
  if (!isInternalCall(req)) return respostaNaoAutorizado();

  let body: { task?: unknown } = {};
  try {
    body = await req.json();
  } catch { /* corpo vazio → erro abaixo */ }
  const task = typeof body.task === "string" ? body.task : "";

  try {
    const tenant = await getTenantBySlug(DEFAULT_TENANT_SLUG);
    if (!tenant) throw new Error(`tenant '${DEFAULT_TENANT_SLUG}' não encontrado`);
    const env = await buildTenantEnv(tenant);

    if (task === "reminders") return json({ ok: true, ...(await runReminders(env, tenant.id)) });
    if (task === "prep_reuniao") return json({ ok: true, ...(await runPrepReuniao(env, tenant.id, tenant.frentes)) });
    if (task === "prep_reuniao_dry") return json({ ok: true, ...(await runPrepReuniao(env, tenant.id, tenant.frentes, true)) });
    if (task === "despesa_anomala") return json({ ok: true, ...(await runDespesaAnomala(env, tenant.id)) });
    if (task === "despesa_anomala_dry") return json({ ok: true, ...(await runDespesaAnomala(env, tenant.id, true)) });
    if (task === "relacionamento_esfriando") return json({ ok: true, ...(await runRelacionamentoEsfriando(env, tenant.id)) });
    if (task === "relacionamento_esfriando_dry") return json({ ok: true, ...(await runRelacionamentoEsfriando(env, tenant.id, true)) });
    if (task === "alerts") return json({ ok: true, ...(await runAlerts(env, tenant.id)) });
    if (task === "brief") return json({ ok: true, ...(await runBrief(env, tenant.id)) });
    if (task === "weekly") return json({ ok: true, ...(await runWeekly(env, tenant.id)) });
    if (task === "scheduled") return json({ ok: true, ...(await runScheduled(env, tenant.id)) });
    if (task === "marketing") return json({ ok: true, ...(await runMarketing(env, tenant.id)) });
    if (task === "evening_recap") return json({ ok: true, ...(await runEveningRecap(env, tenant.id)) });
    if (task === "agenda_check") return json({ ok: true, ...(await runAgendaCheck(env, tenant.id)) });
    if (task === "agenda_check_dry") return json({ ok: true, ...(await runAgendaCheck(env, tenant.id, true)) });
    if (task === "conflito_check") return json({ ok: true, ...(await runConflitoCheck(env, tenant.id)) });
    if (task === "conflito_check_dry") return json({ ok: true, ...(await runConflitoCheck(env, tenant.id, true)) });
    if (task === "semana_check") return json({ ok: true, ...(await runSemanaCheck(env, tenant.id)) });
    if (task === "semana_check_dry") return json({ ok: true, ...(await runSemanaCheck(env, tenant.id, true)) });
    if (task === "atrasadas_check") return json({ ok: true, ...(await runAtrasadasCheck(env, tenant.id)) });
    if (task === "atrasadas_check_dry") return json({ ok: true, ...(await runAtrasadasCheck(env, tenant.id, true)) });
    if (task === "novos_cadastros") return json({ ok: true, ...(await runNovosCadastros(env)) });
    if (task === "feedback_novo") return json({ ok: true, ...(await runFeedbackNovo(env)) });
    return json({
      error: "task: reminders | prep_reuniao | despesa_anomala | relacionamento_esfriando | alerts | brief | weekly | " +
        "scheduled | marketing | evening_recap | agenda_check | conflito_check | semana_check | atrasadas_check | " +
        "novos_cadastros | feedback_novo",
    }, 400);
  } catch (err) {
    console.error(`[cron] task='${task}' erro:`, semDadoPessoal(err));
    return json({ error: semDadoPessoal(err) }, 500);
  }
});

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
