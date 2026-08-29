// Tabela de preços dos modelos + conversão de tokens em dinheiro.
//
// FONTE ÚNICA: este arquivo é o único lugar do projeto que sabe quanto custa
// um token. A agregação no banco (uso_por_tenant) devolve só CONTAGEM — se
// o preço vivesse lá também, os dois divergiriam no primeiro reajuste da
// Anthropic e ninguém perceberia (o número na tela continuaria plausível).
//
// Preços em dólar por 1 MILHÃO de tokens, conforme a tabela pública da
// Anthropic. Reajuste é raro; quando acontecer, muda aqui e sai no deploy —
// fica versionado no git, com data e autor, em vez de ser um valor editável
// numa tela que ninguém audita.
//
// CACHE ENTRA NA CONTA: escrita de cache custa 1,25x o preço de entrada e
// leitura custa 0,1x. Ignorar isso não é detalhe — no uso real da plataforma
// o cache é a MAIOR fatia dos tokens de entrada, e tratá-lo como entrada
// comum inflaria o custo mostrado em ~48%.

export interface PrecoModelo {
  /** Rótulo curto pra tela — o id cru ("claude-sonnet-4-5-20250929") não diz nada pra quem lê. */
  rotulo: string;
  /** USD por 1M tokens de entrada não-cacheada. */
  entrada: number;
  /** USD por 1M tokens escritos no cache (1,25x entrada). */
  cacheEscrita: number;
  /** USD por 1M tokens lidos do cache (0,1x entrada). */
  cacheLeitura: number;
  /** USD por 1M tokens de saída. */
  saida: number;
}

export const PRECOS: Record<string, PrecoModelo> = {
  "claude-sonnet-4-5-20250929": {
    rotulo: "Sonnet 4.5",
    entrada: 3.0,
    cacheEscrita: 3.75,
    cacheLeitura: 0.3,
    saida: 15.0,
  },
  "claude-haiku-4-5-20251001": {
    rotulo: "Haiku 4.5",
    entrada: 1.0,
    cacheEscrita: 1.25,
    cacheLeitura: 0.1,
    saida: 5.0,
  },
};

/**
 * Cotação usada pra mostrar o valor em real.
 *
 * A Anthropic cobra em DÓLAR — esse é o número verdadeiro, e é ele que a
 * tela mostra como fonte. O real é conveniência de leitura, e por isso a
 * cotação aparece declarada na tela: sem isso, o número em R$ vira um
 * palpite sem procedência.
 *
 * Fixa de propósito. Buscar cotação do dia numa API externa deixaria o
 * painel de custo dependente de um serviço que pode cair — e um painel de
 * custo sem número é pior que um número aproximado com a régua à vista.
 */
export const COTACAO_USD_BRL = 5.4;

export interface TokensUso {
  tokens_entrada: number;
  tokens_cache_escrita: number;
  tokens_cache_leitura: number;
  tokens_saida: number;
}

/**
 * Custo em USD de um bloco de tokens de um modelo.
 *
 * Modelo desconhecido (ex: trocamos de modelo e esquecemos de cadastrar o
 * preço aqui) devolve `null` em vez de 0: zerar em silêncio faria a tela
 * afirmar que o gasto foi menor do que foi. Quem chama decide como sinalizar
 * — a /admin mostra o aviso de "modelo sem preço cadastrado".
 */
export function custoUsd(modelo: string, uso: TokensUso): number | null {
  const p = PRECOS[modelo];
  if (!p) return null;
  return (
    (uso.tokens_entrada * p.entrada +
      uso.tokens_cache_escrita * p.cacheEscrita +
      uso.tokens_cache_leitura * p.cacheLeitura +
      uso.tokens_saida * p.saida) /
    1_000_000
  );
}

export function formataBrl(usd: number): string {
  return (usd * COTACAO_USD_BRL).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}

/** 4 casas: no volume atual um usuário inteiro custa centavos de dólar. */
export function formataUsd(usd: number): string {
  return `US$ ${usd.toLocaleString("pt-BR", { minimumFractionDigits: 4, maximumFractionDigits: 4 })}`;
}
