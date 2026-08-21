// Gerador CSV minimal (RFC 4180). Sem dependência externa.
// Quoting: campos contendo vírgula, aspas ou nova-linha são envolvidos em
// aspas; aspas internas viram duplicadas ("").

export interface CsvColumn<T> {
  /** Header que aparece na primeira linha. */
  label: string;
  /** Como extrair o valor da linha. Retorne string vazia pra ausentes. */
  pick: (row: T) => string | number | null | undefined;
}

function escapeField(raw: string | number | null | undefined): string {
  if (raw === null || raw === undefined) return "";
  const s = String(raw);
  if (s.includes(",") || s.includes('"') || s.includes("\n") || s.includes("\r")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

/**
 * Serializa `rows` em CSV. Usa CRLF como line terminator (RFC 4180).
 * Sem BOM por padrão; Excel-pt-BR abre fine com `text/csv; charset=utf-8`.
 */
export function toCsv<T>(rows: T[], columns: CsvColumn<T>[]): string {
  const header = columns.map((c) => escapeField(c.label)).join(",");
  const body = rows.map((row) =>
    columns.map((c) => escapeField(c.pick(row))).join(",")
  );
  return [header, ...body].join("\r\n") + "\r\n";
}

/** UTF-8 → base64. Usado pelo envio via Evolution. */
export function utf8ToBase64(s: string): string {
  return bytesToBase64(new TextEncoder().encode(s));
}

/** Bytes crus → base64. Usado pra anexo binário (ex: .docx/.pptx) via Evolution. */
export function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

// ─── parsing ────────────────────────────────────────────────────────────────
// Usado pela importação de CSV que o chefe manda de outra ferramenta (CRM,
// ERP, planilha) — ver fast/tools/importacao.ts.

export interface ParsedCsv {
  /** Cabeçalho, na ordem em que veio. */
  columns: string[];
  /** Uma linha por objeto {coluna: valor}, já cortado no teto de `maxRows`. */
  rows: Record<string, string>[];
  /** true se havia mais linhas além do teto — quem consome deve avisar. */
  truncated: boolean;
}

/**
 * Separa em registros (não em "linhas de texto"): um campo entre aspas pode
 * conter vírgula/ponto-e-vírgula e até quebra de linha, então o corte de
 * registro só pode acontecer numa quebra de linha FORA de aspas.
 */
function parseCsvRecords(texto: string, delimitador: string): string[][] {
  const records: string[][] = [];
  let field = "";
  let record: string[] = [];
  let inQuotes = false;

  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];
    if (inQuotes) {
      if (c === '"') {
        if (texto[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
      continue;
    }
    if (c === '"') {
      inQuotes = true;
      continue;
    }
    if (c === delimitador) {
      record.push(field);
      field = "";
      continue;
    }
    if (c === "\r") continue; // CRLF normalizado pelo \n abaixo
    if (c === "\n") {
      record.push(field);
      records.push(record);
      field = "";
      record = [];
      continue;
    }
    field += c;
  }
  if (field !== "" || record.length > 0) {
    record.push(field);
    records.push(record);
  }
  return records;
}

/**
 * Heurística barata: conta vírgula vs ponto-e-vírgula na primeira linha.
 * Excel em pt-BR exporta com ";" (porque "," já é o separador decimal), a
 * maioria das outras ferramentas exporta com ",".
 */
function detectaDelimitador(texto: string): string {
  const primeiraLinha = texto.split(/\r?\n/, 1)[0] ?? "";
  const pontoVirgulas = (primeiraLinha.match(/;/g) ?? []).length;
  const virgulas = (primeiraLinha.match(/,/g) ?? []).length;
  return pontoVirgulas > virgulas ? ";" : ",";
}

/**
 * Parser CSV tolerante (RFC 4180 + variantes comuns de exportação de
 * planilha): aceita "," ou ";" como delimitador (auto-detectado), ignora BOM,
 * respeita aspas com delimitador/quebra de linha embutida. NUNCA lança pra
 * CSV malformado — melhor esforço, já que o texto vem de exportação de
 * terceiro (dado hostil, sem contrato de formato).
 */
export function parseCsv(texto: string, maxRows = 2000): ParsedCsv {
  const semBom = texto.charCodeAt(0) === 0xfeff ? texto.slice(1) : texto;
  const delimitador = detectaDelimitador(semBom);
  const records = parseCsvRecords(semBom, delimitador)
    .filter((r) => !(r.length === 1 && r[0].trim() === ""));
  if (records.length === 0) return { columns: [], rows: [], truncated: false };

  const columns = records[0].map((c) => c.trim());
  const rows: Record<string, string>[] = [];
  let truncated = false;
  for (let i = 1; i < records.length; i++) {
    if (rows.length >= maxRows) {
      truncated = true;
      break;
    }
    const campos = records[i];
    const row: Record<string, string> = {};
    columns.forEach((col, idx) => {
      row[col || `coluna_${idx + 1}`] = (campos[idx] ?? "").trim();
    });
    rows.push(row);
  }
  return { columns, rows, truncated };
}
