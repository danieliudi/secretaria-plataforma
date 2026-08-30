// Regras compartilhadas entre as duas rotas de recebimento de reunião e as
// telas. Fica no `lib` (Node/Next), separado de supabase/functions/_shared
// (Deno) — os dois runtimes não compartilham módulo, mesma situação já
// documentada em app/api/feedback/route.ts.

/** Bucket privado do áudio (ver migration 20260829_reunioes.sql). */
export const BUCKET_REUNIOES = "reunioes";

/**
 * Tipos aceitos → extensão do arquivo no Storage.
 *
 * A extensão vem DAQUI, do content-type, e nunca do nome do arquivo que o
 * celular mandou: nome de arquivo é entrada hostil e é ele que iria compor o
 * caminho no bucket. Um nome tipo "../outro-tenant/x.m4a" não tem como virar
 * caminho porque o nome nunca é usado pra montar caminho nenhum — o caminho é
 * sempre '<tenant_id>/<uuid gerado por nós>.<ext desta tabela>'.
 *
 * `video/mp4` está na lista de propósito: gravador nativo de Android às vezes
 * rotula .m4a assim, e recusar deixaria a pessoa sem entender por quê.
 */
export const TIPOS_AUDIO: Record<string, string> = {
  "audio/mpeg": "mp3",
  "audio/mp3": "mp3",
  "audio/mp4": "m4a",
  "audio/m4a": "m4a",
  "audio/x-m4a": "m4a",
  "audio/aac": "aac",
  "audio/ogg": "ogg",
  "audio/opus": "opus",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "audio/webm": "webm",
  "audio/3gpp": "3gp",
  "audio/amr": "amr",
  "video/mp4": "m4a",
};

/**
 * Teto de tamanho. Precisa bater com DOIS lugares no Supabase, e os dois
 * valem — o menor ganha:
 *   1. `file_size_limit` do bucket (migration 20260829_reunioes.sql);
 *   2. o teto GLOBAL do projeto (Dashboard → Storage → Settings), que vem
 *      com 50 MB de fábrica.
 *
 * O (2) foi o que derrubou o primeiro teste real (30/08/2026): uma gravação
 * de 59 min tinha 59 MB e o Storage devolveu 400 depois de 11 segundos
 * subindo. Uma hora de gravação de celular dá 30-60 MB, então 50 MB não
 * cobre nem uma reunião normal — o global foi subido pra 200 MB.
 */
export const MAX_BYTES = 200 * 1024 * 1024;
/** Abaixo disso não é reunião — é toque acidental no botão de compartilhar. */
export const MIN_BYTES = 8 * 1024;

/**
 * Teto de reuniões por dia, por conta. Diferente do resto do produto, cada
 * uma destas custa dinheiro de verdade por HORA DE ÁUDIO (~US$ 0,27/h) — sem
 * teto, um script (ou um bug de retry no próprio celular) compartilhando em
 * loop viraria conta de centenas de dólares antes de alguém perceber.
 */
export const MAX_REUNIOES_POR_DIA = 20;

/**
 * Content-type sem parâmetro: 'audio/mp4; codecs="mp4a.40.2"' → 'audio/mp4'.
 *
 * Precisa existir porque o valor é comparado com `allowed_mime_types` do
 * bucket, que casa exato — mandar o tipo com o parâmetro de codec junto faz o
 * Storage recusar um arquivo perfeitamente válido.
 */
export function tipoLimpo(tipo: string): string {
  return tipo.toLowerCase().split(";")[0].trim();
}

export function extensaoDoTipo(tipo: string): string | null {
  return TIPOS_AUDIO[tipoLimpo(tipo)] ?? null;
}

/**
 * Título a partir do nome do arquivo: tira a extensão, troca separador por
 * espaço e corta. É TEXTO DE TERCEIRO indo pra tela — o React já escapa, e o
 * corte aqui evita que um nome absurdo estoure o CHECK da coluna.
 */
export function tituloDoNome(nome: string): string {
  const semExt = nome.replace(/\.[A-Za-z0-9]{1,8}$/, "");
  const limpo = semExt.replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
  return limpo.slice(0, 200) || "Gravação";
}

export type StatusReuniao = "enviando" | "pendente" | "transcrevendo" | "entregue" | "erro";

/**
 * Extensão do nome do arquivo → content-type conhecido. Só é usado como
 * ÚLTIMO recurso, quando o Android não informa o tipo (manda
 * "application/octet-stream"). O valor de saída é sempre uma chave de
 * TIPOS_AUDIO — a extensão do nome nunca chega a compor caminho.
 */
const EXT_PARA_TIPO: Record<string, string> = {
  mp3: "audio/mpeg",
  m4a: "audio/m4a",
  mp4: "video/mp4",
  aac: "audio/aac",
  ogg: "audio/ogg",
  oga: "audio/ogg",
  opus: "audio/opus",
  wav: "audio/wav",
  webm: "audio/webm",
  "3gp": "audio/3gpp",
  "3gpp": "audio/3gpp",
  amr: "audio/amr",
};

export function tipoPorExtensao(nome: string): string | null {
  const m = /\.([A-Za-z0-9]{1,5})$/.exec(nome.trim());
  if (!m) return null;
  return EXT_PARA_TIPO[m[1].toLowerCase()] ?? null;
}

/** "42 min" / "1h07" — duração legível. Usada nas duas telas de reunião. */
export function duracaoTexto(seg: number | null | undefined): string {
  if (!seg) return "";
  if (seg < 60) return `${seg}s`;
  const min = Math.round(seg / 60);
  if (min < 60) return `${min} min`;
  return `${Math.floor(min / 60)}h${String(min % 60).padStart(2, "0")}`;
}

/** ms → "MM:SS" ou "H:MM:SS" (espelha formataTempo de _shared/diarizacao.ts). */
export function formataTempo(ms: number): string {
  const totalSeg = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(totalSeg / 3600);
  const m = Math.floor((totalSeg % 3600) / 60);
  const s = totalSeg % 60;
  const mm = String(m).padStart(2, "0");
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}
