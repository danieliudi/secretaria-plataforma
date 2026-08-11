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
const FONT_REGULAR_URL = "https://cdn.jsdelivr.net/npm/@fontsource/inter@5.0.16/files/inter-latin-400-normal.woff";
const FONT_BOLD_URL = "https://cdn.jsdelivr.net/npm/@fontsource/inter@5.0.16/files/inter-latin-700-normal.woff";
const RESVG_WASM_URL = "https://cdn.jsdelivr.net/npm/@resvg/resvg-wasm@2.6.2/index_bg.wasm";

let fontesCache: Array<{ name: string; data: ArrayBuffer; weight: 400 | 700; style: "normal" }> | null = null;
let wasmPronto = false;

async function carregaFontes() {
  if (fontesCache) return fontesCache;
  const [reg, bold] = await Promise.all([
    fetch(FONT_REGULAR_URL).then((r) => r.arrayBuffer()),
    fetch(FONT_BOLD_URL).then((r) => r.arrayBuffer()),
  ]);
  fontesCache = [
    { name: "Inter", data: reg, weight: 400, style: "normal" },
    { name: "Inter", data: bold, weight: 700, style: "normal" },
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
export const CARD = {
  ink: "#10201f",
  ink2: "#17302e",
  line: "#24423f",
  fg: "#eef5f3",
  mut: "#8fa9a5",
  accent: "#4ecdc0",
  warn: "#e8a13a",
  crit: "#e5695c",
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
      fontFamily: "Inter",
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
      el(
        "div",
        { display: "flex", flexDirection: "column" },
        el("div", { display: "flex", fontSize: 16, letterSpacing: 2, color: CARD.accent, fontWeight: 700 }, kicker),
        el("div", { display: "flex", fontSize: 34, fontWeight: 700, marginTop: 6 }, titulo),
      ),
      el("div", { display: "flex", fontSize: 20, color: CARD.mut, paddingTop: 8 }, canto),
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

/** Caixa de destaque com as propostas da secretária ("→ posso fazer X?"). */
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
    ...linhas.map((l) => el("div", { display: "flex", fontSize: 20, color: CARD.fg }, `→  ${l}`)),
  );
}
