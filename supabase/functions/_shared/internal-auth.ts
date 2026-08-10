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
