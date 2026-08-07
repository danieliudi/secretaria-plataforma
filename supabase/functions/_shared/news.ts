// Notícias de setor via RSS do Google Notícias — sem API key própria, só
// fetch + parse de XML simples. Usado hoje só pelo resumo diário (cron
// `brief`), limitado às frentes que têm operação de agência (Resibag/Sanwey).
//
// Taxonomia de termos (radar de mercado, não busca só pela marca): as duas
// frentes têm imprensa B2B de nicho — buscar só "Resibag"/"Sanwey" volta
// vazio na maior parte do tempo. O sinal comercial real está em 3 camadas:
// gatilho regulatório (norma nova = janela de urgência de compra), radar
// competitivo (movimento de concorrente mapeado) e sinal de demanda
// (autuação/incidente/expansão de setor — evento que cria comprador). Marca
// e setor macro ficam de fora do resumo DIÁRIO por baixo rendimento/urgência
// (revisão semanal basta) — ver DAILY_PRIORITY_CATEGORIES.

const GOOGLE_NEWS_RSS = "https://news.google.com/rss/search";

export interface NewsItem {
  title: string;
  source: string;
}

export interface NewsCategory {
  key: string;
  title: string;
  terms: string[];
}

export interface FrenteNewsTerms {
  categories: NewsCategory[];
}

export type FrenteKey = "resibag" | "sanwey";

export const SECTOR_NEWS_TERMS: Record<FrenteKey, FrenteNewsTerms> = {
  resibag: {
    categories: [
      {
        key: "marca",
        title: "Marca & Produto",
        terms: ["Resibag big bag", "Resibag resíduos perigosos", "Resibag Comercial Taboão da Serra"],
      },
      {
        key: "regulatorio",
        title: "Gatilho Regulatório",
        terms: [
          "RAPP IBAMA 2026",
          "ANTT 6.078/2026",
          "ANTT 5998 fiscalização transporte",
          "Portaria Inmetro 320 embalagem resíduos",
          "IN IBAMA 06/2026 rastreabilidade",
          "Decreto 12.688/2025 PNRS",
          "NBR 10.004:2024 classificação resíduos",
          "IFRS S2 Brasil CVM",
          "CVM Resolução 193 sustentabilidade",
          "NORMAM-05 Marinha transporte perigosos",
          "revisão CONAMA resíduos perigosos",
          "economia circular Lei 14.260/2021",
          "MTR-e manifesto transporte resíduos",
        ],
      },
      {
        key: "competitivo",
        title: "Radar Competitivo",
        terms: ["EmbTec big bag", "Ágilbag big bag", "Engebag", "homologação INMETRO big bag resíduos", "fabricante big bag resíduos perigosos Brasil"],
      },
      {
        key: "demanda",
        title: "Sinal de Demanda / Risco",
        terms: [
          "autuação IBAMA resíduos perigosos",
          "multa ambiental transporte rodoviário resíduo",
          "vazamento produto químico indústria Brasil",
          "fiscalização ANTT produtos perigosos rodovia",
          "passivo ambiental multa indústria",
          "polo petroquímico Camaçari resíduos",
          "mineração Pará Amazonas resíduos perigosos",
          "offshore óleo gás ANP resíduo",
        ],
      },
      {
        key: "setor",
        title: "Setor & Mercado",
        terms: ["gestão resíduos perigosos Brasil mercado", "ABRELPE panorama resíduos sólidos", "ESG passivo ambiental indústria"],
      },
    ],
  },
  sanwey: {
    categories: [
      {
        key: "marca",
        title: "Marca & Produto",
        terms: ["Sanwey Indústria de Containers", "Sanbag", "Sanwey Taboão da Serra"],
      },
      {
        key: "regulatorio",
        title: "Certificação & Regulatório por Segmento",
        terms: [
          "FSSC 22000 segurança alimentar Brasil",
          "ABNT NBR 16029 contentor flexível",
          "Type C condutivo ANP petroquímica",
          "fator de segurança FIBC granel",
          "contentor flexível semi-granel norma técnica",
          "INMETRO homologação carga perigosa FIBC",
        ],
      },
      {
        key: "competitivo",
        title: "Radar Competitivo & Setor",
        terms: ["fabricante FIBC Brasil", "big bag semi-granel indústria", "contentor flexível exportação Brasil"],
      },
      {
        key: "demanda",
        title: "Sinal de Demanda por Segmento",
        terms: [
          "recall alimentar contaminação embalagem Brasil",
          "exportação minério logística granel Brasil",
          "leilão ANP exploração offshore",
          "expansão petroquímica Brasil",
          "safra grãos exportação embalagem",
          "fertilizantes logística granel Brasil",
        ],
      },
      {
        key: "setor",
        title: "Setor & Mercado",
        terms: ["mercado embalagens industriais Brasil", "semi-granel logística Brasil", "exportação contentores flexíveis Brasil"],
      },
    ],
  },
};

// Categorias priorizadas pro resumo DIÁRIO — maior densidade de eventos
// acionáveis (janela de urgência de compra ou risco). "marca" e "setor"
// ficam de fora daqui por baixo rendimento/urgência (revisão semanal basta).
export const DAILY_PRIORITY_CATEGORIES = ["regulatorio", "competitivo", "demanda"];

function orQuery(terms: string[]): string {
  return terms.map((t) => (t.includes(" ") ? `"${t}"` : t)).join(" OR ");
}

function decodeXmlEntities(s: string): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .trim();
}

async function fetchNewsForQuery(query: string, limit: number): Promise<NewsItem[]> {
  const url = new URL(GOOGLE_NEWS_RSS);
  url.searchParams.set("q", `${query} when:3d`);
  url.searchParams.set("hl", "pt-BR");
  url.searchParams.set("gl", "BR");
  url.searchParams.set("ceid", "BR:pt-BR");

  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`Google News RSS ${res.status}`);
  const xml = await res.text();

  const items: NewsItem[] = [];
  const itemRe = /<item>([\s\S]*?)<\/item>/g;
  let m: RegExpExecArray | null;
  while ((m = itemRe.exec(xml)) && items.length < limit) {
    const block = m[1];
    const title = block.match(/<title>([\s\S]*?)<\/title>/)?.[1];
    const source = block.match(/<source[^>]*>([\s\S]*?)<\/source>/)?.[1] ?? "";
    if (title) items.push({ title: decodeXmlEntities(title), source: decodeXmlEntities(source) });
  }
  return items;
}

/**
 * Busca manchetes recentes (últimos 3 dias) por frente, restrito às
 * categorias em `categoryKeys` (default: as prioritárias pro resumo
 * diário — ver DAILY_PRIORITY_CATEGORIES), e devolve um bloco de texto
 * pronto pra injetar num prompt do /fast. Cada categoria é uma busca OR de
 * todos os seus termos — falha de UMA categoria não derruba as outras.
 */
export async function getSectorNewsBlock(
  frentes: FrenteKey[] = ["resibag", "sanwey"],
  categoryKeys: string[] = DAILY_PRIORITY_CATEGORIES,
  perCategory = 3,
): Promise<string> {
  const frenteBlocks = await Promise.all(
    frentes.map(async (frente) => {
      const config = SECTOR_NEWS_TERMS[frente];
      const categories = config.categories.filter((c) => categoryKeys.includes(c.key));

      const categoryBlocks = await Promise.all(
        categories.map(async (cat) => {
          try {
            const items = await fetchNewsForQuery(orQuery(cat.terms), perCategory);
            if (items.length === 0) return `  ${cat.title}: sem manchetes relevantes nas últimas 72h.`;
            const lines = items.map((i) => `    - ${i.title}${i.source ? ` (${i.source})` : ""}`).join("\n");
            return `  ${cat.title}:\n${lines}`;
          } catch (err) {
            console.error(`[news] '${frente}'/'${cat.key}' falhou:`, String(err));
            return `  ${cat.title}: (busca indisponível no momento)`;
          }
        }),
      );

      return `${frente.toUpperCase()}\n${categoryBlocks.join("\n")}`;
    }),
  );

  return frenteBlocks.join("\n\n");
}
