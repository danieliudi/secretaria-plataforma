// AssemblyAI como provedor de transcrição+diarização (ver _shared/diarizacao.ts
// pro contrato e pra decisão de 29/08/2026 de pagar em vez de self-hostar).
//
// Por que ele e não Whisper (que já usamos em _shared/transcribe.ts): o Whisker
// do Groq devolve texto corrido, sem NENHUMA separação de vozes. Pra ter "quem
// falou o quê" com Whisper seria preciso rodar um segundo modelo de diarização
// e costurar os dois resultados no tempo — e é exatamente nessa costura que a
// qualidade cai quando duas pessoas falam por cima, que é o caso normal de
// reunião. A AssemblyAI resolve os dois juntos, no mesmo modelo.
//
// O _shared/transcribe.ts CONTINUA como está e não é substituído: ele atende
// nota de voz de uma pessoa só (WhatsApp/Telegram), onde diarização não
// significa nada e o Groq é mais barato e muito mais rápido.

import { fetchComRetry } from "../http-retry.ts";
import {
  MAX_TRANSCRICAO_CHARS,
  MAX_TURNOS,
  type ProvedorDiarizacao,
  type ResultadoDiarizacao,
  type TurnoFala,
} from "../diarizacao.ts";

const API = "https://api.assemblyai.com/v2";

// Preço de lista da AssemblyAI por hora de áudio, com diarização ligada
// (consultado em 29/08/2026). Fica aqui, junto de quem sabe o que foi pedido,
// e não em lib/precos-modelo.ts: aquele arquivo é do Next e é medido em
// TOKENS. Se o preço mudar, muda aqui — e o valor já gravado nas reuniões
// antigas continua sendo o que de fato foi cobrado na época.
const USD_POR_HORA = 0.27;

/** Timeout por chamada. O trabalho pesado é do lado deles; aqui só falamos JSON. */
const TIMEOUT_MS = 20_000;

interface UtteranceAssembly {
  speaker?: string;
  text?: string;
  start?: number;
  end?: number;
}

interface TranscriptAssembly {
  id?: string;
  status?: string;
  text?: string;
  error?: string;
  audio_duration?: number;
  utterances?: UtteranceAssembly[];
}

export function createAssemblyAiProvider(
  env: (key: string) => string | undefined,
  fetchFn: typeof fetch = fetch,
): ProvedorDiarizacao {
  function chave(): string {
    const k = env("ASSEMBLYAI_API_KEY");
    if (!k) throw new Error("ASSEMBLYAI_API_KEY não configurada");
    return k;
  }

  // A AssemblyAI usa a chave CRUA no header `authorization`, sem o prefixo
  // "Bearer" que quase toda outra API usa. Mandar "Bearer <key>" devolve 401
  // sem explicar por quê — vale a linha de comentário pra ninguém "consertar"
  // isso depois.
  function headers(): HeadersInit {
    return { authorization: chave(), "content-type": "application/json" };
  }

  async function chamar(caminho: string, init: RequestInit): Promise<TranscriptAssembly> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    try {
      const res = await fetchComRetry(`${API}${caminho}`, { ...init, signal: ctrl.signal }, fetchFn);
      if (!res.ok) {
        // Só o status. O corpo de erro pode ecoar a URL assinada do áudio que
        // mandamos — e essa URL dá acesso ao arquivo. Nada disso vai pra log
        // nem pra mensagem de exceção.
        throw new Error(`AssemblyAI ${caminho} respondeu ${res.status}`);
      }
      return (await res.json()) as TranscriptAssembly;
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    nome: "assemblyai",

    async submeter(audioUrlAssinada: string, opcoes = {}): Promise<string> {
      const body = {
        audio_url: audioUrlAssinada,
        // O que estamos comprando: os turnos por falante.
        speaker_labels: true,
        // Fixar o idioma em vez de deixar detectar. A detecção erra com áudio
        // de sala ruidoso nos primeiros segundos, e errar o idioma estraga a
        // transcrição inteira — não há recuperação depois.
        language_code: opcoes.idiomaBcp47 ?? "pt",
        punctuate: true,
        format_text: true,
      };
      const data = await chamar("/transcript", { method: "POST", headers: headers(), body: JSON.stringify(body) });
      if (!data.id) throw new Error("AssemblyAI não devolveu id do job");
      return data.id;
    },

    async consultar(jobId: string): Promise<ResultadoDiarizacao> {
      // jobId vem do nosso banco, mas é interpolado numa URL — trato como
      // hostil por princípio, não por desconfiar da origem.
      if (!/^[A-Za-z0-9_-]{1,100}$/.test(jobId)) {
        return { estado: "erro", motivo: "id de job inválido" };
      }

      const data = await chamar(`/transcript/${jobId}`, { method: "GET", headers: headers() });

      if (data.status === "error") {
        // Mensagem do provedor: truncada e tratada como texto de terceiro.
        return { estado: "erro", motivo: (data.error ?? "falha na transcrição").slice(0, 300) };
      }
      if (data.status !== "completed") {
        return { estado: "processando" };
      }

      const turnos: TurnoFala[] = [];
      for (const u of (data.utterances ?? []).slice(0, MAX_TURNOS)) {
        const texto = (u.text ?? "").trim();
        if (!texto) continue;
        turnos.push({
          falante: (u.speaker ?? "?").slice(0, 8),
          texto,
          inicio_ms: Number(u.start) || 0,
          fim_ms: Number(u.end) || 0,
        });
      }

      const duracao_seg = Math.max(0, Math.round(Number(data.audio_duration) || 0));

      return {
        estado: "pronto",
        texto: (data.text ?? "").slice(0, MAX_TRANSCRICAO_CHARS),
        turnos,
        duracao_seg,
        custo_usd: Number(((duracao_seg / 3600) * USD_POR_HORA).toFixed(4)),
      };
    },
  };
}
