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
  microsoft_todo: "Microsoft To Do",
  clickup: "ClickUp",
  notion: "Notion",
  trello: "Trello",
};

/** "a" / "a e b" / "a, b e c" — nunca vírgula antes do último item. */
function juntaComE(itens: string[]): string {
  if (itens.length <= 1) return itens.join("");
  return `${itens.slice(0, -1).join(", ")} e ${itens[itens.length - 1]}`;
}

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
      "id, nome, cargo, frentes, personalidade, task_provider, task_provider_token_secret_id, google_refresh_token_secret_id, outlook_refresh_token_secret_id, channel_preference, whatsapp_authorized_number, telegram_authorized_chat_id, teams_authorized_user_id, envio_oficial, aprovado_em, is_platform_owner, google_ads_ativo, google_ads_customer_map",
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
      : tenant.task_provider === "microsoft_todo"
      ? Boolean(tenant.outlook_refresh_token_secret_id)
      : Boolean(tenant.task_provider_token_secret_id);

  const whatsappVinculado = Boolean(tenant.whatsapp_authorized_number);
  const telegramVinculado = Boolean(tenant.telegram_authorized_chat_id);
  const teamsVinculado = Boolean(tenant.teams_authorized_user_id);
  const canaisVinculadosNomes = [
    whatsappVinculado && "WhatsApp",
    telegramVinculado && "Telegram",
    teamsVinculado && "Teams",
  ].filter((v): v is string => Boolean(v));
  const canalVinculado = canaisVinculadosNomes.length > 0;
  const canalNome = canaisVinculadosNomes.length > 0 ? juntaComE(canaisVinculadosNomes) : null;
  const canalPreferidoNome = canalPreferido(tenant.channel_preference);

  // Uso do mês — conta linhas de uso_modelo por `origem` (ver
  // _shared/uso.ts). Só contagem de chamada, nunca conteúdo — a tabela é
  // seguríssima de ler nesse sentido (ver comentário lá). "classificador" e
  // "consolidacao" ficam de fora do total: são chamada interna derivada de
  // uma mensagem já contada em "mensagens", não uma ação nova do usuário.
  const inicioDoMes = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1)).toISOString();
  const { data: usoRows } = await admin
    .from("uso_modelo")
    .select("origem")
    .eq("tenant_id", tenant.id)
    .gte("ts", inicioDoMes);

  const usoPorOrigem: Record<string, number> = {};
  for (const row of usoRows ?? []) {
    const origem = (row as { origem: string }).origem;
    usoPorOrigem[origem] = (usoPorOrigem[origem] ?? 0) + 1;
  }
  const usoMensagens = (usoPorOrigem.whatsapp ?? 0) + (usoPorOrigem.telegram ?? 0) + (usoPorOrigem.teams ?? 0);
  const usoImagens = usoPorOrigem.visao ?? 0;
  const usoDocumentos = usoPorOrigem.documento ?? 0;
  const usoAutomatico = usoPorOrigem.cron ?? 0;
  const usoMaximo = Math.max(usoMensagens, usoImagens, usoDocumentos, usoAutomatico, 1);

  // Reuniões: só a contagem — a lista mora em /app/reunioes. `head: true` não
  // traz linha nenhuma, e nenhuma ata (conteúdo sensível) passa por esta tela.
  const [{ count: reunioesProntas }, { count: reunioesEmAndamento }] = await Promise.all([
    admin
      .from("reunioes")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenant.id)
      .eq("status", "entregue"),
    admin
      .from("reunioes")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenant.id)
      .in("status", ["enviando", "pendente", "transcrevendo"]),
  ]);

  // Google Ads. Só aparece na tela pra quem LIGOU — a esmagadora maioria dos
  // usuários não roda anúncio, e mostrar "desligado" pra todo mundo seria
  // ruído sobre uma funcionalidade que não lhes diz respeito.
  const adsAtivo = Boolean(tenant.google_ads_ativo);
  const adsFrentes = Object.keys((tenant.google_ads_customer_map ?? {}) as Record<string, unknown>);

  const envioOficialDisponivel = Boolean(process.env.ENVIO_OFICIAL_DISPONIVEL);
  const envioAutomaticoAtivo = Boolean(tenant.envio_oficial) && envioOficialDisponivel;

  const personalidadeLabel =
    PRESETS.find((p) => p.id === normalizaPersonalidade(tenant.personalidade))?.label ?? "Cordial";

  const envioLabel = envioAutomaticoAtivo ? "Confirmação e lembrete automáticos" : "Confirmação e lembrete manuais";
  const envioDesc = envioAutomaticoAtivo
    ? "Sai do número oficial da plataforma."
    : "Ela escreve, você envia. Envio automático aguarda verificação na Meta.";
  const envioMeter: "on" | "pending" = envioAutomaticoAtivo || envioOficialDisponivel ? "on" : "pending";
  const envioStatusText = envioAutomaticoAtivo
    ? "Ativo"
    : envioOficialDisponivel
      ? "Manual, por escolha sua"
      : "Pendente";

  return (
    <main className="aurora-bg min-h-screen">
      <AppHeader
        active="app"
        isPlatformOwner={isPlatformOwner}
        pendentes={pendentes}
        userLabel={primeiroNome(tenant.nome ?? "") || user.email || ""}
      />

      <div className="mx-auto flex max-w-[1040px] flex-col px-8 py-9 sm:py-14">
        <h1 className="mb-10 text-[26px] font-extrabold tracking-tight text-aurora-fg">
          Bom te ver, {primeiroNome(tenant.nome ?? "") || "por aqui"}.
        </h1>

        {/* hero — única manchete da página */}
        <section className="relative mb-[68px] overflow-hidden aurora-card rounded-[22px] border border-aurora-line bg-aurora-surface px-8 py-9 backdrop-blur sm:px-[52px] sm:py-11">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 opacity-40"
            style={{
              backgroundImage:
                "repeating-linear-gradient(135deg, rgba(255,255,255,0.018) 0px, rgba(255,255,255,0.018) 1px, transparent 1px, transparent 13px)",
            }}
          />
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -right-24 -top-24 h-[280px] w-[280px] rounded-full opacity-50"
            style={{ background: "radial-gradient(circle, var(--aurora-glow) 0%, transparent 70%)" }}
          />

          <div className="relative mb-6 flex items-center gap-4">
            <span className="text-[11px] font-bold uppercase tracking-[0.16em] text-aurora-muted-2">
              Sua secretária
            </span>
            <span className="h-px flex-1 bg-aurora-line" />
          </div>

          <p className="relative font-serif text-[34px] font-semibold leading-[1.05] tracking-tight text-aurora-fg sm:text-[46px]">
            {canalVinculado ? (
              <>
                <em className="text-aurora-accent-text italic">Ativa</em> no {canalNome}.
              </>
            ) : (
              <>
                Ainda <em className="text-aurora-warn italic">não vinculada</em>.
              </>
            )}
          </p>

          <div className="relative mt-6 flex items-center gap-3.5">
            {canalVinculado ? (
              <>
                <SignalBars />
                <span className="text-[15px] tabular-nums text-aurora-muted">
                  {whatsappVinculado && canaisVinculadosNomes.length === 1
                    ? tenant.whatsapp_authorized_number
                    : canaisVinculadosNomes.join(" · ")}
                </span>
              </>
            ) : (
              <span className="text-[14px] text-aurora-muted">
                Termine o vínculo em{" "}
                <Link href="/onboarding?step=3" className="text-aurora-accent-text underline underline-offset-2 hover:text-aurora-fg">
                  Canal
                </Link>
                .
              </span>
            )}
          </div>
        </section>

        {/* reuniões — entrada pro recurso mais novo. Fica logo abaixo da
            manchete porque é a única coisa do produto que começa FORA do
            WhatsApp: se ninguém souber que existe, ninguém compartilha nada. */}
        <Link
          href="/app/reunioes"
          className="mb-[68px] flex items-center gap-4 rounded-[18px] border border-aurora-line bg-aurora-surface px-6 py-5 transition hover:bg-aurora-surface-2"
        >
          <span className="flex h-10 w-10 flex-none items-center justify-center rounded-xl bg-aurora-surface-2 text-aurora-accent-text">
            <MicrofoneIcon />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[15px] font-bold text-aurora-fg">Reuniões</span>
            <span className="block text-[13px] leading-relaxed text-aurora-muted">
              {reunioesEmAndamento
                ? `Estou escutando ${reunioesEmAndamento} gravação${reunioesEmAndamento > 1 ? "ões" : ""} agora.`
                : reunioesProntas
                  ? `${reunioesProntas} ata${reunioesProntas > 1 ? "s" : ""} pronta${reunioesProntas > 1 ? "s" : ""}.`
                  : "Compartilhe a gravação de uma reunião e eu devolvo a ata com quem falou o quê."}
            </span>
          </span>
          <span aria-hidden="true" className="flex-none text-[15px] text-aurora-muted">
            →
          </span>
        </Link>

        {/* Google Ads — faixa de estado, não link: não tem tela própria, o
            resultado sai no review semanal e nos avisos. Existe pra ninguém
            ficar esperando dado que nunca vem, que foi o erro que custou caro
            no lançamento das reuniões (30/08/2026). */}
        {adsAtivo && (
          <div className="mb-[68px] flex items-start gap-3 rounded-[14px] border border-aurora-line bg-aurora-surface px-5 py-4">
            <span
              aria-hidden="true"
              className={`mt-[5px] h-2 w-2 flex-none rounded-full ${
                adsFrentes.length > 0 ? "bg-aurora-ok" : "bg-aurora-warn"
              }`}
            />
            <span className="min-w-0 flex-1">
              <span className="block text-[13.5px] font-bold text-aurora-fg">Google Ads</span>
              <span className="block text-[12.5px] leading-relaxed text-aurora-muted">
                {adsFrentes.length > 0
                  ? `Acompanhando ${juntaComE(adsFrentes)}. O gasto entra no review semanal, e eu aviso se uma campanha atingir o orçamento do dia.`
                  : "Ligado, mas nenhuma frente tem conta de anúncio vinculada ainda — sem isso eu não consigo ler nada."}
              </span>
            </span>
          </div>
        )}

        {/* uso — o que puxou a Mia esse mês, sem valor em R$ (preço ainda não existe) */}
        <div className="mb-1.5 flex items-center gap-4">
          <span className="text-[11px] font-bold uppercase tracking-[0.16em] text-aurora-muted-2">Uso este mês</span>
          <span className="h-px flex-1 bg-aurora-line-soft" />
        </div>
        <div className="mb-[68px] grid grid-cols-2 gap-x-8 gap-y-6 sm:grid-cols-4">
          <UsoStat icon={<MensagensIcon />} label="Mensagens" valor={usoMensagens} max={usoMaximo} desc="WhatsApp, Telegram e Teams" />
          <UsoStat icon={<ImagensIcon />} label="Imagens" valor={usoImagens} max={usoMaximo} desc="Fotos e recibos analisados" />
          <UsoStat icon={<DocumentosIcon />} label="Documentos" valor={usoDocumentos} max={usoMaximo} desc="PDFs lidos" />
          <UsoStat icon={<AutomaticoIcon />} label="Automático" valor={usoAutomatico} max={usoMaximo} desc="Resumos e lembretes por conta própria" />
        </div>

        {/* configuração — lista de preferências, não cards */}
        <div className="mb-1.5 flex items-center gap-4">
          <span className="text-[11px] font-bold uppercase tracking-[0.16em] text-aurora-muted-2">Configuração</span>
          <span className="h-px flex-1 bg-aurora-line-soft" />
        </div>

        <div className="mt-2 border-t border-aurora-line-soft">
          <PrefRow
            icon={<VoceIcon />}
            title="Você"
            value={tenant.nome || "(sem nome)"}
            desc={tenant.cargo || undefined}
            meta={`Voz: ${personalidadeLabel}${(tenant.frentes ?? []).length > 0 ? ` · ${(tenant.frentes ?? []).join(", ")}` : ""}`}
            editHref="/onboarding?step=1"
          />
          <PrefRow
            icon={<FerramentasIcon />}
            title="Ferramentas"
            value={providerLabel}
            desc="Provedor de tarefas e lembretes da secretária."
            status={<StatusMeter state={ferramentaConectada ? "on" : "pending"} text={ferramentaConectada ? "Conectado" : "Pendente"} />}
            editHref="/onboarding?step=2"
          />
          <PrefRow
            icon={<CanalIcon />}
            title="Canal"
            value={canalNome ?? canalPreferidoNome ?? "—"}
            desc="Onde a Mia troca mensagem com você."
            status={<StatusMeter state={canalVinculado ? "on" : "pending"} text={canalVinculado ? "Vinculado" : "Pendente"} />}
            editHref="/onboarding?step=3"
          />
          <PrefRow
            icon={<EnvioIcon />}
            title="Envio oficial"
            value={envioLabel}
            desc={envioDesc}
            status={<StatusMeter state={envioMeter} text={envioStatusText} />}
            editHref="/onboarding?step=3"
          />
        </div>

        {canalVinculado && (
          <footer className="mt-16 border-t border-aurora-line-soft pt-7">
            <p className="max-w-[460px] font-serif text-[17px] italic leading-relaxed text-aurora-muted">
              Mia cuida disso. Qualquer coisa, é só chamar no {canalNome}.
            </p>
          </footer>
        )}
      </div>
    </main>
  );
}

const CHANNEL_LABEL: Record<string, string> = {
  whatsapp: "WhatsApp",
  telegram: "Telegram",
  teams: "Teams",
};

/**
 * `channel_preference` virou texto livre ("whatsapp,teams") desde que o
 * passo 3 do wizard passou a ser múltipla escolha — antes de qualquer canal
 * estar de fato vinculado, é a única pista de qual a pessoa pretende usar.
 */
function canalPreferido(channelPreference: string | null): string | null {
  const nomes = (channelPreference ?? "")
    .split(",")
    .map((c) => CHANNEL_LABEL[c.trim()])
    .filter((v): v is string => Boolean(v));
  return nomes.length > 0 ? juntaComE(nomes) : null;
}

function SignalBars() {
  const heights = [6, 14, 9, 12];
  return (
    <span className="flex flex-none items-end gap-[3px]" aria-hidden="true">
      {heights.map((h, i) => (
        <span key={i} className="w-[3px] rounded-sm bg-aurora-ok" style={{ height: h }} />
      ))}
    </span>
  );
}

function StatusMeter({ state, text }: { state: "on" | "pending"; text: string }) {
  return (
    <span className="flex items-center gap-2 whitespace-nowrap pt-0.5">
      <span
        className={
          state === "on"
            ? "h-1 w-3.5 flex-none rounded-sm bg-aurora-ok"
            : "h-1 w-3.5 flex-none rounded-sm border border-dashed border-aurora-warn"
        }
      />
      <span className="text-[12.5px] text-aurora-muted">{text}</span>
    </span>
  );
}

function ChevronRightIcon() {
  return (
    <svg width="7" height="11" viewBox="0 0 8 12" fill="none" aria-hidden="true" className="opacity-70 transition-transform group-hover:translate-x-0.5">
      <path d="M1 1l5 5-5 5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function PrefRow({
  icon,
  title,
  value,
  desc,
  meta,
  status,
  editHref,
}: {
  icon: React.ReactNode;
  title: string;
  value: string;
  desc?: string;
  meta?: string;
  status?: React.ReactNode;
  editHref: string;
}) {
  return (
    <div className="grid grid-cols-[20px_minmax(0,1fr)] items-start gap-x-[22px] gap-y-2.5 border-b border-aurora-line-soft py-[22px] last:border-none sm:grid-cols-[20px_minmax(0,1fr)_128px_58px] sm:gap-y-0">
      <span className="mt-[3px] flex-none text-aurora-muted-2">{icon}</span>
      <div className="min-w-0">
        <div className="mb-[7px] text-[11.5px] font-bold uppercase tracking-wide text-aurora-muted-2">{title}</div>
        <div className="text-[16px] font-semibold leading-snug text-aurora-fg">{value}</div>
        {desc && <div className="mt-[5px] text-[13.5px] leading-relaxed text-aurora-muted">{desc}</div>}
        {meta && <div className="mt-2.5 text-[12px] text-aurora-muted-2">{meta}</div>}
      </div>
      {status && <div className="col-start-2 sm:col-start-3 sm:pt-0.5">{status}</div>}
      <Link
        href={editHref}
        className="group col-start-2 flex items-center gap-1 text-[13px] font-medium text-aurora-muted-2 hover:text-aurora-accent-text sm:col-start-4 sm:pt-0.5"
      >
        editar
        <ChevronRightIcon />
      </Link>
    </div>
  );
}

function VoceIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
      <rect x="4" y="6" width="8" height="3" rx="1.5" />
      <rect x="4" y="12" width="12" height="2" rx="1" />
    </svg>
  );
}

function FerramentasIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true">
      <rect x="4.2" y="3.5" width="2.6" height="13" rx="1.3" fill="currentColor" stroke="none" />
      <rect x="13.2" y="3.5" width="2.6" height="13" rx="1.3" fill="currentColor" stroke="none" />
      <line x1="4.2" y1="10" x2="15.8" y2="10" />
    </svg>
  );
}

function CanalIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
      <line x1="3" y1="10" x2="12.5" y2="10" />
      <circle cx="16" cy="10" r="2.4" fill="currentColor" stroke="none" />
    </svg>
  );
}

function UsoStat({
  icon,
  label,
  valor,
  max,
  desc,
}: {
  icon: React.ReactNode;
  label: string;
  valor: number;
  max: number;
  desc: string;
}) {
  const pct = Math.max(4, Math.round((valor / max) * 100));
  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex items-center gap-2 text-aurora-muted-2">
        {icon}
        <span className="text-[11px] font-bold uppercase tracking-wide">{label}</span>
      </div>
      <span className="font-mono text-[22px] font-semibold tabular-nums leading-none text-aurora-fg">{valor}</span>
      <div className="h-1 w-full rounded-full bg-aurora-surface-2">
        <div className="h-1 rounded-full bg-aurora-accent" style={{ width: `${pct}%` }} />
      </div>
      <span className="text-[11.5px] leading-snug text-aurora-muted-2">{desc}</span>
    </div>
  );
}

function MensagensIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 5.5h14v8H8l-3.5 3v-3H3z" />
    </svg>
  );
}

function MicrofoneIcon() {
  return (
    <svg width="19" height="19" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="7.5" y="2" width="5" height="9.5" rx="2.5" />
      <path d="M4.5 9.5a5.5 5.5 0 0 0 11 0" />
      <path d="M10 15v3" />
    </svg>
  );
}

function ImagensIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="4" width="14" height="12" rx="1.5" />
      <circle cx="7.3" cy="8.3" r="1.3" fill="currentColor" stroke="none" />
      <path d="M4 14l4-4 3 3 2.5-2.5L17 14" strokeLinecap="round" />
    </svg>
  );
}

function DocumentosIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M6 2.5h6l3 3V17a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V3.5a1 1 0 0 1 1-1z" />
      <path d="M12 2.5V6h3" />
    </svg>
  );
}

function AutomaticoIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="10" cy="10.5" r="6.5" />
      <path d="M10 6.5V10.5L12.5 12.5" />
      <path d="M7 2.5h6" />
    </svg>
  );
}

function EnvioIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
      <rect x="3" y="6" width="14" height="3" rx="1.5" fill="currentColor" stroke="none" />
      <rect x="3" y="13" width="14" height="3" rx="1.5" fill="none" stroke="currentColor" strokeDasharray="2.6 2.6" />
    </svg>
  );
}
