// Geração de documentos Word (.docx) e PowerPoint (.pptx) a partir de conteúdo
// estruturado — sem depender do Microsoft Graph nem do Google Drive: o
// arquivo é montado aqui e enviado como anexo pelo canal (WhatsApp/Telegram),
// igual ao CSV que `fast/tools/spreadsheet.ts` já manda. Funciona pra
// qualquer tenant, com Google ou Outlook conectado (ou nenhum dos dois).
//
// `docx` e `pptxgenjs` são pacotes puros em JS (zip + XML, sem binário nativo
// nem WASM) — mesmo padrão de trazer dependência npm que `card.ts` já usa
// pra satori/resvg.
import { Document, HeadingLevel, Packer, Paragraph, TextRun } from "npm:docx@9.7.1";
import PptxGenJS from "npm:pptxgenjs@4.0.1";

export interface DocumentoSecao {
  titulo: string;
  /** Cada item vira um parágrafo (Word) ou uma linha com marcador (PowerPoint). */
  conteudo: string[];
}

export interface DocumentoSpec {
  titulo: string;
  secoes: DocumentoSecao[];
}

export async function gerarDocx(spec: DocumentoSpec): Promise<Uint8Array> {
  const children: Paragraph[] = [
    new Paragraph({ text: spec.titulo, heading: HeadingLevel.TITLE }),
  ];

  for (const secao of spec.secoes) {
    children.push(new Paragraph({ text: secao.titulo, heading: HeadingLevel.HEADING_2 }));
    for (const linha of secao.conteudo) {
      children.push(new Paragraph({ children: [new TextRun(linha)] }));
    }
  }

  const doc = new Document({ sections: [{ children }] });
  return await Packer.toBuffer(doc);
}

/**
 * Sob a resolução do Deno, o default do `pptxgenjs` chega como namespace do
 * módulo, sem construct signature — `new PptxGenJS()` fazia `deno check`
 * recusar o arquivo inteiro (1 dos 6 erros que quebravam `deno test` em
 * 01/09/2026). Em runtime o valor É o construtor; o que falta é só a assinatura
 * no .d.ts.
 *
 * Em vez de `as any` (que apagaria a checagem do uso todo), o cast declara só a
 * superfície que este arquivo usa. Se o dia em que a API mudar chegar, quebra
 * aqui em vez de em produção.
 */
/** `addText` aceita texto simples OU uma lista de trechos (que é como saem os
 *  marcadores das seções, logo abaixo). Declarar só a forma string fez o CI
 *  recusar a chamada da lista — a interface tem que cobrir os dois usos reais
 *  deste arquivo, senão ela troca um erro de tipo por outro. */
type TrechoPptx = { text: string; options?: Record<string, unknown> };
interface SlidePptx {
  addText(texto: string | TrechoPptx[], opcoes: Record<string, unknown>): void;
}
interface ApresentacaoPptx {
  addSlide(): SlidePptx;
  write(opcoes: { outputType: string }): Promise<unknown>;
}
const ConstrutorPptx = PptxGenJS as unknown as new () => ApresentacaoPptx;

export async function gerarPptx(spec: DocumentoSpec): Promise<Uint8Array> {
  const pres = new ConstrutorPptx();

  const capa = pres.addSlide();
  capa.addText(spec.titulo, {
    x: 0.5,
    y: 2.2,
    w: 9,
    fontSize: 32,
    bold: true,
    align: "center",
  });

  for (const secao of spec.secoes) {
    const slide = pres.addSlide();
    slide.addText(secao.titulo, { x: 0.5, y: 0.4, w: 9, fontSize: 24, bold: true });
    slide.addText(
      secao.conteudo.map((linha) => ({ text: linha, options: { bullet: true, breakLine: true } })),
      { x: 0.5, y: 1.3, w: 9, h: 5, fontSize: 16, valign: "top" },
    );
  }

  const buf = await pres.write({ outputType: "nodebuffer" });
  return buf as Uint8Array;
}
