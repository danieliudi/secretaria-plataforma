import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { AppHeader } from "@/components/AppHeader";
import { duracaoTexto, type StatusReuniao } from "@/lib/reunioes";

// Lista das reuniões que a pessoa mandou. A leitura é com o service client
// DEPOIS de resolver a identidade pela sessão, e sempre filtrada por
// tenant_id — `reunioes` tem RLS sem policy nenhuma (só service role), mesmo
// padrão de despesas/resumos_diarios.
export const dynamic = "force-dynamic";

interface LinhaLista {
  id: string;
  titulo: string | null;
  status: StatusReuniao;
  duracao_seg: number | null;
  created_at: string;
  erro: string | null;
}

const ROTULO: Record<StatusReuniao, { texto: string; classe: string }> = {
  enviando: { texto: "enviando", classe: "bg-aurora-info/10 text-aurora-info" },
  pendente: { texto: "na fila", classe: "bg-aurora-info/10 text-aurora-info" },
  transcrevendo: { texto: "escutando", classe: "bg-aurora-warn/10 text-aurora-warn" },
  entregue: { texto: "pronta", classe: "bg-aurora-ok/10 text-aurora-ok" },
  erro: { texto: "falhou", classe: "bg-aurora-crit/10 text-aurora-crit" },
};

function primeiroNome(nomeCompleto: string): string {
  return nomeCompleto.trim().split(/\s+/)[0] ?? "";
}

function dataTexto(iso: string): string {
  return new Date(iso).toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "short",
    timeZone: "America/Sao_Paulo",
  });
}

export default async function ReunioesPage() {
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

  const { data } = await admin
    .from("reunioes")
    .select("id, titulo, status, duracao_seg, created_at, erro")
    .eq("tenant_id", tenant.id)
    .order("created_at", { ascending: false })
    .limit(100);

  const reunioes = (data ?? []) as LinhaLista[];

  return (
    <main className="aurora-bg min-h-screen">
      <AppHeader
        active="app"
        isPlatformOwner={Boolean(tenant.is_platform_owner)}
        pendentes={0}
        userLabel={primeiroNome(tenant.nome ?? "") || user.email || ""}
      />

      <section className="mx-auto w-full max-w-3xl px-5 py-8 sm:px-8">
        <div className="flex flex-col gap-2">
          <span className="text-[11px] font-bold uppercase tracking-[0.09em] text-aurora-accent-text">
            Reuniões
          </span>
          <h1 className="text-[26px] font-semibold leading-tight tracking-tight text-aurora-fg">
            O que eu escutei
          </h1>
          <p className="max-w-xl text-[14px] leading-relaxed text-aurora-muted">
            Grave a reunião no gravador do seu celular, toque em compartilhar e escolha a Mia. Eu
            transcrevo, separo quem falou o quê e te mando a ata no WhatsApp.
          </p>
        </div>

        {reunioes.length === 0 ? (
          <div className="mt-7 rounded-2xl border border-dashed border-aurora-line bg-aurora-surface px-6 py-8 text-center">
            <p className="text-[14px] font-semibold text-aurora-fg">Nenhuma reunião ainda</p>
            <p className="mx-auto mt-1.5 max-w-sm text-[13px] leading-relaxed text-aurora-muted">
              Se a Mia ainda não aparece no menu de compartilhar do seu celular, instale o app pela
              opção “Adicionar à tela inicial” do navegador.
            </p>
          </div>
        ) : (
          <ul className="mt-7 flex flex-col">
            {reunioes.map((r, i) => {
              const rotulo = ROTULO[r.status] ?? ROTULO.pendente;
              const pronta = r.status === "entregue";
              const conteudo = (
                <>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[14.5px] font-semibold text-aurora-fg">
                      {r.titulo || "Gravação"}
                    </span>
                    <span
                      className={`rounded-full px-2 py-0.5 font-mono text-[9.5px] font-bold uppercase tracking-wide ${rotulo.classe}`}
                    >
                      {rotulo.texto}
                    </span>
                    <span className="ml-auto font-mono text-[11px] text-aurora-muted">
                      {dataTexto(r.created_at)}
                    </span>
                  </div>
                  {/* O `erro` também aparece quando a reunião NÃO está em
                      estado de erro: é ali que fica o motivo de ela estar
                      parada (ex.: esperando a chave de transcrição). Sem isto,
                      uma fila travada mostrava "ainda estou trabalhando nessa"
                      pra sempre, sem nunca dizer o quê estava faltando. */}
                  <p className="mt-1 text-[12.5px] leading-relaxed text-aurora-muted">
                    {r.status === "erro"
                      ? (r.erro ?? "Não consegui processar essa gravação.")
                      : pronta
                        ? `Ata pronta${r.duracao_seg ? ` · ${duracaoTexto(r.duracao_seg)} de áudio` : ""}`
                        : (r.erro ?? "Ainda estou trabalhando nessa.")}
                  </p>
                </>
              );

              return (
                <li
                  key={r.id}
                  className="border-aurora-line-soft py-4"
                  style={{ borderTop: i === 0 ? "none" : "1px solid var(--aurora-line-soft)" }}
                >
                  {pronta ? (
                    <Link
                      href={`/app/reunioes/${r.id}`}
                      className="block rounded-lg transition hover:opacity-80"
                    >
                      {conteudo}
                    </Link>
                  ) : (
                    conteudo
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </main>
  );
}
