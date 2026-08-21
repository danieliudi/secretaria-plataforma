// Env de envio pro número compartilhado da plataforma, usado pelos PROATIVOS
// do cron (tenant sem instância Evolution própria).
//
// Por que não reusa `platformSendEnv` do reflex (reflex/index.ts:204-217):
// aquela função cai no EVOLUTION_INSTANCE/EVOLUTION_API_KEY globais — a
// instância PESSOAL do dono da plataforma — se PLATFORM_EVOLUTION_* faltar.
// Isso é tolerável no reflex: é uma pessoa respondendo a uma mensagem real, e
// o erro (se houver) aparece na hora, pra ela ver. Aqui não: o cron roda até
// 288x/dia sem ninguém olhando. Se o secret da plataforma sumisse (rotação,
// erro de digitação, secret não replicado num redeploy), o card proativo de
// TODOS os tenants sem instância própria sairia do WhatsApp PESSOAL do dono,
// silenciosamente, com as respostas deles caindo na caixa dele — achado da
// revisão adversarial do desenho de multi-tenant (20/08/2026).
//
// Por isso aqui é estrito: falta qualquer um dos dois secrets da plataforma,
// devolve `null` — quem chama pula o tenant (log só por tenant_id), nunca
// herda o env pessoal.

export function envioCompartilhadoEstrito(
  env: (key: string) => string | undefined,
): ((key: string) => string | undefined) | null {
  const instance = env("PLATFORM_EVOLUTION_INSTANCE");
  const apikey = env("PLATFORM_EVOLUTION_API_KEY");
  if (!instance || !apikey) return null;
  return (key: string): string | undefined => {
    if (key === "EVOLUTION_INSTANCE") return instance;
    if (key === "EVOLUTION_API_KEY") return apikey;
    return env(key);
  };
}
