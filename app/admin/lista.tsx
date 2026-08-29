"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { AppHeader } from "@/components/AppHeader";
import { COTACAO_USD_BRL, formataBrl, formataUsd } from "@/lib/precos-modelo";

/** Uso + custo de um tenant no mês. `sistema` é a linha da plataforma (sem dono). */
export interface UsoAdmin {
  slug: string;
  nome: string;
  dono: boolean;
  sistema: boolean;
  conversas: number;
  proativos: number;
  tokens: number;
  usd: number;
}

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

// `channel_preference` virou texto livre ("whatsapp,teams") desde que o
// passo 3 do wizard passou a ser múltipla escolha (18/08/2026) — o map
// abaixo só cobre os tokens individuais; o fallback (`?? c.canal`) mostra o
// valor cru quando vem mais de um junto. Tela só do dono da plataforma, não
// prioritário deixar bonito pra combinação.
const CANAL_LABEL: Record<string, string> = {
  whatsapp: "WhatsApp",
  telegram: "Telegram",
  teams: "Teams",
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

export default function AdminLista({
  cadastros,
  userLabel,
  mensagensNoMes,
  uso,
  custoPorModelo,
  modelosSemPreco,
}: {
  cadastros: CadastroAdmin[];
  userLabel: string;
  mensagensNoMes: number;
  uso: UsoAdmin[];
  custoPorModelo: Array<{ rotulo: string; usd: number }>;
  modelosSemPreco: string[];
}) {
  const router = useRouter();
  const [emCurso, setEmCurso] = useState<string | null>(null);
  const [emLote, setEmLote] = useState(false);
  const [selecionados, setSelecionados] = useState<Set<string>>(new Set());
  const [erro, setErro] = useState<string | null>(null);

  const aguardando = cadastros.filter((c) => !c.aprovadoEm && !c.recusadoEm);
  const rodando = cadastros.filter((c) => c.aprovadoEm);
  const recusados = cadastros.filter((c) => c.recusadoEm);

  const custoTotal = uso.reduce((s, u) => s + u.usd, 0);
  // Média SÓ entre quem é gente: a linha da plataforma (classificador) não é
  // usuário, e incluí-la puxaria a média pra baixo fingindo mais usuários.
  const pessoas = uso.filter((u) => !u.sistema);
  const mediaPorPessoa = pessoas.length > 0 ? custoTotal / pessoas.length : 0;

  const travado = emCurso !== null || emLote;

  function alternarSelecao(slug: string) {
    setSelecionados((atual) => {
      const novo = new Set(atual);
      if (novo.has(slug)) novo.delete(slug);
      else novo.add(slug);
      return novo;
    });
  }

  function alternarSelecaoTodos() {
    setSelecionados((atual) =>
      atual.size === aguardando.length ? new Set() : new Set(aguardando.map((c) => c.slug)),
    );
  }

  // Chama o MESMO endpoint de sempre, um slug por vez — o lote é só quem
  // dispara em sequência, não uma rota nova. Uma falha não trava as
  // seguintes: junta os erros e mostra no final, pra não perder o que já deu certo.
  async function chamarAprovacao(slug: string, acao: "aprovar" | "recusar" | "reverter"): Promise<string | null> {
    try {
      const res = await fetch("/api/admin/aprovacao", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug, acao }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return data.error ?? "Não foi possível salvar.";
      return null;
    } catch {
      return "Falha de conexão.";
    }
  }

  async function agir(slug: string, acao: "aprovar" | "recusar" | "reverter") {
    setEmCurso(slug);
    setErro(null);
    const erroChamada = await chamarAprovacao(slug, acao);
    if (erroChamada) {
      setErro(erroChamada);
      setEmCurso(null);
      return;
    }
    // Recarrega do servidor em vez de mexer no estado local: a lista é a
    // verdade do banco, e é ela que decide se a secretária responde.
    router.refresh();
    setEmCurso(null);
  }

  async function agirEmLote(acao: "aprovar" | "recusar") {
    const slugs = [...selecionados];
    if (slugs.length === 0) return;
    setEmLote(true);
    setErro(null);
    const falhas: string[] = [];
    for (const slug of slugs) {
      const erroChamada = await chamarAprovacao(slug, acao);
      if (erroChamada) falhas.push(`${slug}: ${erroChamada}`);
    }
    if (falhas.length > 0) {
      setErro(
        falhas.length === slugs.length
          ? "Não foi possível salvar nenhum dos selecionados."
          : `${slugs.length - falhas.length} de ${slugs.length} salvos — falharam: ${falhas.join("; ")}`,
      );
    }
    setSelecionados(new Set());
    setEmLote(false);
    router.refresh();
  }

  return (
    <main className="aurora-bg min-h-screen">
      <AppHeader active="admin" isPlatformOwner pendentes={aguardando.length} userLabel={userLabel} />

      <div className="mx-auto flex max-w-[1040px] flex-col gap-8 px-8 py-9">
        {erro && (
          <p className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-2 text-sm text-red-300">{erro}</p>
        )}

        <section className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          <div className="aurora-card flex flex-col gap-1 rounded-[14px] border border-aurora-line-soft bg-aurora-surface p-4">
            <span className="text-[11px] font-bold uppercase tracking-wide text-aurora-muted">Aguardando</span>
            <span className="text-[22px] font-extrabold tracking-tight text-aurora-fg">{aguardando.length}</span>
          </div>
          <div className="aurora-card flex flex-col gap-1 rounded-[14px] border border-aurora-line-soft bg-aurora-surface p-4">
            <span className="text-[11px] font-bold uppercase tracking-wide text-aurora-muted">Ativos</span>
            <span className="text-[22px] font-extrabold tracking-tight text-aurora-fg">{rodando.length}</span>
          </div>
          <div className="aurora-card flex flex-col gap-1 rounded-[14px] border border-aurora-line-soft bg-aurora-surface p-4">
            <span className="text-[11px] font-bold uppercase tracking-wide text-aurora-muted">Pausados</span>
            <span className="text-[22px] font-extrabold tracking-tight text-aurora-fg">{recusados.length}</span>
          </div>
          <div className="aurora-card flex flex-col gap-1 rounded-[14px] border border-aurora-line-soft bg-aurora-surface p-4">
            <span className="text-[11px] font-bold uppercase tracking-wide text-aurora-muted">Mensagens no mês</span>
            <span className="text-[22px] font-extrabold tracking-tight text-aurora-fg">{mensagensNoMes.toLocaleString("pt-BR")}</span>
          </div>
          <div className="aurora-card flex flex-col gap-1 rounded-[14px] border border-aurora-accent/50 bg-aurora-surface p-4">
            <span className="text-[11px] font-bold uppercase tracking-wide text-aurora-muted">Custo no mês</span>
            <span className="text-[22px] font-extrabold tracking-tight text-aurora-accent-text">
              {formataBrl(custoTotal)}
            </span>
            <span className="text-[11px] text-aurora-muted">
              {formataUsd(custoTotal)}
              {pessoas.length > 0 && ` · média ${formataBrl(mediaPorPessoa)}/usuário`}
            </span>
          </div>
        </section>

        {/* ── Custo por usuário ──────────────────────────────────────────
            Existe pra responder três perguntas de administração que a
            contagem de mensagens sozinha não responde: quanto custa CADA
            pessoa, quanto do gasto é proativo (roda sem ninguém pedir) e
            quanto custa uma conversa — que é o número pra projetar preço
            de assinatura. */}
        <section className="flex flex-col gap-2.5">
          <h2 className="text-[11px] font-bold uppercase tracking-[0.09em] text-aurora-muted-2">
            Custo por usuário <span className="text-aurora-accent-text">(mês corrente)</span>
          </h2>

          {modelosSemPreco.length > 0 && (
            <p className="rounded-lg border border-aurora-warn/40 bg-aurora-warn/10 px-4 py-2 text-[12.5px] text-aurora-warn">
              Sem preço cadastrado para {modelosSemPreco.join(", ")} — o custo abaixo está
              INCOMPLETO. Cadastre em <code className="font-mono">lib/precos-modelo.ts</code>.
            </p>
          )}

          {uso.length === 0 ? (
            <p className="rounded-xl border border-dashed border-aurora-line px-5 py-6 text-center text-[13px] text-aurora-muted-2">
              Nenhum uso registrado neste mês.
            </p>
          ) : (
            <div className="aurora-card overflow-hidden rounded-[14px] border border-aurora-line bg-aurora-surface">
              <div className="overflow-x-auto">
                <table className="w-full border-collapse">
                  <thead>
                    <tr className="border-b border-aurora-line-soft">
                      <th className="px-4 py-2.5 text-left text-[10.5px] font-bold uppercase tracking-wider text-aurora-muted">
                        Usuário
                      </th>
                      <th className="whitespace-nowrap px-4 py-2.5 text-right text-[10.5px] font-bold uppercase tracking-wider text-aurora-muted">
                        Conversas
                      </th>
                      <th className="whitespace-nowrap px-4 py-2.5 text-right text-[10.5px] font-bold uppercase tracking-wider text-aurora-muted">
                        Proativos
                      </th>
                      <th className="whitespace-nowrap px-4 py-2.5 text-right text-[10.5px] font-bold uppercase tracking-wider text-aurora-muted">
                        Tokens
                      </th>
                      <th className="whitespace-nowrap px-4 py-2.5 text-right text-[10.5px] font-bold uppercase tracking-wider text-aurora-muted">
                        Fatia
                      </th>
                      <th className="whitespace-nowrap px-4 py-2.5 text-right text-[10.5px] font-bold uppercase tracking-wider text-aurora-muted">
                        Custo
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {uso.map((u) => {
                      const fatia = custoTotal > 0 ? (u.usd / custoTotal) * 100 : 0;
                      const porConversa = u.conversas > 0 ? u.usd / u.conversas : null;
                      return (
                        <tr key={u.slug || u.nome} className="border-b border-aurora-line-soft last:border-none">
                          <td className="px-4 py-3">
                            <span className="flex items-center gap-2.5">
                              <span
                                className={`text-[13.5px] font-bold ${u.sistema ? "text-aurora-muted-2" : "text-aurora-fg"}`}
                              >
                                {u.nome}
                              </span>
                              <span
                                className={`rounded-full px-[8px] py-px text-[10px] font-bold uppercase tracking-wide ${
                                  u.sistema
                                    ? "bg-aurora-surface-2 text-aurora-muted"
                                    : u.dono
                                      ? "bg-aurora-accent/[0.14] text-aurora-accent-text"
                                      : "bg-aurora-surface-2 text-aurora-muted-2"
                                }`}
                              >
                                {u.sistema ? "sistema" : u.dono ? "dono" : "usuário"}
                              </span>
                            </span>
                            <span className="mt-0.5 block text-[11.5px] text-aurora-muted">
                              {u.sistema
                                ? "classificador — roda antes de saber de quem é a mensagem"
                                : [u.slug, porConversa !== null && `${formataBrl(porConversa)} por conversa`]
                                    .filter(Boolean)
                                    .join(" · ")}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-right text-[13px] tabular-nums text-aurora-muted-2">
                            {u.sistema ? "—" : u.conversas.toLocaleString("pt-BR")}
                          </td>
                          <td className="px-4 py-3 text-right text-[13px] tabular-nums text-aurora-muted-2">
                            {u.proativos.toLocaleString("pt-BR")}
                          </td>
                          <td className="px-4 py-3 text-right text-[13px] tabular-nums text-aurora-muted-2">
                            {u.tokens.toLocaleString("pt-BR")}
                          </td>
                          <td className="px-4 py-3">
                            <span className="flex items-center justify-end gap-2">
                              <span className="h-[5px] w-[68px] overflow-hidden rounded-[3px] bg-aurora-surface-2">
                                <span
                                  className={`block h-full ${u.sistema ? "bg-aurora-muted/40" : "bg-aurora-accent"}`}
                                  style={{ width: `${Math.max(fatia, 0.5)}%` }}
                                />
                              </span>
                              <span className="min-w-[36px] text-right text-[11.5px] tabular-nums text-aurora-muted">
                                {fatia.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%
                              </span>
                            </span>
                          </td>
                          <td className="px-4 py-3 text-right">
                            <span
                              className={`text-[14px] font-bold tabular-nums ${u.sistema ? "text-aurora-muted-2" : "text-aurora-fg"}`}
                            >
                              {formataBrl(u.usd)}
                            </span>
                            <span className="mt-0.5 block text-[11.5px] tabular-nums text-aurora-muted">
                              {formataUsd(u.usd)}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr className="bg-aurora-surface-2 text-[12.5px] font-bold tabular-nums text-aurora-muted-2">
                      <td className="px-4 py-3 text-left">Total do mês</td>
                      <td className="px-4 py-3 text-right">{mensagensNoMes.toLocaleString("pt-BR")}</td>
                      <td className="px-4 py-3 text-right">
                        {uso.reduce((s, u) => s + u.proativos, 0).toLocaleString("pt-BR")}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {uso.reduce((s, u) => s + u.tokens, 0).toLocaleString("pt-BR")}
                      </td>
                      <td />
                      <td className="px-4 py-3 text-right">
                        {formataBrl(custoTotal)}{" "}
                        <span className="font-medium text-aurora-muted">· {formataUsd(custoTotal)}</span>
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
              <div className="flex flex-wrap gap-x-3.5 gap-y-1 border-t border-aurora-line-soft px-4 py-2.5 text-[11.5px] text-aurora-muted">
                {custoPorModelo.map((m) => (
                  <span key={m.rotulo}>
                    {m.rotulo} · {formataUsd(m.usd)}
                  </span>
                ))}
                <span className="ml-auto">
                  Cotação usada: US$ 1 = {COTACAO_USD_BRL.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
                </span>
              </div>
            </div>
          )}
        </section>

        <section className="flex flex-col gap-2.5">
          <h2 className="flex items-baseline gap-2 text-[11px] font-bold uppercase tracking-[0.09em] text-aurora-muted-2">
            {aguardando.length > 0 && (
              <input
                type="checkbox"
                aria-label="Selecionar todos"
                checked={selecionados.size === aguardando.length}
                onChange={alternarSelecaoTodos}
                disabled={travado}
                className="h-[13px] w-[13px] accent-aurora-accent"
              />
            )}
            Aguardando aprovação{" "}
            <span className="text-aurora-accent-text">({aguardando.length})</span>
          </h2>

          {selecionados.size > 0 && (
            <div className="flex items-center gap-3 rounded-lg border border-aurora-accent/35 bg-aurora-accent/10 px-4 py-2.5 text-[12.5px] font-bold text-aurora-accent-text">
              {selecionados.size} selecionado{selecionados.size > 1 ? "s" : ""}
              <span className="ml-auto flex gap-2">
                <button
                  type="button"
                  onClick={() => agirEmLote("recusar")}
                  disabled={travado}
                  className="rounded-lg border border-aurora-line bg-aurora-surface px-[14px] py-1.5 text-aurora-fg transition hover:bg-aurora-surface-2 disabled:opacity-50"
                >
                  Recusar {selecionados.size}
                </button>
                <button
                  type="button"
                  onClick={() => agirEmLote("aprovar")}
                  disabled={travado}
                  className="aurora-glow rounded-lg bg-aurora-accent px-[14px] py-1.5 text-aurora-accent-ink transition hover:opacity-90 active:scale-[0.98] disabled:opacity-50"
                >
                  {emLote ? "Salvando…" : `Aprovar ${selecionados.size}`}
                </button>
              </span>
            </div>
          )}

          {aguardando.length === 0 ? (
            <p className="rounded-xl border border-dashed border-aurora-line px-5 py-6 text-center text-[13px] text-aurora-muted-2">
              Ninguém esperando agora.
            </p>
          ) : (
            aguardando.map((c) => (
              <div
                key={c.slug}
                className="flex flex-col gap-3.5 aurora-card rounded-[14px] border border-aurora-line bg-aurora-surface p-5 backdrop-blur sm:flex-row sm:items-start sm:justify-between"
              >
                <div className="flex min-w-0 gap-3">
                  <input
                    type="checkbox"
                    aria-label={`Selecionar ${c.nome || c.slug}`}
                    checked={selecionados.has(c.slug)}
                    onChange={() => alternarSelecao(c.slug)}
                    disabled={travado}
                    className="mt-1 h-[13px] w-[13px] flex-none accent-aurora-accent"
                  />
                  <div className="flex min-w-0 flex-col gap-0.5">
                    <span className="text-[15.5px] font-bold tracking-tight text-aurora-fg">
                      {c.nome || "(sem nome)"}
                    </span>
                    {c.email && <span className="font-mono text-[12px] text-aurora-muted">{c.email}</span>}
                    {(c.cargo || c.frentes) && (
                      <span className="mt-1 text-[12.5px] text-aurora-muted">
                        {[c.cargo, c.frentes].filter(Boolean).join(" · ")}
                      </span>
                    )}
                    <span className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12.5px] text-aurora-muted-2">
                      <span>cadastrou {dataHora(c.criadoEm)}</span>
                      <span>·</span>
                      <span className={c.googleConectado ? "font-semibold text-aurora-accent-text" : ""}>
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
                </div>
                <div className="flex flex-none gap-2">
                  <button
                    type="button"
                    onClick={() => agir(c.slug, "recusar")}
                    disabled={travado}
                    className="rounded-lg border border-aurora-line px-[17px] py-2 text-[12.5px] font-semibold text-aurora-fg transition hover:bg-aurora-surface-2 disabled:opacity-50"
                  >
                    Recusar
                  </button>
                  <button
                    type="button"
                    onClick={() => agir(c.slug, "aprovar")}
                    disabled={travado}
                    className="aurora-glow rounded-lg bg-aurora-accent px-[17px] py-2 text-[12.5px] font-bold text-aurora-accent-ink transition hover:opacity-90 active:scale-[0.98] disabled:opacity-50"
                  >
                    {emCurso === c.slug ? "Salvando…" : "Aprovar"}
                  </button>
                </div>
              </div>
            ))
          )}
        </section>

        <section className="flex flex-col gap-1">
          <h2 className="mb-1.5 text-[11px] font-bold uppercase tracking-[0.09em] text-aurora-muted-2">
            Rodando ({rodando.length})
          </h2>
          {rodando.map((c) => (
            <div
              key={c.slug}
              className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-aurora-line-soft py-3 text-[13px] last:border-none"
            >
              <span className="min-w-[160px] font-semibold text-aurora-fg">{c.nome || c.slug}</span>
              <span
                className={`rounded-full px-[9px] py-0.5 text-[10.5px] font-bold uppercase tracking-wide ${
                  c.dono ? "bg-aurora-accent/[0.14] text-aurora-accent-text" : "bg-aurora-surface-2 text-aurora-muted-2"
                }`}
              >
                {c.dono ? "dono" : "usuário"}
              </span>
              <span className="font-mono text-[12px] text-aurora-muted">
                {c.canalVinculado ? "canal vinculado" : "sem canal ainda"}
              </span>
              <span className="ml-auto flex items-center gap-3 text-[11.5px] text-aurora-muted-2">
                <span>desde {dataCurta(c.aprovadoEm!)}</span>
                {!c.dono && (
                  <button
                    type="button"
                    onClick={() => agir(c.slug, "recusar")}
                    disabled={travado}
                    className="text-aurora-accent-text underline underline-offset-2 hover:text-aurora-fg disabled:opacity-50"
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
            <h2 className="mb-1.5 text-[11px] font-bold uppercase tracking-[0.09em] text-aurora-muted-2">
              Pausados ({recusados.length})
            </h2>
            {recusados.map((c) => (
              <div
                key={c.slug}
                className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-aurora-line-soft py-3 text-[13px] last:border-none"
              >
                <span className="min-w-[160px] font-medium text-aurora-muted">{c.nome || c.slug}</span>
                {c.email && <span className="font-mono text-[12px] text-aurora-muted-2">{c.email}</span>}
                <span className="ml-auto flex items-center gap-3 text-[11.5px] text-aurora-muted-2">
                  <span>desde {dataCurta(c.recusadoEm!)}</span>
                  <button
                    type="button"
                    onClick={() => agir(c.slug, "aprovar")}
                    disabled={travado}
                    className="font-semibold text-aurora-accent-text underline underline-offset-2 hover:text-aurora-fg disabled:opacity-50"
                  >
                    liberar
                  </button>
                </span>
              </div>
            ))}
          </section>
        )}
      </div>
    </main>
  );
}
