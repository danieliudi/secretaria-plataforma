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
  const bytes = new TextEncoder().encode(s);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}
