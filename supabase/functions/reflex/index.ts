import { getAnthropicClient } from "../_shared/anthropic.ts";
import { getSupabaseClient } from "../_shared/supabase.ts";
import type { Decision } from "../_shared/types.ts";
import { classifyWithHaiku, checkRegexReflex } from "../_shared/router.ts";
import { callFastEndpoint } from "../_shared/fast-proxy.ts";
import {
  hasEvolutionConfig,
  sendWhatsAppMessages,
  sendWhatsAppText,
  splitMessages,
  type WhatsAppDeps,
} from "../_shared/whatsapp.ts";
import { orchestrateReflex, type OrchestratorDeps, parseReflexIntent } from "./orchestrator.ts";
import {
  buildTenantEnv,
  consumeWhatsAppLinkCode,
  DEFAULT_TENANT_SLUG,
  getTenantByAuthorizedPhone,
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

function buildDeps(): OrchestratorDeps {
  const sb = getSupabaseClient();
  getAnthropicClient(); // valida ANTHROPIC_API_KEY no boot

  return {
    water: {
      insert: (data) => sb.from("health_log").insert(data),
      sumToday: async () => {
        const { data } = await sb
          .from("health_log")
          .select("valor")
          .eq("tipo", "agua")
          .gte("ts", todayStart());
        return (data ?? []).reduce((s: number, r: { valor: number }) => s + (r.valor ?? 0), 0);
      },
    },
    sleep: {
      insert: (data) => sb.from("habit_log").insert(data),
    },
    treino: {
      insert: (data) => sb.from("treino_log").insert(data),
    },
    medication: {
      now: () => new Date().toTimeString().slice(0, 5),
      findActive: async () => {
        const { data } = await sb
          .from("medication_schedule")
          .select("*")
          .eq("ativo", true);
        return data ?? [];
      },
      logIntake: (scheduleId, remedio, dose) =>
        sb.from("medication_log").insert({ schedule_id: scheduleId, remedio, dose }),
    },
    oneThingWrite: {
      insert: (data) => sb.from("one_thing").insert(data),
      today: () => new Date().toISOString().slice(0, 10),
    },
    oneThingRead: {
      findCurrent: async (escopo) => {
        const { data } = await sb
          .from("one_thing")
          .select("texto")
          .eq("escopo", escopo)
          .eq("status", "aberto")
          .order("created_at", { ascending: false })
          .limit(1);
        return data?.[0]?.texto ?? null;
      },
    },
    quickCapture: {
      insert: (data) => sb.from("quick_capture").insert(data),
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
    console.error(`[reflex] resolveTenant falhou, seguindo com env global: ${String(err)}`);
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
async function handleSharedNumberMessage(text: string, fromRaw: string | undefined): Promise<Response> {
  if (!fromRaw) return resp({ ok: true }, 200);
  const fromE164 = normalizeWhatsAppJidToE164(fromRaw);
  if (!fromE164) return resp({ ok: true }, 200); // grupo ou remetente não-parseável — ignora, sem gerar dado nenhum

  let tenant: Tenant | null;
  try {
    tenant = await getTenantByAuthorizedPhone(fromE164);
  } catch (err) {
    console.error(`[reflex] getTenantByAuthorizedPhone falhou: ${String(err)}`);
    return resp({ ok: true }, 200);
  }

  if (!tenant) {
    let linked: Tenant | null = null;
    try {
      linked = await consumeWhatsAppLinkCode(text, fromE164);
    } catch (err) {
      console.error(`[reflex] consumeWhatsAppLinkCode falhou: ${String(err)}`);
    }
    try {
      if (linked) {
        await replyOnSharedNumber(fromRaw, LINK_SUCCESS_MESSAGE);
      } else {
        const looksLikeCodeAttempt = /^[A-Z0-9]{4,8}$/i.test(text.trim());
        await replyOnSharedNumber(fromRaw, looksLikeCodeAttempt ? LINK_INVALID_MESSAGE : LINK_HELP_MESSAGE);
      }
    } catch (err) {
      console.error(`[reflex] resposta de vínculo/recusa falhou: ${String(err)}`);
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
    console.error(`[reflex] classify falhou (número compartilhado): ${String(err)}`);
    decision = { tier: "fast", frente: "ambiguo", domain: "outro", action_required: false, irreversible: false, confidence: 0 };
  }

  if (decision.tier === "reflex") {
    const result = await orchestrateReflex(text, decision, buildDeps());
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
      const bubbles = splitMessages(result.message);
      const whatsappDeps: WhatsAppDeps = { fetch, env: await buildSharedNumberEnv(tenant) };
      await sendWhatsAppMessages(fromRaw, bubbles, whatsappDeps);
    } catch (err) {
      console.error(`[reflex] entrega (número compartilhado) falhou: ${String(err)}`);
    }
  })();
  (globalThis as { EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void } })
    .EdgeRuntime?.waitUntil?.(deliver);
  return resp({ ok: true, message: FAST_ACK }, 200);
}

// ─── fim do bloco número compartilhado ──────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return resp("Method Not Allowed", 405);

  let body: { text?: unknown; decision?: Decision; from?: unknown; instance?: unknown };
  try { body = await req.json(); } catch { return resp({ error: "Invalid JSON" }, 400); }

  if (!body.text || typeof body.text !== "string") {
    return resp({ error: "Missing 'text' field" }, 400);
  }
  const text = body.text;

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

  // Número compartilhado: roteamento por quem mandou, não por instância. Ver
  // comentário grande acima de handleSharedNumberMessage — só ativa quando
  // PLATFORM_EVOLUTION_INSTANCE estiver setado E bater com o `instance` do
  // corpo; nenhuma das duas condições é verdadeira hoje.
  const platformInstance = platformEvolutionInstance();
  if (platformInstance && instance === platformInstance) {
    try {
      return await handleSharedNumberMessage(text, from);
    } catch (err) {
      console.error(`[reflex] handleSharedNumberMessage falhou: ${String(err)}`);
      return resp({ ok: true }, 200);
    }
  }

  try {
    let decision = body.decision ?? await classify(text);
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
      const result = await orchestrateReflex(text, decision, buildDeps());
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
              const whatsappDeps: WhatsAppDeps | undefined = tenant
                ? { fetch, env: await buildTenantEnv(tenant) }
                : undefined;
              await sendWhatsAppMessages(from, bubbles, whatsappDeps);
              await dbg.from("async_debug").insert({ step: "sent_ok", detail: "" });
            } catch (err) {
              await dbg.from("async_debug").insert({ step: "send_err", detail: String(err) });
              console.error("[reflex] entrega async falhou:", String(err));
            }
          } catch (err) {
            await dbg.from("async_debug").insert({ step: "bg_err", detail: String(err) });
            console.error("[reflex] background falhou:", String(err));
          }
        })();
        // Mantém a function viva até o background terminar.
        (globalThis as { EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void } })
          .EdgeRuntime?.waitUntil?.(deliver);
        return resp({ ok: true, message: FAST_ACK }, 200);
      }

      // Sem 'from' ou Evolution não configurada: comportamento síncrono (atual).
      const result = await callFastEndpoint({ text, decision, from });
      return resp(result, 200);
    }

    // tier === "deep" — não implementado nesta fase
    return resp({ error: `Tier 'deep' ainda não implementado.`, decision }, 422);
  } catch (err) {
    return resp({ error: String(err) }, 500);
  }
});

function resp(data: unknown, status: number): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
