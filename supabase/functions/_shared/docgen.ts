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

export async function gerarPptx(spec: DocumentoSpec): Promise<Uint8Array> {
  const pres = new PptxGenJS();

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
