import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { AppHeader } from "@/components/AppHeader";
import { duracaoTexto, formataTempo } from "@/lib/reunioes";

// A ata de uma reunião: o que ficou decidido e quem falou o quê.
//
// CONTEÚDO SENSÍVEL. Isto guarda fala de terceiros que não necessariamente
// sabiam que estavam sendo gravados. A leitura é sempre com filtro duplo
// (id + tenant_id da SESSÃO) — nunca só pelo id da URL, que é adivinhável por
// quem já viu um.
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RETENCAO_DIAS = 7;

interface Turno {
  falante: string;
  texto: string;
  inicio_ms: number;
  fim_ms: number;
}

interface TurnosSalvos {
  falantes?: Record<string, string>;
  turnos?: Turno[];
}

function primeiroNome(nomeCompleto: string): string {
  return nomeCompleto.trim().split(/\s+/)[0] ?? "";
}

function dataLonga(iso: string): string {
  return new Date(iso).toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "long",
    year: "numeric",
    timeZone: "America/Sao_Paulo",
  });
}

/** Uma cor estável por falante, dentro da paleta — não é decoração: é o que
 *  deixa varrer a coluna e ver quem dominou a conversa. */
const CORES = [
  "text-aurora-accent-text",
  "text-aurora-info",
  "text-aurora-ok",
  "text-aurora-warn",
  "text-aurora-muted-2",
];

export default async function ReuniaoPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const admin = createServiceClient();
  const { data: tenant } = await admin
    .from("tenants")
    .select("id, nome, aprovado_em, is_platform_owner")
    .eq("auth_user_id", user.id)
    .maybeSingle();
  if (!tenant || !tenant.aprovado_em) redirect("/onboarding");

  const { data: reuniao } = await admin
    .from("reunioes")
    .select("id, titulo, status, ata, turnos, duracao_seg, custo_usd, created_at, audio_path, audio_apagado_em")
    .eq("id", id)
    .eq("tenant_id", tenant.id)
    .maybeSingle();

  // 404 (e não 403) pra quem pediu id de outra conta: não confirma que existe.
  if (!reuniao || reuniao.status !== "entregue") notFound();

  const salvos = (reuniao.turnos ?? {}) as TurnosSalvos;
  const turnos = salvos.turnos ?? [];
  const nomes = salvos.falantes ?? {};

  const ordemFalantes = [...new Set(turnos.map((t) => t.falante))];
  const corDoFalante = (f: string) => CORES[Math.max(0, ordemFalantes.indexOf(f)) % CORES.length];
  const rotuloFalante = (f: string) => nomes[f] ?? `Falante ${f}`;

  const linhasAta = String(reuniao.ata ?? "")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  const apagaEm = new Date(new Date(reuniao.created_at).getTime() + RETENCAO_DIAS * 86400_000);
  const audioAindaExiste = Boolean(reuniao.audio_path);

  return (
    <main className="aurora-bg min-h-screen">
      <AppHeader
        active="app"
        isPlatformOwner={Boolean(tenant.is_platform_owner)}
        pendentes={0}
        userLabel={primeiroNome(tenant.nome ?? "") || user.email || ""}
      />

      <section className="mx-auto w-full max-w-3xl px-5 py-8 sm:px-8">
        <Link
          href="/app/reunioes"
          className="text-[12.5px] font-semibold text-aurora-muted transition hover:text-aurora-fg"
        >
          ← Reuniões
        </Link>

        <div className="mt-4 flex flex-col gap-2">
          <h1 className="text-[26px] font-semibold leading-tight tracking-tight text-aurora-fg">
            {reuniao.titulo || "Gravação"}
          </h1>
          <p className="font-mono text-[12px] text-aurora-muted">
            {dataLonga(reuniao.created_at)}
            {reuniao.duracao_seg ? ` · ${duracaoTexto(reuniao.duracao_seg)}` : ""}
            {ordemFalantes.length
              ? ` · ${ordemFalantes.length} ${ordemFalantes.length === 1 ? "voz" : "vozes"}`
              : ""}
          </p>
        </div>

        {linhasAta.length > 0 && (
          <div className="mt-7 rounded-2xl border border-aurora-line bg-aurora-surface p-6 shadow-[var(--aurora-shadow)]">
            <h2 className="text-[11px] font-bold uppercase tracking-[0.09em] text-aurora-accent-text">
              O que ficou decidido
            </h2>
            <div className="mt-3 flex flex-col gap-1.5">
              {linhasAta.map((linha, i) =>
                linha.startsWith("-") ? (
                  <p key={i} className="flex gap-2.5 text-[13.8px] leading-relaxed text-aurora-muted-2">
                    <span aria-hidden="true" className="mt-[7px] h-1 w-1 flex-none rounded-full bg-aurora-accent" />
                    <span>{linha.replace(/^-\s*/, "")}</span>
                  </p>
                ) : (
                  <p key={i} className="mt-2 text-[12px] font-bold uppercase tracking-wide text-aurora-muted">
                    {linha}
                  </p>
                ),
              )}
            </div>
          </div>
        )}

        {turnos.length > 0 && (
          <div className="mt-6">
            <h2 className="text-[11px] font-bold uppercase tracking-[0.09em] text-aurora-accent-text">
              Quem falou o quê
            </h2>

            {ordemFalantes.some((f) => !nomes[f]) && (
              <p className="mt-2.5 rounded-xl border border-aurora-line-soft bg-aurora-surface-2 px-3.5 py-2.5 text-[12.5px] leading-relaxed text-aurora-muted">
                Só consigo dar nome a quem foi chamado pelo nome durante a conversa. Os outros ficam
                como “Falante”, porque chutar seria pior.
              </p>
            )}

            <div className="mt-3 flex flex-col">
              {turnos.map((t, i) => (
                <div
                  key={i}
                  className="grid grid-cols-1 gap-1 py-3 sm:grid-cols-[132px_1fr] sm:gap-4"
                  style={{ borderTop: i === 0 ? "none" : "1px solid var(--aurora-line-soft)" }}
                >
                  <div className="flex items-baseline gap-2 sm:flex-col sm:gap-0.5">
                    <span className={`text-[12.5px] font-bold ${corDoFalante(t.falante)}`}>
                      {rotuloFalante(t.falante)}
                    </span>
                    <span className="font-mono text-[10.5px] text-aurora-muted">
                      {formataTempo(t.inicio_ms)}
                    </span>
                  </div>
                  <p className="text-[13.5px] leading-relaxed text-aurora-muted-2">{t.texto}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="mt-8 flex flex-wrap gap-x-5 gap-y-1.5 border-t border-aurora-line-soft pt-4 text-[11.5px] text-aurora-muted">
          <span>
            {audioAindaExiste
              ? `Áudio original apagado em ${apagaEm.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", timeZone: "America/Sao_Paulo" })} (${RETENCAO_DIAS} dias)`
              : "Áudio original já apagado — esta ata fica."}
          </span>
          {reuniao.custo_usd != null && (
            <span className="font-mono">
              Custo desta reunião: US$ {Number(reuniao.custo_usd).toFixed(2)}
            </span>
          )}
        </div>
      </section>
    </main>
  );
}
