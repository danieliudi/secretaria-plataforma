"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export interface CadastroAdmin {
  slug: string;
  nome: string;
  cargo: string;
  frentes: string;
  email: string;
  canal: string;
  dono: boolean;
  googleConectado: boolean;
  canalVinculado: boolean;
  aprovadoEm: string | null;
  recusadoEm: string | null;
  criadoEm: string;
}

const CANAL_LABEL: Record<string, string> = {
  whatsapp: "WhatsApp",
  telegram: "Telegram",
  both: "WhatsApp e Telegram",
};

function dataHora(iso: string): string {
  return new Date(iso).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function dataCurta(iso: string): string {
  return new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
}

export default function AdminLista({ cadastros }: { cadastros: CadastroAdmin[] }) {
  const router = useRouter();
  const [emCurso, setEmCurso] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  const aguardando = cadastros.filter((c) => !c.aprovadoEm && !c.recusadoEm);
  const rodando = cadastros.filter((c) => c.aprovadoEm);
  const recusados = cadastros.filter((c) => c.recusadoEm);

  async function agir(slug: string, acao: "aprovar" | "recusar" | "reverter") {
    setEmCurso(slug);
    setErro(null);
    try {
      const res = await fetch("/api/admin/aprovacao", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug, acao }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErro(data.error ?? "Não foi possível salvar.");
        return;
      }
      // Recarrega do servidor em vez de mexer no estado local: a lista é a
      // verdade do banco, e é ela que decide se a secretária responde.
      router.refresh();
    } catch {
      setErro("Falha de conexão — tenta de novo?");
    } finally {
      setEmCurso(null);
    }
  }

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-10 px-6 py-12">
      <header className="flex items-center justify-between gap-3 border-b border-line pb-5">
        <div className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-sm bg-cyan" />
          <span className="text-[13.5px] font-bold tracking-tight text-foreground">
            sinal <span className="font-medium text-muted-2">· admin</span>
          </span>
        </div>
        <a href="/onboarding" className="text-[12.5px] font-medium text-muted-2 underline underline-offset-2 hover:text-muted">
          Minha secretária
        </a>
      </header>

      {erro && (
        <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">{erro}</p>
      )}

      <section className="flex flex-col gap-3">
        <h2 className="text-[11px] font-bold uppercase tracking-[0.09em] text-muted-2">
          Aguardando aprovação{" "}
          <span className={aguardando.length > 0 ? "text-cyan" : "text-muted-2"}>({aguardando.length})</span>
        </h2>

        {aguardando.length === 0 ? (
          <p className="rounded-xl border border-dashed border-line px-5 py-6 text-center text-[13px] text-muted-2">
            Ninguém esperando agora.
          </p>
        ) : (
          aguardando.map((c) => (
            <div
              key={c.slug}
              className="flex flex-col gap-4 rounded-xl border border-line bg-surface p-5 sm:flex-row sm:items-start sm:justify-between"
            >
              <div className="flex min-w-0 flex-col gap-0.5">
                <span className="text-[15px] font-semibold tracking-tight text-foreground">
                  {c.nome || "(sem nome)"}
                </span>
                {c.email && <span className="font-mono text-[12px] text-muted">{c.email}</span>}
                {(c.cargo || c.frentes) && (
                  <span className="mt-1 text-[12.5px] text-muted">
                    {[c.cargo, c.frentes].filter(Boolean).join(" · ")}
                  </span>
                )}
                <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11.5px] text-muted-2">
                  <span>cadastrou {dataHora(c.criadoEm)}</span>
                  <span>·</span>
                  <span className={c.googleConectado ? "font-semibold text-cyan" : ""}>
                    Google {c.googleConectado ? "conectado" : "pendente"}
                  </span>
                  {c.canal && (
                    <>
                      <span>·</span>
                      <span>quer {CANAL_LABEL[c.canal] ?? c.canal}</span>
                    </>
                  )}
                </span>
              </div>
              <div className="flex flex-none gap-2">
                <button
                  type="button"
                  onClick={() => agir(c.slug, "recusar")}
                  disabled={emCurso !== null}
                  className="rounded-lg border border-line px-4 py-2 text-[12.5px] font-semibold text-muted transition hover:bg-surface-2 disabled:opacity-50"
                >
                  Recusar
                </button>
                <button
                  type="button"
                  onClick={() => agir(c.slug, "aprovar")}
                  disabled={emCurso !== null}
                  className="rounded-lg bg-cyan px-4 py-2 text-[12.5px] font-semibold text-white transition hover:opacity-90 active:scale-[0.98] disabled:opacity-50"
                >
                  {emCurso === c.slug ? "Salvando…" : "Aprovar"}
                </button>
              </div>
            </div>
          ))
        )}
      </section>

      <section className="flex flex-col gap-1">
        <h2 className="mb-2 text-[11px] font-bold uppercase tracking-[0.09em] text-muted-2">
          Rodando ({rodando.length})
        </h2>
        {rodando.map((c) => (
          <div
            key={c.slug}
            className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-line-soft py-3 text-[13px] last:border-none"
          >
            <span className="min-w-[150px] font-semibold text-foreground">{c.nome || c.slug}</span>
            <span
              className={`rounded-full px-2 py-0.5 text-[10.5px] font-bold uppercase tracking-wide ${
                c.dono ? "bg-cyan/10 text-cyan" : "bg-surface-2 text-muted-2"
              }`}
            >
              {c.dono ? "dono" : "usuário"}
            </span>
            <span className="font-mono text-[11px] text-muted">
              {c.canalVinculado ? "canal vinculado" : "sem canal ainda"}
            </span>
            <span className="ml-auto flex items-center gap-3 text-[11.5px] text-muted-2">
              <span>desde {dataCurta(c.aprovadoEm!)}</span>
              {!c.dono && (
                <button
                  type="button"
                  onClick={() => agir(c.slug, "recusar")}
                  disabled={emCurso !== null}
                  className="underline underline-offset-2 hover:text-muted disabled:opacity-50"
                >
                  pausar
                </button>
              )}
            </span>
          </div>
        ))}
      </section>

      {recusados.length > 0 && (
        <section className="flex flex-col gap-1">
          <h2 className="mb-2 text-[11px] font-bold uppercase tracking-[0.09em] text-muted-2">
            Pausados ({recusados.length})
          </h2>
          {recusados.map((c) => (
            <div
              key={c.slug}
              className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-line-soft py-3 text-[13px] last:border-none"
            >
              <span className="min-w-[150px] font-medium text-muted">{c.nome || c.slug}</span>
              {c.email && <span className="font-mono text-[11px] text-muted-2">{c.email}</span>}
              <span className="ml-auto flex items-center gap-3 text-[11.5px] text-muted-2">
                <span>desde {dataCurta(c.recusadoEm!)}</span>
                <button
                  type="button"
                  onClick={() => agir(c.slug, "aprovar")}
                  disabled={emCurso !== null}
                  className="font-semibold text-cyan underline underline-offset-2 disabled:opacity-50"
                >
                  liberar
                </button>
              </span>
            </div>
          ))}
        </section>
      )}
    </main>
  );
}
