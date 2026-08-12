// Saneamento de log — lado Next.js.
//
// Mesma lógica de supabase/functions/_shared/log-seguro.ts, duplicada aqui
// porque os dois runtimes (Deno nas edge functions, Node no Next.js) não
// compartilham módulo neste repo — ver o mesmo padrão em lib/cron-call.ts e
// app/api/onboarding/channel/route.ts. Mudou uma? Muda a outra.
//
// Por quê: erro do Postgrest ecoa o VALOR em violação de constraint (ex:
// "Key (user_id)=(5511999998888) already exists"), e as rotas de admin
// interpolam error.message direto no console.error, que vai pro log da
// função no Netlify.

const MAX_LEN = 300;

const REGRAS: Array<[RegExp, string]> = [
  [/\b(sb_secret_|sb_publishable_|sk-ant-|gsk_|ya29\.|AIza)[A-Za-z0-9._~+/-]+/g, "[segredo]"],
  [/\bBearer\s+[A-Za-z0-9._~+/-]+/gi, "Bearer [segredo]"],
  [/\b\d{6,}:[A-Za-z0-9_-]{30,}/g, "[segredo]"],
  [/\b\d{5,}(-\d+)?@[a-z]\.(whatsapp|us)\.net\b/gi, "[jid]"],
  [/\b\d{5,}@g\.us\b/gi, "[jid-grupo]"],
  [/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, "[email]"],
  [/\b\d{7,}\b/g, "[num]"],
];

/** Versão de um valor segura pra log: sem identificador de pessoa, sem segredo, com tamanho limitado. */
export function semDadoPessoal(valor: unknown): string {
  let texto: string;
  try {
    texto = valor instanceof Error
      ? `${valor.name}: ${valor.message}`
      : typeof valor === "string"
      ? valor
      : JSON.stringify(valor) ?? String(valor);
  } catch {
    texto = "[valor não serializável]";
  }

  for (const [padrao, marcador] of REGRAS) texto = texto.replace(padrao, marcador);

  return texto.length > MAX_LEN ? `${texto.slice(0, MAX_LEN)}…` : texto;
}
