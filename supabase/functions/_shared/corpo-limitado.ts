// Leitura de corpo de requisição com teto de tamanho.

/**
 * Lê o corpo com teto de tamanho, ANTES de parsear.
 *
 * Por que não basta `await req.json()`: o parse acontece sobre o corpo inteiro,
 * então um payload gigante já custou memória e CPU antes de qualquer validação.
 * O /wa-webhook e o /reflex já limitavam; /telegram e /teams não limitavam nada
 * (achado da auditoria de 28/08/2026) — o segredo/JWT deles barra o chamador
 * hostil, mas "tem outra trava na frente" não é motivo pra aceitar corpo
 * ilimitado.
 *
 * Devolve `null` quando estoura ou quando o JSON é inválido — quem chama decide
 * o status (os webhooks preferem 200 com `ignored` a 4xx, pra não gerar retry).
 */
export async function leCorpoJsonLimitado<T>(
  req: Request,
  maxBytes: number,
): Promise<{ ok: true; valor: T } | { ok: false; motivo: "grande_demais" | "json_invalido" }> {
  let cru: string;
  try {
    cru = await req.text();
  } catch {
    return { ok: false, motivo: "json_invalido" };
  }
  if (cru.length > maxBytes) return { ok: false, motivo: "grande_demais" };
  try {
    return { ok: true, valor: JSON.parse(cru) as T };
  } catch {
    return { ok: false, motivo: "json_invalido" };
  }
}
