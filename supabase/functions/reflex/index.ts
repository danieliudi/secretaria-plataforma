import { getAnthropicClient } from "../_shared/anthropic.ts";
import { getSupabaseClient } from "../_shared/supabase.ts";
import { isInternalCall } from "../_shared/internal-auth.ts";
import type { Decision } from "../_shared/types.ts";
import { classifyWithHaiku, checkRegexReflex } from "../_shared/router.ts";
import { callFastEndpoint } from "../_shared/fast-proxy.ts";
import {
  hasEvolutionConfig,
  sendWhatsAppAudio,
  sendWhatsAppMessages,
  sendWhatsAppText,
  splitMessages,
  type WhatsAppDeps,
} from "../_shared/whatsapp.ts";
import { deveResponderEmAudio } from "../_shared/audio-reply.ts";
import { synthesizeSpeech } from "../_shared/google-tts.ts";
import { orchestrateReflex, type OrchestratorDeps, parseReflexIntent } from "./orchestrator.ts";
import { semDadoPessoal } from "../_shared/log-seguro.ts";
import {
  buildTenantEnv,
  consumeWhatsAppLinkCode,
  DEFAULT_TENANT_SLUG,
  getTenantByAuthorizedPhone,
  numeroAguardandoAprovacao,
  getTenantByWhatsAppInstance,
  getTenantBySlug,
  normalizeWhatsAppJidToE164,
  type Tenant,
} from "../_shared/tenant.ts";

// Ack imediato devolvido no fast-tier quando a entrega é assíncrona.
const FAST_ACK = "Só um instante…";
// Timeout do fast quando processado em background (não preso ao webhook).
const FAST_BG_TIMEOUT_MS = 90_000;

function todayStart(): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

// TODA query aqui é escopada por `tenantId`. Antes destas tabelas ganharem
// dono, o tier reflex era global: `one thing?` devolvia a prioridade de
// qualquer usuário, `tomei remédio` lia a medicação de todos e registrava a
// tomada no cadastro alheio, `água 500` somava o dia de todo mundo junto. Os
// gatilhos são expressões de uma palavra — acontecia sem intenção nenhuma.
function buildDeps(tenantId: string): OrchestratorDeps {
  const sb = getSupabaseClient();
  getAnthropicClient(); // valida ANTHROPIC_API_KEY no boot

  return {
    water: {
      insert: (data) => sb.from("health_log").insert({ ...data, tenant_id: tenantId }),
      sumToday: async () => {
        const { data } = await sb
          .from("health_log")
          .select("valor")
          .eq("tenant_id", tenantId)
          .eq("tipo", "agua")
          .gte("ts", todayStart());
        return (data ?? []).reduce((s: number, r: { valor: number }) => s + (r.valor ?? 0), 0);
      },
    },
    sleep: {
      insert: (data) => sb.from("habit_log").insert({ ...data, tenant_id: tenantId }),
    },
    treino: {
      insert: (data) => sb.from("treino_log").insert({ ...data, tenant_id: tenantId }),
    },
    medication: {
      now: () => new Date().toTimeString().slice(0, 5),
      findActive: async () => {
        const { data } = await sb
          .from("medication_schedule")
          .select("*")
          .eq("tenant_id", tenantId)
          .eq("ativo", true);
        return data ?? [];
      },
      logIntake: (scheduleId, remedio, dose) =>
        sb.from("medication_log").insert({ schedule_id: scheduleId, remedio, dose, tenant_id: tenantId }),
    },
    oneThingWrite: {
      insert: (data) => sb.from("one_thing").insert({ ...data, tenant_id: tenantId }),
      today: () => new Date().toISOString().slice(0, 10),
    },
    oneThingRead: {
      findCurrent: async (escopo) => {
        const { data } = await sb
          .from("one_thing")
          .select("texto")
          .eq("tenant_id", tenantId)
          .eq("escopo", escopo)
          .eq("status", "aberto")
          .order("created_at", { ascending: false })
          .limit(1);
        return data?.[0]?.texto ?? null;
      },
    },
    quickCapture: {
      insert: (data) => sb.from("quick_capture").insert({ ...data, tenant_id: tenantId }),
    },
    // Calendar (2B.7) e ClickUp (2D) viraram tools no /fast — não mais aqui.
  };
}

async function classify(text: string): Promise<Decision> {
  if (checkRegexReflex(text)) {
    return {
      tier: "reflex",
      frente: "pessoal",
      domain: "saude",
      action_required: true,
      irreversible: false,
      confidence: 1.0,
    };
  }
  const decision = await classifyWithHaiku(text);
  // Safety net: Haiku às vezes classifica saudações/conversas como reflex.
  // Se não há padrão parseável, foi misclassificação — escala pra fast.
  if (decision.tier === "reflex" && parseReflexIntent(text).type === "unknown") {
    return { ...decision, tier: "fast" };
  }
  return decision;
}

// Roteamento por tenant (fase 2 — PREPARADO): resolve o tenant pela
// `instance` da Evolution (quando o n8n passar a mandar). Usado tanto pro
// envio (WhatsAppDeps) quanto pro /fast usar as MESMAS credenciais nas tools
// (calendar/tarefas/GA4) — ver tenantSlug em callFastEndpoint. Qualquer falha
// (DB fora do ar, tenant não achado) cai em `null` — sendWhatsAppMessages e
// /fast usam os defaults (env global, comportamento de antes desta mudança).
async function resolveTenant(instance?: string): Promise<Tenant | null> {
  try {
    if (instance) {
      const tenant = await getTenantByWhatsAppInstance(instance);
      if (tenant) return tenant;
      console.error(`[reflex] instance '${instance}' não encontrada/inativa — usando fallback`);
    }
    return await getTenantBySlug(DEFAULT_TENANT_SLUG);
  } catch (err) {
    console.error(`[reflex] resolveTenant falhou, seguindo com env global: ${semDadoPessoal(err)}`);
    return null;
  }
}

// ─── Número compartilhado da plataforma (self-serve, autorização por telefone) ─
//
// Mensagens chegadas pela instância Evolution COMPARTILHADA (não a instância
// pessoal/dedicada de um tenant) roteiam por QUEM MANDOU (`from`), não por
// QUAL instância recebeu — o inverso do roteamento por instância acima.
// Autorização é estrita e deliberadamente diferente do padrão de
// resolveTenant: sem número vinculado (whatsapp_authorized_number) e sem
// código de vínculo batendo, a mensagem NUNCA chega no classify/Haiku/Sonnet
// nem em dado de tenant nenhum — só uma resposta de recusa/instrução. Cair
// no tenant do Daniel (como resolveTenant faz) seria o comportamento ERRADO
// aqui: vazaria contexto de um tenant pra quem não vinculou o próprio número.
//
// Número compartilhado = a mesma instância/número que o Daniel já usa (não
// um número novo — decisão dele: reusar em vez de comprar um dedicado só
// pra plataforma). Por isso PLATFORM_EVOLUTION_INSTANCE/_API_KEY são
// opcionais e caem no EVOLUTION_INSTANCE/EVOLUTION_API_KEY globais (ver
// platformEvolutionInstance/platformSendEnv) — nenhum secret novo precisa
// existir.
//
// Isso significa que esse branch NÃO fica mais inerte por falta de
// instância própria — só falta uma coisa: o workflow do n8n passar a mandar
// `instance` no corpo pro reflex (hoje só manda {text, from}). Até lá,
// `instance` nunca chega no body e esse branch nunca executa — zero mudança
// de comportamento pro tráfego atual. QUANDO o n8n for editado, TODO o
// tráfego do Daniel passa a rotear por aqui — inclusive as mensagens dele
// mesmo, que por isso precisam ter whatsapp_authorized_number preenchido no
// próprio tenant `daniel` ANTES do n8n mudar, senão ele fica bloqueado do
// próprio bot.

const LINK_HELP_MESSAGE =
  "Esse número ainda não está vinculado a nenhuma conta. Acessa a plataforma pra configurar sua secretária — no fim do cadastro aparece um código, é só colar aqui.";
const LINK_INVALID_MESSAGE =
  "Esse código não é válido ou já venceu. Gera um novo na tela de WhatsApp do cadastro e manda de novo.";
const LINK_SUCCESS_MESSAGE =
  "✅ Pronto, esse WhatsApp já está vinculado à sua secretária! Pode me chamar quando quiser.";
// Não promete prazo e não manda refazer nada — a pessoa já fez a parte dela.
const ACCESS_PENDING_MESSAGE =
  "Seu acesso à secretária está pausado no momento. Sua configuração está salva — quando for liberado, é só me chamar aqui de novo.";

/**
 * KILLSWITCH TEMPORÁRIO (05/08): voltado a exigir PLATFORM_EVOLUTION_INSTANCE
 * explícito — sem fallback pro EVOLUTION_INSTANCE global — porque o backfill
 * inicial de whatsapp_authorized_number do tenant `daniel` usou o número
 * ERRADO (o número QUE RECEBE as mensagens — a própria secretária — em vez
 * do número pessoal do Daniel que MANDA as mensagens). Com o fallback
 * ativo + n8n já publicado repassando `instance`, isso bloqueou o próprio
 * Daniel da própria secretária. Reverter aqui é o killswitch mais rápido
 * (não depende de achar/restaurar versão antiga do workflow do n8n).
 * Plano: assim que tiver o número pessoal certo, backfillar de novo e
 * reativar o fallback (só remover o comentário acima e trocar a linha por
 * `Deno.env.get("PLATFORM_EVOLUTION_INSTANCE") || Deno.env.get("EVOLUTION_INSTANCE") || undefined`).
 */
function platformEvolutionInstance(): string | undefined {
  return Deno.env.get("PLATFORM_EVOLUTION_INSTANCE") || undefined;
}

/** env(k) que força o envio pra instância compartilhada, mantendo o resto (persona/tarefas/calendário) do tenant. */
function platformSendEnv(tenantEnv: (key: string) => string | undefined): (key: string) => string | undefined {
  const platformInstance = platformEvolutionInstance();
  const platformApiKey = Deno.env.get("PLATFORM_EVOLUTION_API_KEY");
  return (key: string): string | undefined => {
    // A instância compartilhada é da PLATAFORMA, então o fallback aqui é o env
    // global — não `tenantEnv`. Desde que `buildTenantEnv` parou de deixar
    // qualquer tenant herdar EVOLUTION_* (credencial pessoal do dono), passar
    // por tenantEnv devolveria undefined pra todo usuário novo e quebraria o
    // envio pelo número único.
    if (key === "EVOLUTION_INSTANCE") return platformInstance ?? Deno.env.get("EVOLUTION_INSTANCE");
    if (key === "EVOLUTION_API_KEY") return platformApiKey ?? Deno.env.get("EVOLUTION_API_KEY");
    return tenantEnv(key);
  };
}

/**
 * tenant.whatsapp_evolution_instance é NULL pra tenant autorizado por
 * telefone (não tem instância dedicada própria) — buildTenantEnv sozinho
 * cairia no EVOLUTION_* global (hoje a instância pessoal do Daniel). Isso
 * força pra instância compartilhada em cima do resto do env do tenant.
 */
async function buildSharedNumberEnv(tenant: Tenant): Promise<(key: string) => string | undefined> {
  return platformSendEnv(await buildTenantEnv(tenant));
}

async function replyOnSharedNumber(to: string, text: string): Promise<void> {
  await sendWhatsAppText(to, text, { fetch, env: platformSendEnv((k) => Deno.env.get(k)) });
}

/** Processa uma mensagem chegada pela instância compartilhada. Sempre resolve com 200 — quem chama (n8n) não trata erro; falhas de envio só logam. */
/**
 * Manda a resposta em áudio (se decidido) ou texto (padrão) — nunca perde a
 * resposta: se a síntese ou o envio de áudio falhar por qualquer motivo, cai
 * pra texto em vez de deixar a pessoa sem resposta nenhuma.
 */
async function entregarRespostaWhatsApp(
  to: string,
  mensagem: string,
  emAudio: boolean,
  deps: WhatsAppDeps,
): Promise<void> {
  if (emAudio) {
    try {
      const audio = await synthesizeSpeech(mensagem, deps);
      await sendWhatsAppAudio(to, audio, deps);
      return;
    } catch (err) {
      console.error(`[reflex] resposta em áudio falhou, caindo pra texto: ${semDadoPessoal(err)}`);
    }
  }
  await sendWhatsAppMessages(to, splitMessages(mensagem), deps);
}

async function handleSharedNumberMessage(
  text: string,
  fromRaw: string | undefined,
  entradaEraAudio: boolean,
): Promise<Response> {
  if (!fromRaw) return resp({ ok: true }, 200);
  const fromE164 = normalizeWhatsAppJidToE164(fromRaw);
  if (!fromE164) return resp({ ok: true }, 200); // grupo ou remetente não-parseável — ignora, sem gerar dado nenhum

  let tenant: Tenant | null;
  try {
    tenant = await getTenantByAuthorizedPhone(fromE164);
  } catch (err) {
    console.error(`[reflex] getTenantByAuthorizedPhone falhou: ${semDadoPessoal(err)}`);
    return resp({ ok: true }, 200);
  }

  if (!tenant) {
    // Antes de tratar como desconhecido: este número pode já estar vinculado a
    // uma conta que só não foi aprovada ainda. Mandar essa pessoa "se
    // cadastrar" seria pedir que ela refaça o que já fez.
    let pausado = false;
    try {
      pausado = await numeroAguardandoAprovacao(fromE164);
    } catch (err) {
      console.error(`[reflex] numeroAguardandoAprovacao falhou: ${semDadoPessoal(err)}`);
    }
    if (pausado) {
      try {
        await replyOnSharedNumber(fromRaw, ACCESS_PENDING_MESSAGE);
      } catch (err) {
        console.error(`[reflex] resposta de acesso pausado falhou: ${semDadoPessoal(err)}`);
      }
      return resp({ ok: true }, 200);
    }

    let linked: Tenant | null = null;
    try {
      linked = await consumeWhatsAppLinkCode(text, fromE164);
    } catch (err) {
      console.error(`[reflex] consumeWhatsAppLinkCode falhou: ${semDadoPessoal(err)}`);
    }
    try {
      if (linked) {
        await replyOnSharedNumber(fromRaw, LINK_SUCCESS_MESSAGE);
      } else {
        const looksLikeCodeAttempt = /^[A-Z0-9]{4,8}$/i.test(text.trim());
        await replyOnSharedNumber(fromRaw, looksLikeCodeAttempt ? LINK_INVALID_MESSAGE : LINK_HELP_MESSAGE);
      }
    } catch (err) {
      console.error(`[reflex] resposta de vínculo/recusa falhou: ${semDadoPessoal(err)}`);
    }
    return resp({ ok: true }, 200);
  }

  // Autorizado — mesmo fluxo de sempre (classify → tier → /fast), com o
  // tenant já resolvido (sem reconsultar) e o envio forçado pra instância
  // compartilhada em vez do EVOLUTION_* global.
  let decision: Decision;
  try {
    decision = await classify(text);
    if (decision.tier === "deep") decision = { ...decision, tier: "fast" };
  } catch (err) {
    console.error(`[reflex] classify falhou (número compartilhado): ${semDadoPessoal(err)}`);
    decision = { tier: "fast", frente: "ambiguo", domain: "outro", action_required: false, irreversible: false, confidence: 0 };
  }

  if (decision.tier === "reflex") {
    // `tenant` aqui é quem o número autorizado identificou — nunca um default.
    const result = await orchestrateReflex(text, decision, buildDeps(tenant.id));
    return resp(result, 200);
  }

  const deliver = (async () => {
    try {
      const result = await callFastEndpoint({
        text,
        decision,
        from: fromRaw,
        timeoutMs: FAST_BG_TIMEOUT_MS,
        tenantSlug: tenant.slug,
      });
      const whatsappDeps: WhatsAppDeps = { fetch, env: await buildSharedNumberEnv(tenant) };
      await entregarRespostaWhatsApp(
        fromRaw,
        result.message,
        deveResponderEmAudio(entradaEraAudio, tenant.resposta_audio_sempre),
        whatsappDeps,
      );
    } catch (err) {
      console.error(`[reflex] entrega (número compartilhado) falhou: ${semDadoPessoal(err)}`);
    }
  })();
  (globalThis as { EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void } })
    .EdgeRuntime?.waitUntil?.(deliver);
  return resp({ ok: true, message: FAST_ACK }, 200);
}

// ─── fim do bloco número compartilhado ──────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return resp("Method Not Allowed", 405);

  // MODO OBSERVAÇÃO (10/08/2026) — passo intermediário antes de exigir chamada
  // interna aqui como já se exige no /fast.
  //
  // O n8n chama este endpoint com a credencial "Supabase service_role", mas não
  // dá pra ler o valor dela pelo painel nem pela API — e o WhatsApp do dono é
  // uso diário. Então: por enquanto só REGISTRA se bloquearia, e deixa passar.
  // Com uma mensagem real, `auth_observe` no async_debug responde se a
  // credencial bate. Sem linha nova = bate, e aí isto vira bloqueio de fato.
  if (!isInternalCall(req)) {
    try {
      await getSupabaseClient()
        .from("async_debug")
        .insert({ step: "auth_observe", detail: "reflex: chamador NAO passaria na trava interna" });
    } catch { /* observabilidade não pode derrubar o request */ }
  }

  let body: { text?: unknown; from?: unknown; instance?: unknown; kind?: unknown };
  try { body = await req.json(); } catch { return resp({ error: "Invalid JSON" }, 400); }

  if (!body.text || typeof body.text !== "string") {
    return resp({ error: "Missing 'text' field" }, 400);
  }
  // Teto de tamanho: sem ele, um payload gigante vira uma chamada de
  // classificador cara E uma linha enorme persistida pra sempre em
  // conversation_history. 4000 chars é folgado pra qualquer mensagem humana
  // de WhatsApp (inclusive uma transcrição de áudio longa) — trunca em vez de
  // recusar, pra não quebrar o caso raro de mensagem legítima longa demais.
  const MAX_TEXT_LEN = 4000;
  const text = body.text.length > MAX_TEXT_LEN ? body.text.slice(0, MAX_TEXT_LEN) : body.text;

  // Trim defensivo — n8n já manda limpo, mas whitespace acidental não pode
  // virar um remetente distinto (memória) nem quebrar o número da Evolution.
  const fromRaw = typeof body.from === "string" ? body.from.trim() : "";
  const from = fromRaw.length > 0 ? fromRaw : undefined;

  // Roteamento por tenant (fase 2 — PREPARADO, não ativo de fato ainda): a
  // Evolution manda `instance` no webhook bruto, mas o workflow do n8n hoje
  // NÃO repassa esse campo pro corpo que chega aqui — precisa mudar o n8n pra
  // isso ativar de verdade. Sem `instance` no body, cai sempre no tenant do
  // Daniel (comportamento idêntico ao de antes desta mudança).
  const instanceRaw = typeof body.instance === "string" ? body.instance.trim() : "";
  const instance = instanceRaw.length > 0 ? instanceRaw : undefined;

  // `kind` ("text"|"audio"|"image") vem do node "Extract Message" do workflow
  // do n8n, repassado pelo node "Call Edge Function" — decide se a resposta
  // espelha em áudio (ver _shared/audio-reply.ts). Sem o campo (n8n mais
  // antigo, ou outro chamador), cai em "não sei" — nunca assume áudio por
  // falta de informação.
  const entradaEraAudio = body.kind === "audio";

  // Número compartilhado: roteamento por quem mandou, não por instância. Ver
  // comentário grande acima de handleSharedNumberMessage — só ativa quando
  // PLATFORM_EVOLUTION_INSTANCE estiver setado E bater com o `instance` do
  // corpo; nenhuma das duas condições é verdadeira hoje.
  const platformInstance = platformEvolutionInstance();
  if (platformInstance && instance === platformInstance) {
    try {
      return await handleSharedNumberMessage(text, from, entradaEraAudio);
    } catch (err) {
      console.error(`[reflex] handleSharedNumberMessage falhou: ${semDadoPessoal(err)}`);
      return resp({ ok: true }, 200);
    }
  }

  try {
    // Sempre classifica no servidor — nunca aceita `decision` do corpo. O
    // campo existia pra permitir pular a chamada do classificador, mas isso
    // também deixava QUALQUER chamador escolher o tier (e portanto o
    // orçamento/tools liberados) da própria mensagem sem passar pelo Haiku.
    // Nenhum caller legítimo do repositório manda esse campo hoje.
    let decision = await classify(text);
    // Nunca logue `text`: é o conteúdo integral da mensagem do usuário —
    // conversa pessoal, e eventualmente um segredo que ele digitou no chat.
    // A classificação sozinha já basta pra diagnóstico.
    console.log(`[reflex] classificado tier=${decision.tier} frente=${decision.frente} domain=${decision.domain}`);

    if (decision.tier === "deep") {
      // Tier 'deep' ainda não implementado nesta fase. Sem esse fallback, o
      // reflex devolvia 422 pro n8n, que não tem tratamento de erro no node
      // "Call Edge Function" — a execução inteira morria e o Daniel ficava
      // sem NENHUMA resposta no WhatsApp (silêncio, sem erro visível pra ele).
      // Cai pra fast em vez disso: quase sempre resolve numa passada mesmo
      // (ex: perguntas de CRM/funil que já têm tool dedicada no fast).
      console.warn(`[reflex] tier 'deep' pedido (frente=${decision.frente} domain=${decision.domain}) mas ainda não implementado — fallback pra fast.`);
      decision = { ...decision, tier: "fast" };
    }

    if (decision.tier === "reflex") {
      // O tier reflex grava e lê dados pessoais (saúde, medicação, treino,
      // prioridade do dia). Sem saber DE QUEM é a mensagem não há resposta
      // segura possível: responder assumindo um tenant padrão foi exatamente o
      // que fazia um usuário receber a prioridade de outro. Recusa é o certo.
      const tenantReflex = await resolveTenant(instance);
      if (!tenantReflex) {
        console.error("[reflex] tier reflex sem tenant resolvido — recusando em vez de assumir um padrão");
        return resp({ error: "não foi possível identificar o usuário desta mensagem" }, 409);
      }
      const result = await orchestrateReflex(text, decision, buildDeps(tenantReflex.id));
      return resp(result, 200);
    }

    if (decision.tier === "fast") {
      // Entrega assíncrona: com 'from' + Evolution configurada, devolve um ack
      // imediato e processa/entrega a resposta real em background — evita
      // estourar o timeout do webhook em turnos pesados de tool use.
      if (from && hasEvolutionConfig()) {
        // Observabilidade do background. NÃO grave aqui: impressão digital de
        // secret (o bloco removido em 10/08/2026 salvava comprimento + 7
        // primeiros e 3 últimos caracteres do EVOLUTION_API_KEY, o que reduz
        // muito o espaço de busca da chave) nem telefone do remetente — esta
        // tabela é retida indefinidamente e não tem dono por linha.
        const dbg = getSupabaseClient();

        const deliver = (async () => {
          try {
            await dbg.from("async_debug").insert({ step: "bg_start", detail: "" });
            // Resolve o tenant UMA vez: /fast usa pras tools (calendar/tarefas/
            // GA4), o envio abaixo usa pra credenciais do WhatsApp — mesma
            // fonte de verdade, sem consultar o DB duas vezes.
            const tenant = await resolveTenant(instance);
            const result = await callFastEndpoint({
              text,
              decision,
              from,
              timeoutMs: FAST_BG_TIMEOUT_MS,
              tenantSlug: tenant?.slug,
            });
            const bubbles = splitMessages(result.message);
            await dbg.from("async_debug").insert({
              step: "fast_done",
              detail: `ok=${result.ok} len=${result.message.length} bubbles=${bubbles.length}`,
            });
            try {
              if (tenant) {
                const whatsappDeps: WhatsAppDeps = { fetch, env: await buildTenantEnv(tenant) };
                await entregarRespostaWhatsApp(
                  from,
                  result.message,
                  deveResponderEmAudio(entradaEraAudio, tenant.resposta_audio_sempre),
                  whatsappDeps,
                );
              } else {
                // Sem tenant resolvido não dá pra saber a preferência de áudio
                // — mesmo comportamento de sempre (texto, env global).
                await sendWhatsAppMessages(from, bubbles, undefined);
              }
              await dbg.from("async_debug").insert({ step: "sent_ok", detail: "" });
            } catch (err) {
              await dbg.from("async_debug").insert({ step: "send_err", detail: semDadoPessoal(err) });
              console.error("[reflex] entrega async falhou:", semDadoPessoal(err));
            }
          } catch (err) {
            await dbg.from("async_debug").insert({ step: "bg_err", detail: semDadoPessoal(err) });
            console.error("[reflex] background falhou:", semDadoPessoal(err));
          }
        })();
        // Mantém a function viva até o background terminar.
        (globalThis as { EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void } })
          .EdgeRuntime?.waitUntil?.(deliver);
        return resp({ ok: true, message: FAST_ACK }, 200);
      }

      // Sem 'from' ou Evolution não configurada: comportamento síncrono.
      // Passa o tenant também aqui — sem ele, o /fast montava o prompt com a
      // persona default e as tools caíam no ambiente global. Era um caminho de
      // PRODUÇÃO, não só de teste.
      const tenantSync = await resolveTenant(instance);
      const result = await callFastEndpoint({ text, decision, from, tenantSlug: tenantSync?.slug });
      return resp(result, 200);
    }

    // tier === "deep" — não implementado nesta fase
    return resp({ error: `Tier 'deep' ainda não implementado.`, decision }, 422);
  } catch (err) {
    return resp({ error: semDadoPessoal(err) }, 500);
  }
});

function resp(data: unknown, status: number): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
