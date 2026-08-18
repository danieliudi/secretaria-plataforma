import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { carregaDonoDaPlataforma } from "@/lib/admin-guard";
import { semDadoPessoal } from "@/lib/log-seguro";
import { normalizaPersonalidade, PRESETS } from "@/lib/personalidade";
import { AppHeader } from "@/components/AppHeader";

// Server Component: home pós-login de quem já foi aprovado. Não recria nada
// que o /onboarding já sabe fazer — só lê o mesmo tenant e mostra o resumo.
export const dynamic = "force-dynamic";

const PROVIDER_LABEL: Record<string, string> = {
  google_tasks: "Google Tasks",
  clickup: "ClickUp",
  notion: "Notion",
  trello: "Trello",
};

function primeiroNome(nomeCompleto: string): string {
  return nomeCompleto.trim().split(/\s+/)[0] ?? "";
}

export default async function AppPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const admin = createServiceClient();
  const { data: tenant, error } = await admin
    .from("tenants")
    .select(
      "nome, cargo, frentes, personalidade, task_provider, task_provider_token_secret_id, google_refresh_token_secret_id, channel_preference, whatsapp_authorized_number, telegram_authorized_chat_id, envio_oficial, aprovado_em, is_platform_owner",
    )
    .eq("auth_user_id", user.id)
    .maybeSingle();

  if (error || !tenant) {
    console.error(
      `[app] tenant não carregado (auth_user_id=${user.id}):`,
      error ? `${error.code ?? "sem código"} — ${semDadoPessoal(error.message)}` : "nenhuma linha encontrada",
    );
    redirect("/onboarding");
  }

  // Home é só pra quem já foi aprovado — quem ainda não foi, ou foi pausado,
  // volta pro wizard, que já sabe mostrar o aviso certo pra cada caso.
  if (!tenant.aprovado_em) redirect("/onboarding");

  const isPlatformOwner = Boolean(tenant.is_platform_owner);
  let pendentes = 0;
  if (isPlatformOwner) {
    const dono = await carregaDonoDaPlataforma();
    if (dono) {
      const { count } = await admin
        .from("tenants")
        .select("slug", { count: "exact", head: true })
        .eq("active", true)
        .is("aprovado_em", null)
        .is("recusado_em", null);
      pendentes = count ?? 0;
    }
  }

  const providerLabel = PROVIDER_LABEL[tenant.task_provider ?? ""] ?? "—";
  const ferramentaConectada =
    tenant.task_provider === "google_tasks"
      ? Boolean(tenant.google_refresh_token_secret_id)
      : Boolean(tenant.task_provider_token_secret_id);

  const whatsappVinculado = Boolean(tenant.whatsapp_authorized_number);
  const telegramVinculado = Boolean(tenant.telegram_authorized_chat_id);
  const canalVinculado = whatsappVinculado || telegramVinculado;
  const canalNome = whatsappVinculado ? "WhatsApp" : telegramVinculado ? "Telegram" : null;

  const envioOficialDisponivel = Boolean(process.env.ENVIO_OFICIAL_DISPONIVEL);
  const envioAutomaticoAtivo = Boolean(tenant.envio_oficial) && envioOficialDisponivel;

  const personalidadeLabel =
    PRESETS.find((p) => p.id === normalizaPersonalidade(tenant.personalidade))?.label ?? "Cordial";

  return (
    <main className="aurora-bg min-h-screen">
      <AppHeader
        active="app"
        isPlatformOwner={isPlatformOwner}
        pendentes={pendentes}
        userLabel={primeiroNome(tenant.nome ?? "") || user.email || ""}
      />

      <div className="mx-auto flex max-w-[1040px] flex-col gap-6 px-8 py-9">
        <h1 className="text-[26px] font-extrabold tracking-tight text-aurora-fg">
          Bom te ver, {primeiroNome(tenant.nome ?? "") || "por aqui"}.
        </h1>

        <div className="flex flex-col gap-1 rounded-2xl border border-aurora-line bg-aurora-surface p-6 backdrop-blur">
          <span className="text-[11px] font-bold uppercase tracking-[0.07em] text-aurora-muted-2">
            Sua secretária
          </span>
          {canalVinculado ? (
            <>
              <span className="text-[21px] font-bold text-aurora-fg">Ativa no {canalNome}</span>
              <span className="text-[13px] text-aurora-muted">
                {whatsappVinculado
                  ? tenant.whatsapp_authorized_number
                  : "Sua conta do Telegram está vinculada."}
              </span>
            </>
          ) : (
            <>
              <span className="text-[21px] font-bold text-aurora-fg">Ainda não vinculada</span>
              <span className="text-[13px] text-aurora-muted">
                Termine o vínculo em{" "}
                <Link href="/onboarding?step=3" className="text-aurora-accent-text underline underline-offset-2 hover:text-aurora-fg">
                  Canal
                </Link>
                .
              </span>
            </>
          )}
        </div>

        <span className="mt-1 text-[11px] font-bold uppercase tracking-[0.09em] text-aurora-muted-2">
          Configuração
        </span>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-2 rounded-[14px] border border-aurora-line bg-aurora-surface p-5 backdrop-blur">
            <div className="flex items-center justify-between gap-2.5">
              <h4 className="text-[14.5px] font-bold text-aurora-fg">Você</h4>
              <Link href="/onboarding?step=1" className="text-[12px] font-semibold text-aurora-accent-text hover:text-aurora-fg">
                editar
              </Link>
            </div>
            <span className="text-[13px] leading-relaxed text-aurora-muted">
              <b className="font-semibold text-aurora-fg">{tenant.nome || "(sem nome)"}</b>
              {tenant.cargo ? ` · ${tenant.cargo}` : ""}
            </span>
            <span className="text-[13px] leading-relaxed text-aurora-muted">
              Voz: <b className="font-semibold text-aurora-fg">{personalidadeLabel}</b>
              {(tenant.frentes ?? []).length > 0 ? ` · ${(tenant.frentes ?? []).join(", ")}` : ""}
            </span>
          </div>

          <div className="flex flex-col gap-2 rounded-[14px] border border-aurora-line bg-aurora-surface p-5 backdrop-blur">
            <div className="flex items-center justify-between gap-2.5">
              <h4 className="text-[14.5px] font-bold text-aurora-fg">Ferramentas</h4>
              <Link href="/onboarding?step=2" className="text-[12px] font-semibold text-aurora-accent-text hover:text-aurora-fg">
                editar
              </Link>
            </div>
            <span className="text-[13px] leading-relaxed text-aurora-muted">
              Tarefas em <b className="font-semibold text-aurora-fg">{providerLabel}</b>
            </span>
            <StatusLine ok={ferramentaConectada} okText="Conectado" warnText="Ainda não conectado" />
          </div>

          <div className="flex flex-col gap-2 rounded-[14px] border border-aurora-line bg-aurora-surface p-5 backdrop-blur">
            <div className="flex items-center justify-between gap-2.5">
              <h4 className="text-[14.5px] font-bold text-aurora-fg">Canal</h4>
              <Link href="/onboarding?step=3" className="text-[12px] font-semibold text-aurora-accent-text hover:text-aurora-fg">
                editar
              </Link>
            </div>
            <span className="text-[13px] leading-relaxed text-aurora-muted">
              Conversa por{" "}
              <b className="font-semibold text-aurora-fg">{canalNome ?? CHANNEL_LABEL[tenant.channel_preference ?? ""] ?? "—"}</b>
            </span>
            <StatusLine ok={canalVinculado} okText="Vinculado" warnText="Ainda não vinculado" />
          </div>

          <div className="flex flex-col gap-2 rounded-[14px] border border-aurora-line bg-aurora-surface p-5 backdrop-blur">
            <div className="flex items-center justify-between gap-2.5">
              <h4 className="text-[14.5px] font-bold text-aurora-fg">Envio oficial</h4>
              <Link href="/onboarding?step=3" className="text-[12px] font-semibold text-aurora-accent-text hover:text-aurora-fg">
                editar
              </Link>
            </div>
            <span className="text-[13px] leading-relaxed text-aurora-muted">
              Confirmação e lembrete{" "}
              <b className="font-semibold text-aurora-fg">{envioAutomaticoAtivo ? "automáticos" : "manuais"}</b>
              {envioAutomaticoAtivo ? " (sai do número oficial)" : " (ela escreve, você envia)"}
            </span>
            {envioAutomaticoAtivo ? (
              <StatusLine ok okText="Envio oficial ativo" warnText="" />
            ) : !envioOficialDisponivel ? (
              <span className="flex items-center gap-1.5 text-[11.5px] font-bold text-aurora-warn">
                <span className="h-1.5 w-1.5 flex-none rounded-full bg-aurora-warn" />
                Envio automático aguarda verificação na Meta
              </span>
            ) : (
              <StatusLine ok okText="Manual, por escolha sua" warnText="" />
            )}
          </div>
        </div>
      </div>
    </main>
  );
}

const CHANNEL_LABEL: Record<string, string> = {
  whatsapp: "WhatsApp",
  telegram: "Telegram",
  both: "WhatsApp e Telegram",
};

function StatusLine({ ok, okText, warnText }: { ok: boolean; okText: string; warnText: string }) {
  return (
    <span
      className={`flex items-center gap-1.5 text-[11.5px] font-bold ${ok ? "text-aurora-ok" : "text-aurora-warn"}`}
    >
      <span className={`h-1.5 w-1.5 flex-none rounded-full ${ok ? "bg-aurora-ok" : "bg-aurora-warn"}`} />
      {ok ? okText : warnText}
    </span>
  );
}
