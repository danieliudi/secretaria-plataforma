// "Redigir, não enviar" — transforma o texto que o modelo escreveu num link
// wa.me e guarda o contato.
//
// POR QUE ESTA TOOL NÃO ESCREVE O TEXTO: quem redige é o próprio modelo do
// /fast, guiado por `instrucaoRedacao(personalidade)` no prompt de sistema.
// Uma segunda chamada de LLM aqui dentro custaria token, dobraria a latência e
// abriria uma segunda voz pra divergir da primeira. A tool faz só o que código
// faz melhor que modelo: normalizar telefone, montar URL e persistir contato.
//
// POR QUE NÃO DISPARAMOS: ver o cabeçalho de _shared/wa-link.ts. Resumo —
// Evolution API é WhatsApp não-oficial, disparo pra terceiro que não pediu
// contato queima o número, e o número é a plataforma do tenant.
//
// ISOLAMENTO: toda consulta aqui filtra por `tenant_id`. Contato é lista de
// telefone de terceiro — é o dado com maior potencial de dano se vazar entre
// tenants, e não existe caminho de leitura sem tenant nesta tool.

// A implementação de `RedigirDeps` que fala com o banco mora em
// `redigir-supabase.ts`, de propósito: este arquivo fica sem import de IO e
// roda em qualquer runtime, o que torna a orquestração — inclusive o
// isolamento entre tenants — testável sem subir banco. Também não existe deps
// padrão implícita: quem chama precisa dizer de onde vêm os contatos.
import { montaLinkWhatsApp } from "../../_shared/wa-link.ts";
import { normalizaTelefoneBr } from "../../_shared/telefone.ts";

export interface ContatoRow {
  id: string;
  nome: string;
  telefone_e164: string;
  email: string | null;
}

export interface MontarLinkInput {
  /** Como o usuário chamou a pessoa: "Ana", "Ana Takahiro". */
  nome: string;
  /** A mensagem já redigida pelo modelo, na voz do usuário. */
  texto: string;
  /** Só quando o usuário informou agora. Ausente = buscar na agenda. */
  telefone?: string;
  /** E-mail do participante do evento, quando veio do Calendar. */
  email?: string;
}

export type MontarLinkResult =
  | {
    ok: true;
    url: string;
    nome: string;
    /** true quando o contato acabou de ser criado — a Yuka avisa que guardou. */
    contato_novo: boolean;
  }
  | { ok: false; motivo: string };

/**
 * IO isolado atrás de interface pra que a orquestração seja testável sem banco.
 * Toda função recebe `tenantId` explicitamente — não existe implementação que
 * possa esquecer o filtro.
 */
export interface RedigirDeps {
  buscaContatoPorNome(tenantId: string, nome: string): Promise<ContatoRow | null>;
  salvaContato(
    tenantId: string,
    userId: string | null,
    dados: { nome: string; telefone_e164: string; email?: string },
  ): Promise<void>;
}

/** Teto do nome, alinhado ao CHECK da tabela. Entrada de usuário é hostil. */
const MAX_NOME = 120;

/**
 * Monta o link de WhatsApp pra mensagem redigida, resolvendo o telefone pela
 * agenda quando o usuário não informou.
 */
export async function montarLinkParaContato(
  tenantId: string,
  userId: string | null,
  input: MontarLinkInput,
  deps: RedigirDeps,
): Promise<MontarLinkResult> {
  const nome = (input.nome ?? "").trim();
  if (nome === "") {
    return { ok: false, motivo: "Preciso saber pra quem é a mensagem." };
  }
  if (nome.length > MAX_NOME) {
    return { ok: false, motivo: "Esse nome é longo demais." };
  }

  let e164: string;
  let contatoNovo = false;

  if (input.telefone && input.telefone.trim() !== "") {
    // Usuário informou agora: normaliza e guarda pra próxima.
    const tel = normalizaTelefoneBr(input.telefone);
    if (!tel.ok) return { ok: false, motivo: tel.motivo };
    e164 = tel.e164;

    const jaTinha = await deps.buscaContatoPorNome(tenantId, nome);
    contatoNovo = jaTinha?.telefone_e164 !== e164;

    await deps.salvaContato(tenantId, userId, {
      nome,
      telefone_e164: e164,
      email: input.email,
    });
  } else {
    const contato = await deps.buscaContatoPorNome(tenantId, nome);
    if (!contato) {
      // Recusa explícita em vez de chute. Não existe "telefone provável": errar
      // aqui manda a mensagem do usuário pra um estranho.
      return {
        ok: false,
        motivo: `Não tenho o WhatsApp de ${nome}. Me manda o número que eu guardo pra próxima.`,
      };
    }
    e164 = contato.telefone_e164;
  }

  const link = montaLinkWhatsApp(e164, input.texto);
  if (!link.ok) return { ok: false, motivo: link.motivo };

  return { ok: true, url: link.url, nome, contato_novo: contatoNovo };
}
