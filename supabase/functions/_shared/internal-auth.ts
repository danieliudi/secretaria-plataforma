// Autenticação das chamadas INTERNAS entre edge functions.
//
// Por que não basta o `verify_jwt` do Supabase: ele valida QUALQUER JWT do
// projeto — inclusive a chave publicável, que está no bundle do browser por
// design (NEXT_PUBLIC_SUPABASE_ANON_KEY). Ou seja, todo visitante do site tinha
// uma credencial que passava, e com ela dava pra chamar /fast mandando
// `tenant_slug` de outra pessoa e receber a agenda, o Gmail e o CRM dela na
// resposta HTTP. `verify_jwt` é anti-ruído, não fronteira de autorização.
//
// Aqui exigimos especificamente a SERVICE ROLE key, que a plataforma injeta
// dentro das edge functions e que os chamadores internos (reflex -> fast,
// telegram -> fast, cron -> fast, ver _shared/fast-proxy.ts) já enviam. Nada
// que roda no navegador tem acesso a ela.

/** Comparação em tempo constante — não vaza o prefixo correto pelo tempo de resposta. */
function comparaSeguro(a: string, b: string): boolean {
  const ea = new TextEncoder().encode(a);
  const eb = new TextEncoder().encode(b);
  if (ea.length !== eb.length) return false;
  let diff = 0;
  for (let i = 0; i < ea.length; i++) diff |= ea[i] ^ eb[i];
  return diff === 0;
}

/** true só quando o chamador provou ser interno (Authorization: Bearer <service role>). */
export function isInternalCall(req: Request): boolean {
  const esperado = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!esperado) return false;

  const header = req.headers.get("Authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice("Bearer ".length).trim() : "";
  if (!token) return false;

  return comparaSeguro(token, esperado);
}

export function respostaNaoAutorizado(): Response {
  return new Response(JSON.stringify({ error: "não autorizado" }), {
    status: 401,
    headers: { "Content-Type": "application/json" },
  });
}

// ─── Segredo dedicado de webhook (chamador externo confiável) ───────────────
//
// Existe porque `isInternalCall` exige `Authorization: Bearer <service role>`,
// e nem todo chamador legítimo consegue mandar exatamente isso. O n8n, por
// exemplo, usa "Header Auth" (nome e valor de header livres) — a credencial
// dele se chamava "Supabase service_role" mas não chegava no formato que
// `isInternalCall` reconhece, e por isso a trava do /reflex ficou 18 dias em
// modo observação sem nunca poder ser ligada (43 linhas de `auth_observe`).
//
// Em vez de afrouxar `isInternalCall` (que protege as chamadas entre edge
// functions e não deve virar "aceita qualquer formato"), este é um segundo
// fator, separado e específico: um segredo próprio, num header próprio.

/** Header onde o segredo dedicado é esperado. */
export const HEADER_SEGREDO_WEBHOOK = "X-Webhook-Secret";

/**
 * true quando o chamador provou ser confiável — por chamada interna
 * (service role) OU pelo segredo dedicado do webhook.
 *
 * `segredoEsperado` ausente/vazio devolve `false`: falta de segredo NUNCA
 * vira permissão. Quem chama decide o que fazer com isso (ver o /reflex, que
 * distingue "sem segredo configurado" de "segredo errado" pra não derrubar a
 * produção antes do segredo existir nos dois lados).
 */
export function temSegredoDeWebhook(req: Request, segredoEsperado: string | undefined): boolean {
  if (!segredoEsperado) return false;
  const recebido = req.headers.get(HEADER_SEGREDO_WEBHOOK) ?? "";
  if (!recebido) return false;
  return comparaSeguro(recebido, segredoEsperado);
}
