// Cards visuais (PNG) enviados no WhatsApp.
//
// Por que existe: certas mensagens proativas são dado estruturado que a pessoa
// VARRE com o olho — agenda do dia, comparação entre clientes, números de
// tráfego. Em texto viram parede; em card, ela entende em dois segundos.
//
// Pipeline: satori monta o layout (subset de flexbox) e devolve SVG; resvg
// rasteriza pra PNG. Nenhum dos dois precisa de navegador, então roda na edge
// function. Medido em ~360ms no total pra um card destes — sempre em rotina
// proativa (cron), nunca com alguém esperando resposta no chat.
//
// REGRA DE USO (ver também whatsapp.ts): imagem no WhatsApp NÃO é buscável.
// Todo card vai acompanhado de uma bolha de texto com o essencial — o card é
// a camada de escaneio, o texto é a camada de memória. Nunca só o card.

import satori from "npm:satori@0.10.13";
import { Resvg, initWasm } from "npm:@resvg/resvg-wasm@2.6.2";

// A fonte precisa vir como bytes (satori não usa fonte do sistema) e o resvg
// wasm precisa ser inicializado uma vez. Ambos ficam em cache de módulo — a
// edge function reaproveita entre invocações no mesmo isolate.
//
// Rebrand 20/08/2026: Instrument Sans → Hanken Grotesk (corpo/rótulo) + Eb
// Garamond (só o título do card, papel de "headline") — mesmas duas fontes
// que o site passou a usar (ver app/layout.tsx), pra manter o card do mesmo
// produto que o WhatsApp mostra em texto. Título ganha fonte própria porque
// é o único elemento do card com papel de "manchete"; o resto (kicker,
// linhas, ações, rodapé) é sempre corpo/rótulo.
const FONT_BODY_REGULAR_URL = "https://cdn.jsdelivr.net/npm/@fontsource/hanken-grotesk@5.2.5/files/hanken-grotesk-latin-400-normal.woff";
const FONT_BODY_BOLD_URL = "https://cdn.jsdelivr.net/npm/@fontsource/hanken-grotesk@5.2.5/files/hanken-grotesk-latin-700-normal.woff";
const FONT_DISPLAY_URL = "https://cdn.jsdelivr.net/npm/@fontsource/eb-garamond@5.2.5/files/eb-garamond-latin-500-normal.woff";
const FONT_DISPLAY_BOLD_URL = "https://cdn.jsdelivr.net/npm/@fontsource/eb-garamond@5.2.5/files/eb-garamond-latin-700-normal.woff";
const RESVG_WASM_URL = "https://cdn.jsdelivr.net/npm/@resvg/resvg-wasm@2.6.2/index_bg.wasm";

const FONT_BODY = "Hanken Grotesk";
const FONT_DISPLAY = "Eb Garamond";

let fontesCache:
  | Array<{ name: string; data: ArrayBuffer; weight: 400 | 500 | 700; style: "normal" }>
  | null = null;
let wasmPronto = false;

async function carregaFontes() {
  if (fontesCache) return fontesCache;
  const [bodyReg, bodyBold, display, displayBold] = await Promise.all([
    fetch(FONT_BODY_REGULAR_URL).then((r) => r.arrayBuffer()),
    fetch(FONT_BODY_BOLD_URL).then((r) => r.arrayBuffer()),
    fetch(FONT_DISPLAY_URL).then((r) => r.arrayBuffer()),
    fetch(FONT_DISPLAY_BOLD_URL).then((r) => r.arrayBuffer()),
  ]);
  fontesCache = [
    { name: FONT_BODY, data: bodyReg, weight: 400, style: "normal" },
    { name: FONT_BODY, data: bodyBold, weight: 700, style: "normal" },
    { name: FONT_DISPLAY, data: display, weight: 500, style: "normal" },
    { name: FONT_DISPLAY, data: displayBold, weight: 700, style: "normal" },
  ];
  return fontesCache;
}

async function garanteWasm() {
  if (wasmPronto) return;
  await initWasm(await fetch(RESVG_WASM_URL).then((r) => r.arrayBuffer()));
  wasmPronto = true;
}

// ─── paleta do card ─────────────────────────────────────────────────────────
// Fixa de propósito: o card vira PNG e é visto dentro do WhatsApp, então não
// acompanha tema claro/escuro de ninguém — tem que se sustentar sozinho nos dois.
//
// Mesmos tokens do Aurora (app/globals.css). Rebrand 20/08/2026: violeta
// escuro → slate claro + ouro clássico, tokens tirados ao pé da letra de um
// board de referência (Primary #0F172A / Secondary #334155 / Tertiary
// #D4AF37 / Neutral #F8FAFC — a rampa Slate do Tailwind + um dourado). Fundo
// virou claro — `ink`/`ink2`/`line` inverteram de branco-transparente pra
// preto-transparente. `warn`/`crit` aprofundados: os valores antigos foram
// calibrados pra contraste em fundo ESCURO e ficavam ilegíveis no claro.
export const CARD = {
  ink: "#f8fafc",
  ink2: "rgba(15,23,42,0.045)",
  line: "rgba(15,23,42,0.1)",
  fg: "#0f172a",
  mut: "#64748b",
  accent: "#d4af37",
  warn: "#b8752e",
  crit: "#b33939",
} as const;

export const LARGURA_CARD = 800;

// deno-lint-ignore no-explicit-any
type El = any;

/** Elemento no formato que o satori espera — mesma forma do React, sem JSX. */
export function el(type: string, style: Record<string, unknown>, ...children: El[]): El {
  return {
    type,
    props: {
      style,
      children: children.length === 0 ? undefined : children.length === 1 ? children[0] : children,
    },
  };
}

/** Renderiza um elemento em PNG e devolve em base64 (pronto pro sendWhatsAppImage). */
export async function renderCardPngBase64(elemento: El, largura = LARGURA_CARD): Promise<string> {
  const [fontes] = await Promise.all([carregaFontes(), garanteWasm()]);
  const svg = await satori(elemento, { width: largura, fonts: fontes });
  const png = new Resvg(svg, { fitTo: { mode: "width", value: largura } }).render().asPng();
  // btoa não aceita Uint8Array direto; converte em chunks pra não estourar a
  // pilha com spread num array grande.
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < png.length; i += chunk) {
    bin += String.fromCharCode(...png.subarray(i, i + chunk));
  }
  return btoa(bin);
}

// ─── blocos reutilizáveis ───────────────────────────────────────────────────

export function cardShell(
  kicker: string,
  titulo: string,
  canto: string,
  corpo: El[],
  rodape: string,
): El {
  return el(
    "div",
    {
      display: "flex",
      flexDirection: "column",
      width: LARGURA_CARD,
      background: CARD.ink,
      color: CARD.fg,
      fontFamily: FONT_BODY,
    },
    el(
      "div",
      {
        display: "flex",
        justifyContent: "space-between",
        alignItems: "flex-start",
        padding: "30px 34px 24px",
        borderBottom: `1px solid ${CARD.line}`,
      },
      // `flex: 1` + `minWidth: 0` no bloco do título: sem isso, um título
      // longo o bastante pra quebrar linha empurra o `canto` pra fora da
      // largura do card em vez de quebrar dentro do próprio espaço — achado
      // testando o card de prep de reunião (20/08/2026), mas é bug do shell,
      // vale pra qualquer card com título comprido.
      el(
        "div",
        { display: "flex", flexDirection: "column", flex: 1, minWidth: 0 },
        el("div", { display: "flex", fontSize: 15, letterSpacing: 2, color: CARD.accent, fontWeight: 700 }, kicker),
        el(
          "div",
          { display: "flex", fontSize: 36, fontWeight: 500, marginTop: 7, fontFamily: FONT_DISPLAY },
          titulo,
        ),
      ),
      el("div", { display: "flex", flexShrink: 0, marginLeft: 16, fontSize: 20, color: CARD.mut, paddingTop: 8 }, canto),
    ),
    el("div", { display: "flex", flexDirection: "column", padding: "22px 34px 26px" }, ...corpo),
    el(
      "div",
      {
        display: "flex",
        alignItems: "center",
        gap: 9,
        padding: "16px 34px 20px",
        borderTop: `1px solid ${CARD.line}`,
        fontSize: 16,
        color: CARD.mut,
      },
      el("div", { display: "flex", width: 9, height: 9, borderRadius: 2, background: CARD.accent }),
      el("div", { display: "flex" }, rodape),
    ),
  );
}

/** Linha de timeline: horário + marcador + título/subtítulo. */
export function linhaTimeline(hora: string, titulo: string, sub: string, ultima = false): El {
  return el(
    "div",
    {
      display: "flex",
      gap: 14,
      alignItems: "flex-start",
      padding: "13px 0",
      borderBottom: ultima ? "none" : `1px solid ${CARD.line}`,
    },
    el("div", { display: "flex", width: 62, fontSize: 20, color: CARD.mut }, hora),
    el("div", { display: "flex", width: 10, height: 10, borderRadius: 5, background: CARD.accent, marginTop: 7 }),
    el(
      "div",
      { display: "flex", flexDirection: "column", flex: 1 },
      el("div", { display: "flex", fontSize: 23, fontWeight: 600, color: CARD.fg }, titulo),
      el("div", { display: "flex", fontSize: 18, color: CARD.mut, marginTop: 2 }, sub),
    ),
  );
}

/**
 * Linha de timeline em estado de conflito — fundo e barra na cor crítica.
 * Separada de `linhaTimeline` porque o que ela comunica é diferente: ali a
 * cor marca "isto existe", aqui marca "isto colide".
 */
export function linhaConflito(hora: string, titulo: string, sub: string): El {
  return el(
    "div",
    {
      display: "flex",
      gap: 14,
      alignItems: "flex-start",
      padding: "13px 16px",
      marginBottom: 8,
      background: "rgba(179,57,57,0.1)", // CARD.crit (#b33939) em rgba, pro tint de fundo
      borderLeft: `4px solid ${CARD.crit}`,
      borderRadius: 6,
    },
    el("div", { display: "flex", width: 118, fontSize: 20, color: CARD.mut }, hora),
    el(
      "div",
      { display: "flex", flexDirection: "column", flex: 1 },
      el("div", { display: "flex", fontSize: 23, fontWeight: 600, color: CARD.fg }, titulo),
      el("div", { display: "flex", fontSize: 18, color: CARD.mut, marginTop: 2 }, sub),
    ),
  );
}

/**
 * Barras verticais de carga por dia. É o único formato aqui que só funciona em
 * imagem: sete números em texto não mostram onde está o aperto, sete barras
 * mostram antes de a pessoa ler.
 */
export function barrasSemana(
  dias: Array<{ rotulo: string; minutos: number; pesado: boolean }>,
): El {
  const alturaMax = 150;
  const pico = Math.max(60, ...dias.map((d) => d.minutos));
  // Larguras explícitas em vez de `flex: 1` / `height: "100%"`: o satori
  // implementa só um subconjunto de flexbox, e porcentagem/flex-grow são
  // justamente onde ele diverge do navegador. Como o card tem largura fixa,
  // a conta é trivial: 800 - 68 de padding - 6 gaps de 12 = 660 / 7 colunas.
  const larguraColuna = Math.floor((LARGURA_CARD - 68 - 6 * 12) / 7);
  return el(
    "div",
    { display: "flex", gap: 12, alignItems: "flex-end", paddingTop: 12 },
    ...dias.map((d) =>
      el(
        "div",
        { display: "flex", flexDirection: "column", alignItems: "center", width: larguraColuna },
        el(
          "div",
          { display: "flex", fontSize: 17, color: CARD.mut, marginBottom: 6 },
          d.minutos === 0 ? "—" : duracaoCurta(d.minutos),
        ),
        el("div", {
          display: "flex",
          width: larguraColuna,
          // Piso de 4px: um dia vazio precisa aparecer como base da barra, não
          // sumir — a ausência de compromisso é informação.
          height: Math.max(4, Math.round((d.minutos / pico) * alturaMax)),
          background: d.pesado ? CARD.crit : CARD.accent,
          borderRadius: 4,
        }),
        el("div", { display: "flex", fontSize: 17, color: CARD.mut, marginTop: 10, letterSpacing: 1 }, d.rotulo),
      )
    ),
  );
}

/** "3h20" → "3h" no rótulo da barra; espaço ali é escasso. */
function duracaoCurta(min: number): string {
  const h = min / 60;
  return h >= 1 ? `${Math.round(h)}h` : `${min}min`;
}

/**
 * Barras horizontais proporcionais ao atraso. Numa lista de texto "9 dias" e
 * "1 dia" ocupam a mesma linha e pesam igual; aqui o tamanho é o argumento.
 */
export function barrasAtraso(itens: Array<{ titulo: string; dias: number }>): El {
  const pico = Math.max(1, ...itens.map((i) => i.dias));
  return el(
    "div",
    { display: "flex", flexDirection: "column", gap: 14 },
    ...itens.map((i) =>
      el(
        "div",
        { display: "flex", alignItems: "center", gap: 16 },
        // Corte no texto em vez de overflow/ellipsis do CSS: um título longo
        // empurraria a barra e destruiria a comparação, que é o ponto do card.
        el(
          "div",
          { display: "flex", width: 300, fontSize: 21, color: CARD.fg },
          i.titulo.length > 30 ? `${i.titulo.slice(0, 29)}…` : i.titulo,
        ),
        el("div", {
          display: "flex",
          width: Math.max(10, Math.round((i.dias / pico) * 320)),
          height: 14,
          background: i.dias >= 7 ? CARD.crit : CARD.warn,
          borderRadius: 7,
        }),
        el(
          "div",
          { display: "flex", fontSize: 19, color: CARD.mut },
          `${i.dias}d`,
        ),
      )
    ),
  );
}

/**
 * Duas barras horizontais comparando um valor observado com uma referência
 * (ex: despesa vs média da categoria) — mesmo padrão visual de `barrasAtraso`,
 * adaptado pra comparar 2 grandezas em vez de listar N itens. A primeira barra
 * (`a`) é sempre a cor crítica — é o valor que disparou o alerta; a segunda
 * (`b`) é a referência, em tom neutro.
 */
export function barrasComparacao(
  a: { rotulo: string; valor: number; texto: string },
  b: { rotulo: string; valor: number; texto: string },
): El {
  const pico = Math.max(1, a.valor, b.valor);
  const larguraMax = 320;
  const linha = (item: typeof a, cor: string) =>
    el(
      "div",
      { display: "flex", alignItems: "center", gap: 10, marginBottom: 8 },
      el("div", { display: "flex", width: 96, fontSize: 15, color: CARD.mut }, item.rotulo),
      el(
        "div",
        { display: "flex", width: larguraMax, height: 10, background: CARD.ink2, borderRadius: 5 },
        el("div", {
          display: "flex",
          width: Math.max(6, Math.round((item.valor / pico) * larguraMax)),
          height: 10,
          background: cor,
          borderRadius: 5,
        }),
      ),
      el("div", { display: "flex", width: 88, fontSize: 15, color: CARD.fg, justifyContent: "flex-end" }, item.texto),
    );
  return el(
    "div",
    { display: "flex", flexDirection: "column" },
    linha(a, CARD.crit),
    linha(b, CARD.mut),
  );
}

/**
 * Caixa de destaque com as propostas da secretária ("» posso fazer X?").
 *
 * Usa "»" (guillemet), não "→": o subset "latin" das fontes via fontsource
 * (Inter antes, Instrument Sans agora) não inclui o bloco Unicode de setas —
 * "→" virava um retângulo vazio (tofu) no PNG renderizado. Achado testando
 * este reskin — bug preexistente, não introduzido por ele.
 */
export function caixaAcoes(linhas: string[]): El {
  return el(
    "div",
    {
      display: "flex",
      flexDirection: "column",
      gap: 8,
      marginTop: 22,
      padding: "16px 18px",
      background: CARD.ink2,
      borderRadius: 10,
    },
    ...linhas.map((l) => el("div", { display: "flex", fontSize: 20, color: CARD.fg }, `»  ${l}`)),
  );
}
