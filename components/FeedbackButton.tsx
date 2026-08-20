"use client";

// Entrada de feedback pelo site: link no AppHeader que abre um modal curto.
// A outra entrada é a conversa com a Mia (tool reportar_feedback) — as duas
// gravam na mesma tabela e o aviso pro dono sai pelo mesmo lugar (task
// `feedback_novo` do cron).

import { useEffect, useRef, useState } from "react";

const TEXTO_MAX = 2000;

type Tipo = "bug" | "sugestao";
type Estado = "escrevendo" | "enviando" | "enviado";

export function FeedbackButton() {
  const [aberto, setAberto] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setAberto(true)}
        className="flex items-center gap-1.5 rounded-full border border-aurora-line bg-aurora-surface px-3 py-1.5 text-[12.5px] font-semibold text-aurora-muted-2 transition hover:text-aurora-fg"
      >
        <BalaoIcon />
        Feedback
      </button>
      {aberto && <FeedbackModal onFechar={() => setAberto(false)} />}
    </>
  );
}

function FeedbackModal({ onFechar }: { onFechar: () => void }) {
  const [tipo, setTipo] = useState<Tipo>("bug");
  const [texto, setTexto] = useState("");
  const [estado, setEstado] = useState<Estado>("escrevendo");
  const [erro, setErro] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  // Onde o mousedown começou. Sem isso, selecionar texto dentro do modal e
  // soltar o botão fora fecha a caixa e joga fora o relato já escrito — o
  // clique conta como sendo no backdrop porque é lá que o mouseup terminou.
  const inicioDoClique = useRef<EventTarget | null>(null);
  // Enquanto envia, fechar não cancela nada (a requisição já saiu e a linha vai
  // ser gravada). Prometer cancelamento que não existe é pior que não oferecer.
  const enviando = estado === "enviando";

  useEffect(() => {
    // Devolve o foco pra onde ele estava (o botão "Feedback") quando fechar —
    // senão quem navega por teclado é jogado pro começo da página.
    const gatilho = document.activeElement as HTMLElement | null;
    textareaRef.current?.focus();

    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        if (enviando) return;
        onFechar();
        return;
      }
      if (e.key !== "Tab") return;

      // Prende o foco dentro da caixa: aria-modal sozinho não impede tabular
      // pro conteúdo atrás, que continua clicável e confunde leitor de tela.
      const foco = dialogRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), textarea, [href], input, select, [tabindex]:not([tabindex="-1"])',
      );
      if (!foco || foco.length === 0) return;
      const primeiro = foco[0];
      const ultimo = foco[foco.length - 1];
      if (e.shiftKey && document.activeElement === primeiro) {
        e.preventDefault();
        ultimo.focus();
      } else if (!e.shiftKey && document.activeElement === ultimo) {
        e.preventDefault();
        primeiro.focus();
      }
    }

    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      gatilho?.focus?.();
    };
  }, [onFechar, enviando]);

  async function enviar() {
    if (!texto.trim() || estado === "enviando") return;
    setEstado("enviando");
    setErro(null);
    try {
      const res = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tipo, texto }),
      });
      if (!res.ok) {
        // 401 = sessão expirou enquanto a pessoa escrevia. A mensagem da API
        // ("não autenticado") é diagnóstico, não frase pra ler na tela.
        if (res.status === 401) {
          setErro("Sua sessão expirou. Recarrega a página e tenta de novo?");
        } else {
          const body = await res.json().catch(() => ({}));
          setErro(typeof body.error === "string" ? body.error : "Não conseguimos enviar. Tenta de novo?");
        }
        setEstado("escrevendo");
        return;
      }
      setEstado("enviado");
    } catch {
      setErro("Não conseguimos enviar. Tenta de novo?");
      setEstado("escrevendo");
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-aurora-fg/25 px-6 backdrop-blur-[2px]"
      onMouseDown={(e) => { inicioDoClique.current = e.target; }}
      onClick={(e) => {
        // Só fecha quando o clique COMEÇOU e TERMINOU no fundo. Arrastar de
        // dentro pra fora (seleção de texto) não conta.
        if (enviando) return;
        if (e.target === e.currentTarget && inicioDoClique.current === e.currentTarget) onFechar();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Enviar feedback"
        className="w-full max-w-[420px] overflow-hidden rounded-[14px] border border-aurora-line bg-aurora-surface shadow-[0_20px_50px_rgba(15,23,42,0.12)]"
      >
        {estado === "enviado" ? (
          <div className="px-6 py-9 text-center">
            <span className="mx-auto mb-3.5 flex h-9 w-9 items-center justify-center rounded-full bg-aurora-ok/[0.12] text-aurora-ok">
              <CheckIcon />
            </span>
            <p className="mb-1.5 font-serif text-[19px] font-semibold text-aurora-fg">Chegou.</p>
            <p className="text-[13.5px] leading-relaxed text-aurora-muted">
              Obrigado — a gente lê tudo, mesmo sem responder um por um.
            </p>
            <button
              type="button"
              onClick={onFechar}
              className="mt-5 rounded-[9px] border border-aurora-line px-[18px] py-2.5 text-[13px] font-semibold text-aurora-muted-2 transition hover:text-aurora-fg"
            >
              Fechar
            </button>
          </div>
        ) : (
          <>
            <div className="px-[22px] pb-1 pt-5">
              <h2 className="mb-1 font-serif text-[21px] font-semibold text-aurora-fg">
                O que você quer nos contar?
              </h2>
              <p className="text-[13px] leading-snug text-aurora-muted">
                Bug, ideia, qualquer coisa. Lemos tudo.
              </p>
            </div>

            <div className="px-[22px] pb-[22px] pt-[18px]">
              <div className="mb-4 flex gap-1.5 rounded-[10px] bg-aurora-surface-2 p-1">
                {(
                  [
                    ["bug", "Encontrei um problema"],
                    ["sugestao", "Tenho uma sugestão"],
                  ] as Array<[Tipo, string]>
                ).map(([valor, label]) => (
                  <button
                    key={valor}
                    type="button"
                    onClick={() => setTipo(valor)}
                    className={`flex-1 rounded-lg px-2.5 py-[9px] text-[13px] font-semibold transition ${
                      tipo === valor
                        ? "aurora-glow bg-aurora-accent text-aurora-accent-ink"
                        : "text-aurora-muted hover:text-aurora-fg"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>

              <textarea
                ref={textareaRef}
                value={texto}
                maxLength={TEXTO_MAX}
                onChange={(e) => setTexto(e.target.value)}
                placeholder="Descreva o que aconteceu ou o que você gostaria que a Mia fizesse..."
                className="min-h-[104px] w-full resize-y rounded-[10px] border border-aurora-line bg-aurora-bg px-3.5 py-3 text-[13.5px] leading-relaxed text-aurora-fg outline-none placeholder:text-aurora-muted-2/70 focus:border-aurora-accent"
              />
              <div className="mt-1.5 text-right text-[11px] tabular-nums text-aurora-muted-2">
                {texto.length} / {TEXTO_MAX}
              </div>

              {erro && (
                <p className="mt-2 rounded-lg border border-aurora-crit/30 bg-aurora-crit/[0.08] px-3.5 py-2 text-[12.5px] text-aurora-crit">
                  {erro}
                </p>
              )}

              <div className="mt-4 flex justify-end gap-2.5">
                <button
                  type="button"
                  onClick={onFechar}
                  disabled={enviando}
                  className="rounded-[9px] border border-aurora-line px-[18px] py-2.5 text-[13px] font-semibold text-aurora-muted-2 transition hover:text-aurora-fg disabled:opacity-50"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={enviar}
                  disabled={!texto.trim() || enviando}
                  className="aurora-glow-btn rounded-[9px] bg-aurora-accent px-[18px] py-2.5 text-[13px] font-semibold text-aurora-accent-ink transition active:scale-[0.98] disabled:opacity-50"
                >
                  {estado === "enviando" ? "Enviando…" : "Enviar"}
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function BalaoIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 5.5h14v8H8l-3.5 3v-3H3z" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 10.5l4 4 8-9" />
    </svg>
  );
}
