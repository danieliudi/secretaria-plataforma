"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  MAX_NOME,
  MAX_QUANDO_USAR,
  MAX_TEXTO,
  motivoNaoPodeAtivar,
} from "@/lib/instrucoes";

// Três campos, e o do meio é o que decide tudo.
//
// `nome` e `quando_usar` entram no prompt de TODA conversa — por isso são
// curtos e têm contador visível. `texto` só é lido quando o gatilho bate, então
// pode ser longo sem custar nada no caso comum. A tela diz isso em voz alta,
// porque sem entender essa divisão a pessoa escreve o gatilho errado e conclui
// que a instrução não funciona.

/** Estimativa grosseira só pra dar noção de grandeza — ~4 chars por token. */
function tokensAprox(nome: string, quandoUsar: string): number {
  return Math.ceil((nome.length + quandoUsar.length + 12) / 4);
}

export function EditorInstrucao({
  id,
  nomeInicial,
  quandoUsarInicial,
  textoInicial,
  ativoInicial,
}: {
  id: string | null;
  nomeInicial: string;
  quandoUsarInicial: string;
  textoInicial: string;
  ativoInicial: boolean;
}) {
  const router = useRouter();
  const [nome, setNome] = useState(nomeInicial);
  const [quandoUsar, setQuandoUsar] = useState(quandoUsarInicial);
  const [texto, setTexto] = useState(textoInicial);
  const [ativo, setAtivo] = useState(ativoInicial);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [salvo, setSalvo] = useState(false);

  const impedimento = motivoNaoPodeAtivar({ quando_usar: quandoUsar, texto });

  async function chamar(metodo: "POST" | "PATCH" | "DELETE", corpo: unknown) {
    const res = await fetch("/api/instrucoes", {
      method: metodo,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(corpo),
    });
    const dados = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(dados.error ?? "não deu pra salvar");
    return dados as { id?: string; slug?: string };
  }

  async function salvar() {
    setErro(null);
    setSalvo(false);
    setSalvando(true);
    try {
      if (!id) {
        // Criação é sempre em dois passos: a rota POST nasce DESLIGADA por
        // regra, e ativar é um PATCH separado. Parece redundante aqui — o
        // usuário marcou a caixa, afinal — mas mantém a propriedade que
        // importa: não existe caminho nenhum no sistema que crie uma instrução
        // já ativa, nem quando quem chama é a Mia.
        const novo = await chamar("POST", { nome, quando_usar: quandoUsar, texto });
        if (ativo && !impedimento && novo.id) {
          await chamar("PATCH", { id: novo.id, ativo: true });
        }
        router.push(`/app/memoria/${novo.slug}`);
        router.refresh();
        return;
      }
      await chamar("PATCH", {
        id,
        nome,
        quando_usar: quandoUsar,
        texto,
        ativo: impedimento ? false : ativo,
      });
      setSalvo(true);
      router.refresh();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "não deu pra salvar");
    } finally {
      setSalvando(false);
    }
  }

  async function apagar() {
    if (!id) return;
    setErro(null);
    setSalvando(true);
    try {
      await chamar("DELETE", { id });
      router.push("/app/memoria");
      router.refresh();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "não deu pra apagar");
      setSalvando(false);
    }
  }

  const campo = "w-full rounded-xl border border-aurora-line bg-aurora-surface px-3.5 py-2.5 text-[14.5px] leading-relaxed text-aurora-fg outline-none transition focus:border-aurora-accent focus:ring-[3px] focus:ring-aurora-accent/20";

  return (
    <div className="mt-8">
      <div className="mb-5">
        <label htmlFor="nome" className="mb-1.5 flex items-baseline justify-between gap-3">
          <span className="text-[11px] font-bold uppercase tracking-[0.11em] text-aurora-muted-2">
            Nome
          </span>
          <span className="font-mono text-[11px] tabular-nums text-aurora-muted">
            {nome.length} / {MAX_NOME}
          </span>
        </label>
        <input
          id="nome"
          value={nome}
          maxLength={MAX_NOME}
          onChange={(e) => setNome(e.target.value)}
          placeholder="Como eu escrevo pra cliente industrial"
          className={campo}
        />
        <p className="mt-1.5 text-[12px] leading-relaxed text-aurora-muted">
          Ela vê este nome em <b className="font-semibold text-aurora-muted-2">toda</b> conversa.
          Escreva do jeito que você chamaria o assunto.
        </p>
      </div>

      <div className="mb-5">
        <label htmlFor="quando" className="mb-1.5 flex items-baseline justify-between gap-3">
          <span className="text-[11px] font-bold uppercase tracking-[0.11em] text-aurora-muted-2">
            Quando usar
          </span>
          <span className="font-mono text-[11px] tabular-nums text-aurora-muted">
            {quandoUsar.length} / {MAX_QUANDO_USAR}
          </span>
        </label>
        <input
          id="quando"
          value={quandoUsar}
          maxLength={MAX_QUANDO_USAR}
          onChange={(e) => setQuandoUsar(e.target.value)}
          placeholder="Quando eu pedir pra redigir e-mail, proposta ou cobrança pra comprador."
          className={campo}
        />
        <p className="mt-1.5 text-[12px] leading-relaxed text-aurora-muted">
          <b className="font-semibold text-aurora-muted-2">Este é o campo que decide tudo.</b> Ela lê
          essa linha sempre e abre o texto abaixo só quando reconhece a situação. Vago demais, abre à
          toa; estreito demais, nunca abre.
        </p>
      </div>

      <div className="mb-5">
        <label htmlFor="texto" className="mb-1.5 flex items-baseline justify-between gap-3">
          <span className="text-[11px] font-bold uppercase tracking-[0.11em] text-aurora-muted-2">
            O texto
          </span>
          <span className="font-mono text-[11px] tabular-nums text-aurora-muted">
            {texto.length.toLocaleString("pt-BR")} / {MAX_TEXTO.toLocaleString("pt-BR")}
          </span>
        </label>
        <textarea
          id="texto"
          value={texto}
          maxLength={MAX_TEXTO}
          rows={14}
          onChange={(e) => setTexto(e.target.value)}
          placeholder={"## Tom\nDireto, sem adjetivo de vendedor.\n\n## Nunca\n- Prometer prazo sem confirmar antes."}
          className={`${campo} resize-y font-mono text-[13px] leading-[1.7]`}
        />
        <p className="mt-1.5 text-[12px] leading-relaxed text-aurora-muted">
          Markdown simples. Ela lê como instrução sua, não como texto pra copiar de volta.
        </p>
      </div>

      <div className="flex items-center gap-2.5 rounded-xl border border-aurora-line-soft bg-aurora-surface px-3.5 py-3">
        <input
          id="ativo"
          type="checkbox"
          checked={ativo}
          disabled={Boolean(impedimento)}
          onChange={(e) => setAtivo(e.target.checked)}
          className="h-4 w-4 flex-none accent-[var(--aurora-accent)] disabled:opacity-40"
        />
        <label htmlFor="ativo" className="min-w-0 flex-1 text-[13px] leading-relaxed">
          <span className="font-semibold text-aurora-fg">Ativa</span>
          <span className="ml-1.5 text-aurora-muted">
            {impedimento ?? "entra no índice que ela lê em toda conversa."}
          </span>
        </label>
      </div>

      <div className="mt-3 flex items-center gap-2.5 text-[11.5px] text-aurora-muted">
        <span>Peso no prompt de toda conversa:</span>
        <span className="h-[5px] w-[120px] overflow-hidden rounded-sm bg-aurora-surface-2">
          <span
            className="block h-full rounded-sm bg-aurora-ok"
            style={{ width: `${Math.min(100, tokensAprox(nome, quandoUsar) / 0.6)}%` }}
          />
        </span>
        <span>
          <b className="font-bold text-aurora-ok">~{tokensAprox(nome, quandoUsar)} tokens</b> — só o
          nome e o “quando usar”. O texto não conta.
        </span>
      </div>

      {erro && (
        <p className="mt-4 rounded-lg border border-aurora-crit/30 bg-aurora-crit/5 px-3 py-2 text-[12.5px] text-aurora-crit">
          {erro}
        </p>
      )}
      {salvo && !erro && (
        <p className="mt-4 text-[12.5px] font-medium text-aurora-ok">Salvo.</p>
      )}

      <div className="mt-6 flex items-center gap-3 border-t border-aurora-line-soft pt-5">
        <button
          type="button"
          onClick={salvar}
          disabled={salvando || !nome.trim()}
          className="aurora-glow-btn rounded-full bg-aurora-accent px-6 py-2.5 text-[13.5px] font-bold text-aurora-accent-ink transition hover:opacity-90 disabled:opacity-40"
        >
          {salvando ? "salvando…" : "Salvar"}
        </button>
        {id && (
          <button
            type="button"
            onClick={apagar}
            disabled={salvando}
            className="ml-auto rounded-full border border-aurora-crit/30 px-5 py-2.5 text-[13px] font-semibold text-aurora-crit transition hover:bg-aurora-crit/5 disabled:opacity-40"
          >
            Apagar
          </button>
        )}
      </div>
    </div>
  );
}
