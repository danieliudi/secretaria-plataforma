// Webhook da Meta (WhatsApp Cloud API) — hoje serve a UMA coisa: registrar
// quem pediu pra sair.
//
// POR QUE É FUNÇÃO PRÓPRIA, E NÃO UM RAMO DO /telegram OU DO REFLEX: a resposta
// da Ana não passa pelo caminho de hoje. O que existe hoje entra pela Evolution
// API, no número do tenant. Quando a Yuka manda pelo número OFICIAL, a resposta
// chega no webhook da WABA — outro emissor, outra autenticação, outro formato.
// Enfiar isso num handler existente misturaria duas fronteiras de confiança
// muito diferentes no mesmo arquivo.
//
// AUTENTICAÇÃO: `verify_jwt = false` no config.toml, porque a Meta não manda
// JWT nenhum — mesma situação de /telegram. Quem autentica é a assinatura
// HMAC do corpo (ver _shared/meta-webhook.ts), e ela é obrigatória: sem
// META_APP_SECRET configurado, NADA é aceito.
//
// SEMPRE 200: webhook que devolve erro é webhook que a Meta desativa depois de
// algumas tentativas — e aí o opt-out para de funcionar em silêncio, que é o
// pior desfecho possível pra esta função em particular. Falha interna é
// logada e engolida; a Meta só precisa saber que recebemos.

import { getSupabaseClient } from "../_shared/supabase.ts";
import { semDadoPessoal } from "../_shared/log-seguro.ts";
import { detectaPedidoDeSaida } from "../_shared/opt-out.ts";
import {
  assinaturaValida,
  extraiMensagens,
  respostaDeVerificacao,
} from "../_shared/meta-webhook.ts";

/** Teto do corpo. Meta manda lotes pequenos; qualquer coisa maior é ruído. */
const MAX_CORPO = 256 * 1024;

async function registraSaida(telefoneE164: string): Promise<void> {
  const supabase = getSupabaseClient();
  // `upsert` com ignoreDuplicates: quem já saiu e responde "SAIR" de novo não
  // pode virar erro — e a data do PRIMEIRO pedido é a que importa numa
  // auditoria, então não sobrescrevemos.
  const { error } = await supabase
    .from("whatsapp_opt_out")
    .upsert(
      { telefone_e164: telefoneE164, motivo: "resposta_sair" },
      { onConflict: "telefone_e164", ignoreDuplicates: true },
    );
  if (error) throw new Error(`opt_out upsert falhou: ${error.message}`);
}

Deno.serve(async (req: Request) => {
  const url = new URL(req.url);

  // Handshake de cadastro da URL no painel da Meta.
  if (req.method === "GET") {
    const desafio = respostaDeVerificacao(url, Deno.env.get("META_VERIFY_TOKEN"));
    if (desafio === null) return new Response("forbidden", { status: 403 });
    return new Response(desafio, { status: 200, headers: { "content-type": "text/plain" } });
  }

  if (req.method !== "POST") {
    return new Response("method not allowed", { status: 405 });
  }

  // CORPO CRU, byte a byte — nunca JSON.parse + stringify. Ver comentário de
  // _shared/meta-webhook.ts: re-serializar normaliza o espaçamento e a
  // assinatura passa a nunca bater, sem erro em lugar nenhum.
  let cru: string;
  try {
    cru = await req.text();
  } catch {
    return new Response("bad request", { status: 400 });
  }
  if (cru.length > MAX_CORPO) {
    return new Response("payload too large", { status: 413 });
  }

  const ok = await assinaturaValida(
    cru,
    req.headers.get("x-hub-signature-256"),
    Deno.env.get("META_APP_SECRET"),
  );
  if (!ok) {
    // Sem detalhe na resposta: dizer POR QUE falhou ajuda quem está tentando
    // forjar. O log interno também não leva o corpo.
    console.error("[wa-webhook] assinatura inválida");
    return new Response("forbidden", { status: 403 });
  }

  // Daqui pra baixo tudo é best-effort e nada derruba o 200.
  try {
    const mensagens = extraiMensagens(JSON.parse(cru));
    let saidas = 0;

    for (const m of mensagens) {
      if (!detectaPedidoDeSaida(m.texto)) continue;
      try {
        await registraSaida(m.de);
        saidas++;
      } catch (err) {
        // Uma falha não pode impedir as outras mensagens do lote.
        console.error("[wa-webhook] falha ao registrar saída:", semDadoPessoal(err));
      }
    }

    // Contagem, nunca telefone nem texto. Quem responde a este webhook é um
    // terceiro que não é nosso usuário — o dado dele não entra em log.
    if (saidas > 0) console.log(`[wa-webhook] ${saidas} pedido(s) de saída registrado(s)`);
  } catch (err) {
    console.error("[wa-webhook] processamento falhou:", semDadoPessoal(err));
  }

  return new Response("ok", { status: 200 });
});
