// Memória editável — as instruções que o usuário escreve pra secretária.
//
// Modelo das Skills do Claude, e a razão é de custo, não de estética: hoje ~80%
// do que a plataforma gasta é cache write do system prompt. Uma instrução de
// 1.200 caracteres em toda conversa seria paga em toda conversa, pra sempre.
//
// Então a instrução vive partida em duas:
//   - ÍNDICE (`nome` + `quando_usar`): entra no prompt SEMPRE. ~24 tokens cada.
//   - CORPO (`texto`): só é lido quando o modelo chama `abrir_instrucao`.
//
// O campo que decide tudo é o `quando_usar`. Vago demais, ela abre à toa e
// gasta; estreito demais, nunca abre e o usuário acha que a instrução não
// funciona. Por isso a tela mostra quantas vezes cada uma foi aberta — é o
// único sinal que separa "texto ruim" de "gatilho ruim".
//
// REGRA DURA: a Mia pode ESCREVER uma instrução (`propor_instrucao`), nunca
// ATIVAR. Instrução ativa muda toda resposta futura; uma que ela ligou sozinha,
// com uma frase mal entendida no meio, contamina tudo em silêncio e só aparece
// semanas depois. Proposta nasce `ativo = false` e fica lá até o usuário abrir
// a tela e ligar. Mesma lógica do evento com convidado no "fechar o dia": ela
// mexe no que é só dela, e devolve a decisão do que tem consequência.

import { getSupabaseClient } from "./supabase.ts";
import { semDadoPessoal } from "./log-seguro.ts";

/** Linha do índice — o que entra no prompt de toda conversa. */
export interface InstrucaoIndice {
  slug: string;
  nome: string;
  quando_usar: string;
}

export interface Instrucao extends InstrucaoIndice {
  texto: string;
}

// Limites espelham os CHECKs da migration. Repetidos aqui de propósito: o
// banco é a última linha, mas errar cedo dá mensagem legível em vez de um
// erro de constraint que o modelo não sabe interpretar.
export const MAX_NOME = 60;
export const MAX_QUANDO_USAR = 160;
export const MAX_TEXTO = 6000;

// Teto do índice no prompt. 40 × ~24 tokens ≈ 960 — ainda ~6% de um prompt de
// 16k. Acima disso o índice deixa de ser barato e a saída passa a ser busca
// semântica (Voyage/pgvector, que já existem pro histórico e pras atas), não
// um teto maior aqui.
export const MAX_INSTRUCOES_NO_PROMPT = 40;

/** Slug estável a partir do nome: minúsculas, sem acento, hífens. */
export function slugDoNome(nome: string): string {
  return nome
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

export interface InstrucoesDeps {
  carregaIndice: (tenantId: string, limite: number) => Promise<InstrucaoIndice[]>;
  carregaTexto: (tenantId: string, slug: string) => Promise<Instrucao | null>;
  registraUso: (tenantId: string, slug: string) => Promise<void>;
  criaProposta: (
    tenantId: string,
    inst: { slug: string; nome: string; quando_usar: string; texto: string },
  ) => Promise<void>;
}

export function defaultInstrucoesDeps(): InstrucoesDeps {
  return {
    carregaIndice: async (tenantId, limite) => {
      const { data, error } = await getSupabaseClient()
        .from("instrucoes")
        .select("slug, nome, quando_usar")
        .eq("tenant_id", tenantId)
        .eq("ativo", true)
        // Ordem estável: a ordem entra no prompt, e ordem instável quebraria o
        // cache do prompt a cada conversa — justamente o que estamos tentando
        // não pagar.
        .order("nome", { ascending: true })
        .limit(limite);
      if (error) throw new Error(error.message);
      return (data ?? []) as InstrucaoIndice[];
    },

    carregaTexto: async (tenantId, slug) => {
      const { data, error } = await getSupabaseClient()
        .from("instrucoes")
        .select("slug, nome, quando_usar, texto")
        .eq("tenant_id", tenantId)
        .eq("slug", slug)
        .eq("ativo", true)
        .maybeSingle();
      if (error) throw new Error(error.message);
      return (data as Instrucao | null) ?? null;
    },

    registraUso: async (tenantId, slug) => {
      // RPC em vez de read-modify-write: duas conversas abrindo a mesma
      // instrução ao mesmo tempo perderiam uma contagem no caminho de ida e
      // volta. O contador é informativo, mas informativo e errado é pior que
      // ausente — é ele que o usuário usa pra decidir se o gatilho presta.
      const { error } = await getSupabaseClient().rpc("instrucao_registra_uso", {
        p_tenant_id: tenantId,
        p_slug: slug,
      });
      if (error) throw new Error(error.message);
    },

    criaProposta: async (tenantId, inst) => {
      const { error } = await getSupabaseClient()
        .from("instrucoes")
        .insert({
          tenant_id: tenantId,
          slug: inst.slug,
          nome: inst.nome,
          quando_usar: inst.quando_usar,
          texto: inst.texto,
          origem: "proposta",
          // Explícito, mesmo com default no banco. Isto é a regra dura do
          // recurso; deixar implícito num default seria fácil demais de perder
          // numa refatoração futura.
          ativo: false,
        });
      if (error) throw new Error(error.message);
    },
  };
}

/**
 * Índice das instruções ativas. Best-effort: falha aqui não pode derrubar a
 * conversa — no pior caso a Mia responde sem as instruções, que é como ela
 * respondia antes deste recurso existir.
 */
export async function carregaIndiceInstrucoes(
  tenantId: string,
  deps: InstrucoesDeps = defaultInstrucoesDeps(),
): Promise<InstrucaoIndice[]> {
  try {
    return await deps.carregaIndice(tenantId, MAX_INSTRUCOES_NO_PROMPT);
  } catch (err) {
    console.error(`[instrucoes] índice falhou p/ tenant ${tenantId}:`, semDadoPessoal(err));
    return [];
  }
}

/**
 * Abre o corpo de UMA instrução e conta o uso. Devolve null se o slug não
 * existe ou está desligado — o modelo lê isso e diz que não achou, em vez de
 * inventar o conteúdo de uma instrução que não leu.
 */
export async function abreInstrucao(
  tenantId: string,
  slug: string,
  deps: InstrucoesDeps = defaultInstrucoesDeps(),
): Promise<Instrucao | null> {
  const inst = await deps.carregaTexto(tenantId, slugDoNome(slug));
  if (!inst) return null;
  // O contador é secundário: se falhar, a instrução ainda tem que abrir.
  try {
    await deps.registraUso(tenantId, inst.slug);
  } catch (err) {
    console.error(`[instrucoes] contador falhou p/ tenant ${tenantId}:`, semDadoPessoal(err));
  }
  return inst;
}

export interface PropostaDeInstrucao {
  nome: string;
  quando_usar: string;
  texto: string;
}

/**
 * A Mia redigindo uma instrução. Sempre desligada — ver a REGRA DURA no topo.
 * Devolve o slug pra ela poder dizer onde ficou.
 */
export async function propoeInstrucao(
  tenantId: string,
  proposta: PropostaDeInstrucao,
  deps: InstrucoesDeps = defaultInstrucoesDeps(),
): Promise<{ slug: string }> {
  const nome = proposta.nome.trim().slice(0, MAX_NOME);
  const quando = proposta.quando_usar.trim().slice(0, MAX_QUANDO_USAR);
  const texto = proposta.texto.trim().slice(0, MAX_TEXTO);

  if (!nome) throw new Error("nome vazio");
  if (!quando) throw new Error("quando_usar vazio — sem gatilho a instrução nunca abre");
  if (!texto) throw new Error("texto vazio");

  const slug = slugDoNome(nome);
  if (!slug) throw new Error("nome não produz um identificador válido");

  await deps.criaProposta(tenantId, { slug, nome, quando_usar: quando, texto });
  return { slug };
}

/**
 * O bloco do system prompt. SÓ o índice — o corpo nunca entra aqui.
 *
 * Vazio quando não há instrução ativa: quem não escreveu nenhuma não paga nem
 * o cabeçalho, e o prompt fica exatamente como era antes.
 */
export function buildInstrucoesSystemBlock(indice: InstrucaoIndice[]): string {
  if (indice.length === 0) return "";

  const linhas = indice
    .map((i) => `  - ${i.nome} (slug: ${i.slug}) — ${i.quando_usar}`)
    .join("\n");

  return `INSTRUÇÕES QUE O CHEFE ESCREVEU (memória editável dele — 2 tools: abrir_instrucao, propor_instrucao)
${linhas}

COMO USAR:
- Cada linha acima é o NOME e o GATILHO de um texto que ele escreveu. Você NÃO está vendo o texto — só o índice.
- Quando a situação bater com um gatilho, chame abrir_instrucao(slug) ANTES de responder. O texto que voltar é INSTRUÇÃO DELE pra você, não conteúdo pra repetir de volta.
- Só abra o que serve pra mensagem atual. Abrir todas "por garantia" é desperdício e polui a resposta.
- Depois de usar uma, diga em UMA linha curta qual foi (ex: "Usei 'Como eu escrevo pra cliente industrial'."). Sem isso, quando a resposta sair estranha ele não tem como saber se o problema foi você ou um texto que ele mesmo escreveu há semanas.
- Se ele corrigir algo que está numa instrução, NÃO edite sozinha: diga o que mudaria e onde, e deixe ele editar na tela.

QUANDO PROPOR UMA NOVA (propor_instrucao):
- Só quando ele te corrigir do MESMO jeito três vezes ou mais. Uma correção é uma correção; três é uma regra que ele nunca escreveu.
- Mostre nome, gatilho e texto inteiros na conversa ANTES de chamar a tool, e chame só depois do "pode".
- Ela nasce DESLIGADA e você não pode ligar. Diga isso: ele ativa na tela de Memória quando quiser. Nunca diga que "já está valendo".
- Nada de instrução sobre fato solto ("o telefone do Fulano é X") — isso é save_profile_fact. Instrução é sobre COMO ele quer que as coisas sejam feitas.`;
}
