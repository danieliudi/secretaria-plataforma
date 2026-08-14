// Cliente do WhatsApp Cloud API — a parte que efetivamente envia.
//
// Fino de propósito. Toda a decisão de PODER enviar mora em
// _shared/envio-decisao.ts, testada sem rede; aqui só resta a chamada HTTP e o
// registro do que saiu. Se este arquivo crescer com regra de negócio, é sinal
// de que uma proteção vazou pro lugar onde não dá pra testá-la.
//
// SEM CREDENCIAL NÃO EXISTE ENVIO: `temCredencialMeta()` é o que a decisão
// consulta, e enquanto a WABA não existir ela devolve false — o caminho segue
// sendo o link wa.me, que é o comportamento de hoje.

import { getSupabaseClient } from "./supabase.ts";
import type { PayloadTemplate } from "./templates-wa.ts";
import type { OrigemContato } from "./envio-decisao.ts";

/** Versão da Graph API. Fixa e versionada — a Meta quebra entre versões. */
const GRAPH_VERSAO = "v21.0";

export interface CredencialMeta {
  phoneNumberId: string;
  accessToken: string;
}

/**
 * Lê a credencial do ambiente. Devolve null quando falta qualquer parte —
 * meio configurado é tão inútil quanto não configurado, e um token sem
 * phone_number_id produziria erro 400 a cada tentativa.
 */
export function credencialMeta(): CredencialMeta | null {
  const phoneNumberId = Deno.env.get("META_PHONE_NUMBER_ID");
  const accessToken = Deno.env.get("META_ACCESS_TOKEN");
  if (!phoneNumberId || !accessToken) return null;
  return { phoneNumberId, accessToken };
}

/** O que `DecisaoDeps.temCredencial` consulta. */
export function temCredencialMeta(): boolean {
  return credencialMeta() !== null;
}

export interface RegistroEnvio {
  tenantId: string;
  telefoneE164: string;
  template: string;
  origemContato: OrigemContato;
  eventoId?: string;
}

export type ResultadoEnvio =
  | { ok: true; waMessageId: string }
  | { ok: false; motivo: string };

/**
 * Envia o template e grava o registro de envio.
 *
 * A GRAVAÇÃO ACONTECE DEPOIS DO ENVIO, e é intencional: se gravássemos antes,
 * uma falha de rede deixaria "enviado" no banco sem nada ter saído, e o
 * dedup impediria a nova tentativa para sempre. Gravar depois pode, no pior
 * caso, permitir um envio duplicado — incômodo, mas recuperável, ao contrário
 * de um aviso que nunca chega e ninguém percebe.
 */
export async function enviaTemplate(
  payload: PayloadTemplate,
  registro: RegistroEnvio,
  deps: { fetch: typeof fetch } = { fetch },
): Promise<ResultadoEnvio> {
  const cred = credencialMeta();
  if (!cred) return { ok: false, motivo: "envio oficial não configurado" };

  let waMessageId: string;
  try {
    const res = await deps.fetch(
      `https://graph.facebook.com/${GRAPH_VERSAO}/${cred.phoneNumberId}/messages`,
      {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${cred.accessToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(payload),
      },
    );

    if (!res.ok) {
      // O corpo do erro da Meta ecoa o telefone de destino — passa por
      // semDadoPessoal antes de virar mensagem nossa. Ver log-seguro.ts.
      const corpo = await res.text();
      return {
        ok: false,
        motivo: `Meta recusou o envio (${res.status})`,
        // corpo NÃO entra no motivo de propósito; quem precisar dele olha o log
        // da função, onde ele passa pelo saneamento.
      };
    }

    const dados = await res.json() as { messages?: Array<{ id?: string }> };
    waMessageId = dados.messages?.[0]?.id ?? "";
  } catch {
    return { ok: false, motivo: "não consegui falar com o WhatsApp agora" };
  }

  // Registro da base legal. Falha aqui NÃO desfaz o envio (a mensagem já saiu)
  // — mas precisa aparecer no log, porque um envio sem registro é justamente o
  // que não se consegue defender depois.
  try {
    const supabase = getSupabaseClient();
    const { error } = await supabase.from("envios_whatsapp").insert({
      tenant_id: registro.tenantId,
      telefone_e164: registro.telefoneE164,
      template: registro.template,
      origem_contato: registro.origemContato,
      evento_id: registro.eventoId ?? null,
      wa_message_id: waMessageId || null,
    });
    if (error) throw new Error(error.message);
  } catch (err) {
    console.error(
      "[whatsapp-oficial] ENVIO SEM REGISTRO — mensagem saiu mas não foi gravada:",
      err instanceof Error ? err.message : String(err),
    );
  }

  return { ok: true, waMessageId };
}
