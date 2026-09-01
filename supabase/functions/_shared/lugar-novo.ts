// "Lugar novo": na véspera, avisar quando amanhã tem um endereço onde a pessoa
// nunca esteve — e o que costuma dar errado na primeira vez.
//
// SEM PREVISÃO DO TEMPO, de propósito (decisão do Daniel, 31/08/2026). O reel
// que originou a ideia falava em guarda-chuva, mas todo fornecedor de previsão
// ou cobra (Open-Meteo comercial, ~€29/mês) ou é mais um cadastro pra manter.
// Previsão ele tem no celular em dois segundos; "eu nunca fui nesse lugar"
// ninguém dá. Ficou só a parte que não dá pra conseguir em outro lugar.
//
// TUDO AQUI É DETERMINÍSTICO, sem chamada de modelo. Não é economia: é que as
// duas afirmações que a mensagem faz — "você nunca esteve aí" e "esse tipo de
// lugar costuma pedir X" — são exatamente as que não podem ser inventadas. Um
// modelo solto aqui diria "leve guarda-chuva" sem ter dado nenhum de tempo.
//
// VIÉS DELIBERADO PRO SILÊNCIO: na dúvida entre "lugar novo" e "já conhecido",
// trata como conhecido e não fala nada. Dizer "você nunca foi aí" sobre o
// escritório onde a pessoa vai toda semana queima a confiança na feature
// inteira; deixar passar um lugar novo de vez em quando só a torna mais quieta.

/** Quanto tempo de agenda passada conta como "já estive aqui". */
export const MESES_DE_HISTORICO = 12;

/**
 * Compromissos virtuais não são lugares — nunca viram "lugar novo".
 *
 * Duas formas, e a segunda faltava: o link (o que o convite cola no campo) e o
 * NOME DO PRODUTO EM TEXTO PURO, que é o que o Outlook e o Google Calendar
 * escrevem no local ("Microsoft Teams Meeting"). Sem as formas de texto, uma
 * reunião de Teams passava por endereço físico e virava um "amanhã tem lugar
 * novo" sobre uma sala que não existe — o tipo de erro que, pelo viés declarado
 * no topo deste arquivo, é o mais caro que esta feature pode cometer.
 * Pego pelo CI em 01/09/2026 (_tests/lugar-novo.test.ts).
 */
const MARCAS_DE_VIRTUAL = [
  // links
  "meet.google", "zoom.us", "teams.microsoft", "teams.live", "whereby",
  "http://", "https://", "webex", "hangout",
  // nome do produto em texto puro, como o convite escreve
  "microsoft teams", "teams meeting", "google meet", "zoom meeting", "skype",
  // genéricos
  "online", "remoto", "virtual", "a definir", "a confirmar",
];

// Palavras que aparecem em QUALQUER endereço brasileiro e por isso não
// distinguem um lugar de outro. Contá-las faria "Rua A" casar com "Rua B".
const RUIDO = new Set([
  "rua", "r", "avenida", "av", "alameda", "al", "travessa", "praca", "praça",
  "rodovia", "estrada", "km", "andar", "sala", "conjunto", "bloco", "torre",
  "apto", "apartamento", "n", "no", "num", "numero", "s", "sn",
  "brasil", "brazil", "sp", "rj", "mg", "pr", "rs", "sc", "ba", "pe", "ce",
  "de", "da", "do", "dos", "das", "e", "em", "no", "na",
]);

/** Minúsculas, sem acento, sem pontuação, sem CEP. */
export function normalizaLocal(bruto: string): string {
  return bruto
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    // CEP (12345-678 ou 12345678) some: o mesmo prédio aparece com e sem ele.
    .replace(/\b\d{5}-?\d{3}\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

/** Tokens que de fato distinguem um endereço de outro. */
export function tokensDistintivos(bruto: string): Set<string> {
  const tokens = normalizaLocal(bruto)
    .split(" ")
    .filter((t) => t.length >= 2 && !RUIDO.has(t));
  return new Set(tokens);
}

/** Compromisso sem lugar de verdade (online, vazio, "a definir"). */
export function ehVirtual(local: string | null): boolean {
  if (!local || !local.trim()) return true;
  const n = normalizaLocal(local);
  if (!n) return true;
  const cru = local.toLowerCase();
  return MARCAS_DE_VIRTUAL.some((m) => cru.includes(m) || n.includes(normalizaLocal(m)));
}

/**
 * Dois endereços são "o mesmo lugar"? Generoso de propósito — ver o viés pro
 * silêncio no topo do arquivo.
 *
 * Casa quando um contém o outro (o mesmo prédio escrito curto e longo), ou
 * quando compartilham 2+ tokens distintivos ("tita diadema" vs "rua x 400
 * diadema tita").
 */
export function mesmoLugar(a: string, b: string): boolean {
  const na = normalizaLocal(a);
  const nb = normalizaLocal(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  if (na.includes(nb) || nb.includes(na)) return true;

  const ta = tokensDistintivos(a);
  const tb = tokensDistintivos(b);
  let comuns = 0;
  for (const t of ta) if (tb.has(t)) comuns++;
  return comuns >= 2;
}

/** O lugar aparece em algum compromisso passado? */
export function jaEsteve(local: string, historico: string[]): boolean {
  return historico.some((h) => mesmoLugar(local, h));
}

// ─── O que costuma dar errado na primeira vez ───────────────────────────────
//
// Tabela fixa em vez de modelo, pelo mesmo motivo do resto do arquivo: são
// afirmações sobre o mundo real que não podem sair de um chute plausível.
// Cada linha existe porque é chata o suficiente pra estragar uma visita, e
// específica o suficiente pra não ser óbvia.

interface RegraDeLugar {
  /** Palavras no TÍTULO ou no ENDEREÇO que ligam a regra. */
  gatilhos: string[];
  dicas: string[];
}

const REGRAS: RegraDeLugar[] = [
  {
    gatilhos: ["planta", "fabrica", "industrial", "usina", "refinaria", "siderurgica", "galpao"],
    dicas: [
      "Planta industrial costuma exigir sapato fechado e calça comprida — tem portaria que barra.",
      "Crachá e liberação de acesso às vezes precisam ser pedidos na véspera.",
    ],
  },
  {
    gatilhos: ["obra", "canteiro", "construcao"],
    dicas: ["Canteiro de obra pede bota e capacete; alguns exigem integração de segurança antes de entrar."],
  },
  {
    gatilhos: ["hospital", "clinica", "laboratorio", "upa", "pronto socorro"],
    dicas: ["Leve documento com foto e carteirinha — a recepção costuma pedir antes de liberar."],
  },
  {
    gatilhos: ["cartorio", "forum", "tribunal", "receita", "prefeitura", "detran", "junta comercial"],
    dicas: [
      "Órgão público quase sempre quer documento ORIGINAL, não cópia nem foto.",
      "Confira se precisa de senha ou agendamento — sem isso costuma ser viagem perdida.",
    ],
  },
  {
    gatilhos: ["aeroporto", "terminal", "rodoviaria"],
    dicas: ["Conte o tempo de estacionamento e fila — o trajeto até o portão engana."],
  },
  {
    gatilhos: ["feira", "expo", "pavilhao", "centro de convencoes", "convencoes", "congresso"],
    dicas: [
      "Credencial de feira normalmente sai online antes e evita a fila do balcão.",
      "Pavilhão é longe do estacionamento e a caminhada interna é grande — sapato confortável.",
    ],
  },
  {
    gatilhos: ["cliente", "visita", "reuniao", "escritorio", "sede", "torre", "edificio", "empresarial"],
    dicas: ["Portaria de prédio comercial costuma pedir documento e liberação do anfitrião — subir demora."],
  },
];

/** Dicas do tipo de lugar. Vazio quando nenhuma regra reconhece — e aí não tem o que dizer. */
export function dicasDoLugar(titulo: string, local: string): string[] {
  const alvo = `${normalizaLocal(titulo)} ${normalizaLocal(local)}`;
  const vistas = new Set<string>();
  for (const regra of REGRAS) {
    if (!regra.gatilhos.some((g) => alvo.includes(normalizaLocal(g)))) continue;
    for (const d of regra.dicas) vistas.add(d);
  }
  return [...vistas];
}

// ─── A mensagem ─────────────────────────────────────────────────────────────

// Título e endereço vêm do Google Calendar, o que quer dizer que podem ter
// sido escritos por QUEM MANDOU O CONVITE — terceiro, não o usuário. Não vão
// pra prompt de modelo nenhum (a mensagem é determinística, e é justamente o
// que elimina a superfície de injeção aqui), mas vão pro WhatsApp: sem teto,
// um convite com título de 5.000 caracteres vira uma parede de texto na tela
// de quem nem aceitou o convite ainda.
const MAX_TITULO = 120;
const MAX_LOCAL = 160;

/** Corta no limite sem partir no meio de uma palavra quando dá. */
function corta(texto: string, max: number): string {
  const limpo = texto.replace(/\s+/g, " ").trim();
  if (limpo.length <= max) return limpo;
  const cortado = limpo.slice(0, max);
  const ultimoEspaco = cortado.lastIndexOf(" ");
  return `${ultimoEspaco > max * 0.6 ? cortado.slice(0, ultimoEspaco) : cortado}…`;
}

export interface CompromissoInedito {
  titulo: string;
  /** Hora já formatada em SP, ou null pra dia inteiro. */
  hora: string | null;
  local: string;
  /** Tem convidado além dele? Só então faz sentido oferecer procurar o convite. */
  temConvite: boolean;
}

/**
 * Uma mensagem por lugar novo. Fala do lugar e do que costuma dar errado —
 * nunca do tempo, que a gente não tem.
 */
export function montaAvisoLugarNovo(c: CompromissoInedito): string {
  const quando = c.hora ? `${c.hora} — ` : "";
  const linhas = [
    "📍 Lugar novo amanhã",
    "",
    `${quando}${corta(c.titulo, MAX_TITULO)}`,
    `${corta(c.local, MAX_LOCAL)}`,
    "Não achei registro de você aí — pela sua agenda, é a primeira vez.",
  ];

  const dicas = dicasDoLugar(c.titulo, c.local);
  if (dicas.length > 0) {
    linhas.push("", "o que costuma dar errado na primeira vez");
    for (const d of dicas) linhas.push(`• ${d}`);
  }

  if (c.temConvite) {
    linhas.push("", "Quer que eu procure o contato de lá no e-mail do convite?");
  }

  return linhas.join("\n");
}
