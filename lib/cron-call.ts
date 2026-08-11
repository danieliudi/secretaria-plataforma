// Chamada do app (Next.js) pra uma tarefa da edge function `/cron`.
//
// Autenticação: a MESMA trava interna que o pg_cron usa —
// `Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY>`, verificada por
// isInternalCall() em supabase/functions/_shared/internal-auth.ts. A chave só
// existe no servidor (nunca em NEXT_PUBLIC_*), então isto só pode ser chamado
// de Route Handler ou Server Component — nunca do browser.

const TIMEOUT_MS = 8_000;

/**
 * Dispara uma tarefa do cron sem esperar o resultado importar.
 *
 * Nunca lança: quem chama está no meio de um fluxo do usuário (terminar o
 * cadastro), e uma falha ao avisar o dono não pode virar erro na tela de quem
 * acabou de se cadastrar. Falha vira log no servidor.
 */
export async function dispararTarefaCron(task: string): Promise<void> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error(`[cron-call] task='${task}' ignorada: URL ou service role key ausente`);
    return;
  }

  // Timeout explícito: sem ele, uma edge function pendurada seguraria a
  // resposta do wizard até o limite da plataforma.
  const abort = AbortSignal.timeout(TIMEOUT_MS);
  try {
    const res = await fetch(`${new URL(url).origin}/functions/v1/cron`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({ task }),
      signal: abort,
    });
    if (!res.ok) {
      // Só o status — o corpo pode trazer detalhe de tenant e não tem por que
      // ir parar no log do servidor.
      console.error(`[cron-call] task='${task}' respondeu ${res.status}`);
    }
  } catch (err) {
    console.error(`[cron-call] task='${task}' falhou: ${String(err)}`);
  }
}
