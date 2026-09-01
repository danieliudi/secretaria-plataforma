// O erro de config da Evolution precisa dizer QUAL secret falta.
//
// Existe por um caso real (01/09/2026): um tenant de número compartilhado
// passou dias sem receber lembrete agendado. O cron tentava, falhava, logava —
// e o log dizia "Evolution secrets ausentes: EVOLUTION_API_URL, ..." listando
// as três, sempre, independente de qual estava faltando. A que faltava era
// PLATFORM_EVOLUTION_API_KEY; a EVOLUTION_API_URL que o erro acusava estava
// setada o tempo todo. A mensagem apontou pro lugar errado e custou o
// diagnóstico inteiro.
//
// Roda offline (nenhuma chamada de rede: evolutionConfig lança antes do fetch).
//   deno test --allow-env supabase/functions/_tests/whatsapp-config.test.ts

import { assert, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { hasEvolutionConfig, sendWhatsAppText } from "../_shared/whatsapp.ts";

const COMPLETO: Record<string, string> = {
  EVOLUTION_API_URL: "https://evolution.exemplo.invalid",
  EVOLUTION_INSTANCE: "secretaria",
  EVOLUTION_API_KEY: "nao-e-uma-chave-real",
};

/** Env com as 3 secrets, menos as que o caso quer derrubar. */
function envSem(...ausentes: string[]): (k: string) => string | undefined {
  return (k) => (ausentes.includes(k) ? undefined : COMPLETO[k]);
}

/** Dispara o envio só pra capturar a mensagem do erro de config. */
async function erroDe(env: (k: string) => string | undefined): Promise<string> {
  const fetchQueExplode = () => {
    throw new Error("não devia ter chegado no fetch — a config tinha que falhar antes");
  };
  try {
    await sendWhatsAppText("5511000000000@s.whatsapp.net", "oi", { fetch: fetchQueExplode as typeof fetch, env });
  } catch (err) {
    return (err as Error).message;
  }
  throw new Error("não lançou com config incompleta");
}

Deno.test("erro nomeia só a secret que falta", async () => {
  const msg = await erroDe(envSem("EVOLUTION_API_KEY"));
  assertStringIncludes(msg, "EVOLUTION_API_KEY");
  assert(
    !msg.includes("EVOLUTION_API_URL"),
    `acusou EVOLUTION_API_URL, que está setada — foi exatamente o que enganou o diagnóstico: ${msg}`,
  );
  assert(!msg.includes("EVOLUTION_INSTANCE"), `acusou EVOLUTION_INSTANCE, que está setada: ${msg}`);
});

Deno.test("cada secret sozinha aparece sozinha no erro", async () => {
  assertStringIncludes(await erroDe(envSem("EVOLUTION_API_URL")), "EVOLUTION_API_URL");
  const semInstancia = await erroDe(envSem("EVOLUTION_INSTANCE"));
  assertStringIncludes(semInstancia, "EVOLUTION_INSTANCE");
  assert(!semInstancia.includes("EVOLUTION_API_KEY"), semInstancia);
});

Deno.test("faltando mais de uma, lista as duas", async () => {
  const msg = await erroDe(envSem("EVOLUTION_INSTANCE", "EVOLUTION_API_KEY"));
  assertStringIncludes(msg, "EVOLUTION_INSTANCE");
  assertStringIncludes(msg, "EVOLUTION_API_KEY");
  assert(!msg.includes("EVOLUTION_API_URL"), msg);
});

Deno.test("o legado EVOLUTION_INSTANCE_NAME conta como instância", async () => {
  // Sem isto, um tenant que só tem o nome legado veria "instância ausente"
  // e alguém iria setar a variável errada atrás do problema.
  const env = (k: string) =>
    k === "EVOLUTION_INSTANCE" ? undefined : k === "EVOLUTION_INSTANCE_NAME" ? "secretaria" : COMPLETO[k];
  assert(hasEvolutionConfig(env), "EVOLUTION_INSTANCE_NAME devia satisfazer a config");
});

Deno.test("erro não vaza VALOR de secret, só nome", async () => {
  // O texto vai pra console.error do cron. Nome de variável pode; valor não.
  const msg = await erroDe(envSem("EVOLUTION_API_KEY"));
  for (const valor of Object.values(COMPLETO)) {
    assert(!msg.includes(valor), `vazou o valor de uma secret na mensagem de erro: ${msg}`);
  }
});
