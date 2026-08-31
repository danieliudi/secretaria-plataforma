// Interface comum de transcrição COM separação de vozes (diarização). Mesmo
// espírito de task-provider.ts: o cron chama sempre os mesmos dois métodos e
// não sabe qual serviço está por trás.
//
// POR QUE A INTERFACE EXISTE ANTES DE HAVER DOIS PROVEDORES (29/08/2026):
// a alternativa avaliada era rodar `pyannote` por conta própria pra não pagar
// API. A conta na época: economia de ~US$ 0,05–0,16 por hora de áudio, contra
// ter que manter uma peça de infra com GPU que a stack (Deno nas edge
// functions + Next na Netlify) não tem onde rodar — não existe um único
// arquivo .py no projeto. No volume atual isso é menos de US$ 1/mês de
// economia. A conta VIRA quando o volume passar de umas 400 horas de áudio
// por mês; por isso a decisão foi pagar agora e deixar a troca barata, não
// pagar e ficar preso.
//
// O contrato é ASSÍNCRONO de propósito. Transcrever uma reunião de uma hora
// leva minutos, e uma edge function não fica de pé esperando isso: `submeter`
// devolve um id na hora e `consultar` é chamado depois, pelo cron. Qualquer
// provedor futuro (inclusive um self-host nosso) tem que caber nesse formato.

/** Um turno de fala: uma pessoa falando de forma contínua. */
export interface TurnoFala {
  /** Rótulo cru do provedor — "A", "B", "C". Quem vira nome é a ata, não aqui. */
  falante: string;
  texto: string;
  inicio_ms: number;
  fim_ms: number;
}

export type ResultadoDiarizacao =
  | { estado: "processando" }
  | {
      estado: "pronto";
      /** Transcrição corrida, já sem marcação de falante. */
      texto: string;
      turnos: TurnoFala[];
      duracao_seg: number;
      /** Custo desta transcrição em dólar, calculado pelo próprio provedor. */
      custo_usd: number;
    }
  | { estado: "erro"; motivo: string };

export interface ProvedorDiarizacao {
  /** Nome curto pra log e pra gravar na linha da reunião — "assemblyai". */
  readonly nome: string;

  /**
   * Cria o job. Recebe uma URL ASSINADA e de vida curta pro áudio no nosso
   * Storage — o provedor busca o arquivo por conta dele. O áudio nunca passa
   * pela edge function: uma gravação de uma hora tem 30-60 MB e não cabe na
   * memória de um isolate junto com o resto do trabalho.
   */
  submeter(audioUrlAssinada: string, opcoes?: { idiomaBcp47?: string }): Promise<string>;

  /** Estado do job. Chamado pelo cron a cada tick até sair de "processando". */
  consultar(jobId: string): Promise<ResultadoDiarizacao>;
}

/** Limite de defesa: acima disso a transcrição é truncada antes de ir pro banco. */
export const MAX_TRANSCRICAO_CHARS = 400_000;
/** Idem pros turnos — uma reunião longa gera milhares; o suficiente pra ata. */
export const MAX_TURNOS = 4000;

/**
 * Junta os turnos num texto legível "Falante A: ...". É isto que vai pro
 * modelo que escreve a ata — o texto corrido do provedor perde justamente a
 * informação que a pessoa pediu (quem falou o quê).
 */
export function turnosParaTexto(turnos: TurnoFala[], maxChars = 60_000): string {
  const linhas: string[] = [];
  let total = 0;
  for (const t of turnos) {
    const linha = `Falante ${t.falante} [${formataTempo(t.inicio_ms)}]: ${t.texto}`;
    if (total + linha.length > maxChars) break;
    linhas.push(linha);
    total += linha.length + 1;
  }
  return linhas.join("\n");
}

/** ms → "MM:SS" ou "H:MM:SS". */
export function formataTempo(ms: number): string {
  const totalSeg = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(totalSeg / 3600);
  const m = Math.floor((totalSeg % 3600) / 60);
  const s = totalSeg % 60;
  const mm = String(m).padStart(2, "0");
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

/**
 * Mapa "Falante A" → nome, a partir do bloco FALANTES que o modelo devolve ao
 * escrever a ata (ver gerarAtaDaReuniao em cron/index.ts).
 *
 * Parse deliberadamente DESCONFIADO: qualquer linha fora do formato exato é
 * ignorada, e o falante segue como "Falante X" na tela. Atribuir uma frase à
 * pessoa errada numa ata de reunião é pior que admitir que não se sabe — é o
 * tipo de erro que vira briga real entre pessoas de verdade.
 *
 * Também é a fronteira onde saída de modelo vira texto exibido: o rótulo é
 * cortado em 60 caracteres pra um "nome" degenerado não estourar o layout.
 */
export function parseFalantes(bloco: string): Record<string, string> {
  const mapa: Record<string, string> = {};
  for (const linha of bloco.split("\n")) {
    const m = /^\s*([A-Z])\s*=\s*(.{1,60}?)\s*$/.exec(linha);
    if (!m) continue;
    const nome = m[2].trim();
    // "?" é a resposta honesta do modelo pra "não sei" — não vira nome.
    // "Falante B" tampouco: seria o rótulo cru fingindo ser identificação.
    if (!nome || nome === "?" || /^falante\b/i.test(nome)) continue;
    mapa[m[1]] = nome.slice(0, 60);
  }
  return mapa;
}

/**
 * Limpa a mensagem de erro do provedor antes de ela ser guardada no banco e
 * mostrada na tela.
 *
 * O motivo é concreto: o que mandamos pro provedor é uma URL ASSINADA do
 * áudio, e a mensagem de erro dele costuma ecoar a URL que ele tentou buscar.
 * Essa URL dá acesso ao arquivo por uma hora — não tem por que ficar gravada
 * em texto puro numa coluna que a tela lê.
 */
export function erroSeguroDeProvedor(motivo: string): string {
  return motivo.replace(/https?:\/\/\S+/gi, "[url removida]").slice(0, 500);
}

/** Compromisso que a ata identificou. Prazo em linguagem natural, como foi dito. */
export interface TarefaSugerida {
  titulo: string;
  quem?: string;
  quando?: string;
}

/** Teto de tarefas sugeridas por reunião — acima disso vira lista que ninguém lê. */
export const MAX_TAREFAS_SUGERIDAS = 12;

/**
 * Lê o bloco TAREFAS que o modelo devolve junto da ata:
 * `- o que fazer | quem | quando`.
 *
 * Tolerante como o parseFalantes, e pelo MESMO motivo: linha que não casa o
 * formato é descartada, nunca adivinhada. Uma tarefa inventada a partir de uma
 * linha malformada vira compromisso no nome de alguém — e depois cobrança.
 *
 * O prazo fica em linguagem natural de propósito ("sexta", "até o dia 5"):
 * quem sabe que dia é sexta é o modelo conversacional, que tem a data de hoje
 * no prompt e converte na hora de criar. Converter aqui congelaria uma data
 * possivelmente errada num campo que ninguém revisa.
 */
export function parseTarefasDaAta(bloco: string): TarefaSugerida[] {
  const out: TarefaSugerida[] = [];
  for (const linha of bloco.split("\n")) {
    const limpa = linha.replace(/^\s*[-•*]\s*/, "").trim();
    if (!limpa || /^nenhuma\.?$/i.test(limpa)) continue;

    const partes = limpa.split("|").map((x) => x.trim());
    const titulo = partes[0]?.slice(0, 200);
    // Título curto demais não é tarefa — é sobra de formatação.
    if (!titulo || titulo.length < 4) continue;

    const vazio = (v: string | undefined) => !v || v === "?" || /^(nao|não|n\/a|indefinido)$/i.test(v);
    out.push({
      titulo,
      ...(vazio(partes[1]) ? {} : { quem: partes[1].slice(0, 60) }),
      ...(vazio(partes[2]) ? {} : { quando: partes[2].slice(0, 60) }),
    });
    if (out.length >= MAX_TAREFAS_SUGERIDAS) break;
  }
  return out;
}
