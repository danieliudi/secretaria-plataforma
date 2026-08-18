// Webhook do bot do Microsoft Teams (Bot Framework Activity protocol).
//
// Modelo: UM bot compartilhado por vários tenants — igual ao WhatsApp por
// número compartilhado (código de vínculo de 6 caracteres), NÃO ao Telegram
// (bot próprio por tenant, chat_id trust-on-first-use). Ver
// _shared/tenant.ts (getTenantByAuthorizedTeamsUserId/consumeTeamsLinkCode).
//
// Autenticação: o Bot Framework Connector assina cada chamada com um JWT
// (ver _shared/teams-auth.ts) — é o equivalente, aqui, do secret_token do
// Telegram ou do HMAC do meta-webhook. SEM essa checagem, qualquer um que
// descubra a URL processava mensagem em nome de qualquer pessoa.
//
// Escopo do v1: só texto. Sem áudio/imagem/PDF (isso é Fase 2, se fizer
// sentido depois de validar o canal básico) e sem envio de arquivo
// (gerar_documento/export_spreadsheet recusam explicitamente pra este
// canal — ver o `throw` em fast/tools/documentos.ts e spreadsheet.ts).
import { getSupabaseClient } from "../_shared/supabase.ts";
import { callFastEndpoint } from "../_shared/fast-proxy.ts";
import { sendTeamsMessages, type TeamsDeps, type TeamsReplyContext } from "../_shared/teams.ts";
import { validarTokenBotFramework } from "../_shared/teams-auth.ts";
import { consumeTeamsLinkCode, getTenantByAuthorizedTeamsUserId, type Tenant } from "../_shared/tenant.ts";
import { splitMessages } from "../_shared/whatsapp.ts";
import type { Decision } from "../_shared/types.ts";
import { apelidoDeUsuario, semDadoPessoal } from "../_shared/log-seguro.ts";

const FAST_BG_TIMEOUT_MS = 90_000;

const DEFAULT_DECISION: Decision = {
  tier: "fast",
  frente: "pessoal",
  domain: "outro",
  action_required: false,
  irreversible: false,
  confidence: 0.95,
};

const LINK_HELP_MESSAGE =
  "Ainda não vinculei sua conta. Acessa a plataforma pra configurar sua secretária — no fim do cadastro aparece um código, é só colar aqui.";
const LINK_INVALID_MESSAGE =
  "Esse código não é válido ou já venceu. Gera um novo na tela de Teams do cadastro e manda de novo.";
const LINK_SUCCESS_MESSAGE =
  "✅ Pronto, essa conta do Teams já está vinculada à sua secretária! Pode me chamar quando quiser.";

interface TeamsActivity {
  type: string;
  text?: string;
  from?: { id: string; aadObjectId?: string; name?: string };
  recipient?: { id: string; name?: string };
  conversation?: { id: string };
  serviceUrl?: string;
  channelId?: string;
}

function resp(data: unknown, status: number): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return resp("Method Not Allowed", 405);

  let activity: TeamsActivity;
  try {
    activity = await req.json();
  } catch {
    return resp({ error: "Invalid JSON" }, 400);
  }

  const serviceUrl = activity.serviceUrl;
  const conversationId = activity.conversation?.id;
  if (!serviceUrl || !conversationId) return resp({ ok: true, ignored: "sem_serviceurl_ou_conversation" }, 200);

  // Autenticação PRIMEIRO, antes de processar qualquer conteúdo — a Activity
  // inteira (inclusive o texto) só é confiável depois disso.
  const appId = Deno.env.get("TEAMS_APP_ID");
  if (!appId) {
    console.error("[teams] TEAMS_APP_ID não configurado — recusando");
    return resp({ ok: true, ignored: "sem_app_id" }, 200);
  }
  const validacao = await validarTokenBotFramework(
    req.headers.get("Authorization"),
    serviceUrl,
    appId,
  );
  if (!validacao.ok) {
    console.error(`[teams] token inválido: ${validacao.motivo}`);
    return resp({ error: "Unauthorized" }, 401);
  }

  // Só mensagem de texto no v1 — outros tipos de Activity (conversationUpdate,
  // typing, reação, etc.) só recebem ACK.
  if (activity.type !== "message" || !activity.text?.trim()) {
    return resp({ ok: true, ignored: "not_a_text_message" }, 200);
  }

  const teamsUserId = activity.from?.aadObjectId ?? activity.from?.id;
  if (!teamsUserId) return resp({ ok: true, ignored: "sem_from" }, 200);
  if (!activity.from || !activity.recipient) return resp({ ok: true, ignored: "sem_from_ou_recipient" }, 200);

  // O Connector recusa a resposta sem identificar quem manda e quem recebe.
  // `from`/`recipient` aqui são COPIADOS da Activity recebida (o bot só
  // inverte o sentido) — mesmo padrão do TurnContext.getConversationReference
  // do SDK oficial, não dá pra inventar um id de bot próprio.
  const replyContext: TeamsReplyContext = { from: activity.recipient, recipient: activity.from };

  const userId = `ms:${conversationId}`;
  const text = activity.text.trim();
  const teamsDeps: TeamsDeps = { fetch, env: (k) => Deno.env.get(k) };
  const dbg = getSupabaseClient();

  let tenant: Tenant | null;
  try {
    tenant = await getTenantByAuthorizedTeamsUserId(teamsUserId);
  } catch (err) {
    console.error(`[teams] getTenantByAuthorizedTeamsUserId falhou: ${semDadoPessoal(err)}`);
    return resp({ ok: true, ignored: "erro_resolver_tenant" }, 200);
  }

  if (!tenant) {
    let linked: Tenant | null = null;
    try {
      linked = await consumeTeamsLinkCode(text, teamsUserId);
    } catch (err) {
      console.error(`[teams] consumeTeamsLinkCode falhou: ${semDadoPessoal(err)}`);
    }
    try {
      if (linked) {
        await sendTeamsMessages(serviceUrl, conversationId, [LINK_SUCCESS_MESSAGE], replyContext, teamsDeps);
      } else {
        const looksLikeCodeAttempt = /^[A-Z0-9]{4,8}$/i.test(text);
        await sendTeamsMessages(
          serviceUrl,
          conversationId,
          [looksLikeCodeAttempt ? LINK_INVALID_MESSAGE : LINK_HELP_MESSAGE],
          replyContext,
          teamsDeps,
        );
      }
    } catch (err) {
      console.error(`[teams] resposta de vínculo/recusa falhou: ${semDadoPessoal(err)}`);
    }
    return resp({ ok: true }, 200);
  }

  if (!tenant.active) return resp({ ok: true, ignored: "tenant_inativo" }, 200);

  await dbg.from("async_debug").insert({
    step: "teams_ack",
    // Sem aadObjectId/nome: identifica pessoa real, tabela sem dono por linha.
    detail: `tenant_slug=${tenant.slug}`,
  });

  const deliver = (async () => {
    try {
      const result = await callFastEndpoint({
        text,
        decision: DEFAULT_DECISION,
        from: userId,
        timeoutMs: FAST_BG_TIMEOUT_MS,
        tenantSlug: tenant.slug,
      });
      const bubbles = splitMessages(result.message);
      await dbg.from("async_debug").insert({
        step: "teams_fast_done",
        detail: `ok=${result.ok} bubbles=${bubbles.length}`,
      });
      await sendTeamsMessages(serviceUrl, conversationId, bubbles, replyContext, teamsDeps);
      await dbg.from("async_debug").insert({ step: "teams_sent_ok", detail: "" });
    } catch (err) {
      await dbg.from("async_debug").insert({ step: "teams_bg_err", detail: semDadoPessoal(err) });
      console.error(`[teams] background falhou (${apelidoDeUsuario(userId)}): ${semDadoPessoal(err)}`);
    }
  })();

  (globalThis as { EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void } })
    .EdgeRuntime?.waitUntil?.(deliver);

  return resp({ ok: true }, 200);
});
