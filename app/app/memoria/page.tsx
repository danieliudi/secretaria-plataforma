import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { AppHeader } from "@/components/AppHeader";
import { type Instrucao, MAX_INSTRUCOES, usoTexto } from "@/lib/instrucoes";
import { FatosDoPerfil } from "./FatosDoPerfil";

// Tela da memória. Duas listas, com donos diferentes:
//
//   1. INSTRUÇÕES — o que a pessoa escreveu. Nome e gatilho entram no prompt de
//      toda conversa; o texto só é lido quando o gatilho bate (abrir_instrucao).
//   2. FATOS — o que a Mia juntou sozinha (`user_profile`). Continuam exatamente
//      como sempre foram: gravados em silêncio, sempre no prompt, consolidados
//      toda semana. Aqui eles só ficam VISÍVEIS pela primeira vez, com dois
//      caminhos de saída: apagar, ou virar instrução.
//
// As duas convivem de propósito (decisão do Daniel, 31/08/2026 — opção A do
// mockup): a camada nova é aditiva, nada do que funciona hoje corre risco, e só
// o uso real vai dizer se um dia o perfil automático vira redundante.
export const dynamic = "force-dynamic";

interface FatoPerfil {
  category: string;
  key: string;
  value: string;
}

const ROTULO_CATEGORIA: Record<string, { texto: string; classe: string }> = {
  preferencia: { texto: "preferência", classe: "bg-aurora-info/10 text-aurora-info" },
  pessoa: { texto: "pessoa", classe: "bg-aurora-ok/10 text-aurora-ok" },
  rotina: { texto: "rotina", classe: "bg-aurora-fg/[0.07] text-aurora-muted" },
  projeto: { texto: "projeto", classe: "bg-aurora-warn/10 text-aurora-warn" },
  outro: { texto: "outro", classe: "bg-aurora-fg/[0.07] text-aurora-muted" },
};

function primeiroNome(nomeCompleto: string): string {
  return nomeCompleto.trim().split(/\s+/)[0] ?? "";
}

function dataTexto(iso: string): string {
  return new Date(iso).toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    timeZone: "America/Sao_Paulo",
  });
}

export default async function MemoriaPage() {
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

  const [instRes, fatosRes] = await Promise.all([
    admin
      .from("instrucoes")
      .select("id, slug, nome, quando_usar, texto, ativo, origem, usos, ultimo_uso, atualizado_em")
      .eq("tenant_id", tenant.id)
      .order("ativo", { ascending: false })
      .order("nome", { ascending: true }),
    admin
      .from("user_profile")
      .select("category, key, value")
      .eq("tenant_id", tenant.id)
      .order("updated_at", { ascending: false })
      .limit(60),
  ]);

  const instrucoes = (instRes.data ?? []) as Instrucao[];
  const fatos = (fatosRes.data ?? []) as FatoPerfil[];
  const ativas = instrucoes.filter((i) => i.ativo).length;
  const rascunhos = instrucoes.length - ativas;

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
            Memória
          </span>
          <h1 className="text-[26px] font-semibold leading-tight tracking-tight text-aurora-fg">
            O que a Mia sabe
          </h1>
          <p className="max-w-xl text-[14px] leading-relaxed text-aurora-muted">
            As instruções são suas — ela lê o nome e o “quando usar” em toda conversa, e abre o texto
            inteiro só quando a situação pede. Os fatos embaixo ela juntou sozinha, ouvindo você.
          </p>
        </div>

        {/* ── Instruções ────────────────────────────────────────────── */}
        <div className="mt-9 flex items-baseline justify-between gap-4 border-b border-aurora-line pb-3">
          <span className="text-[11px] font-bold uppercase tracking-[0.16em] text-aurora-muted-2">
            Instruções que você escreveu
          </span>
          <span className="font-mono text-[11.5px] tabular-nums text-aurora-muted">
            {instrucoes.length === 0
              ? `0 de ${MAX_INSTRUCOES}`
              : `${ativas} ativa${ativas === 1 ? "" : "s"}${rascunhos > 0 ? ` · ${rascunhos} desligada${rascunhos === 1 ? "" : "s"}` : ""}`}
          </span>
        </div>

        {instrucoes.length === 0 ? (
          <div className="mt-5 rounded-2xl border border-dashed border-aurora-line bg-aurora-surface px-6 py-8 text-center">
            <p className="text-[14px] font-semibold text-aurora-fg">Nenhuma instrução ainda</p>
            <p className="mx-auto mt-1.5 max-w-md text-[13px] leading-relaxed text-aurora-muted">
              Uma instrução é um jeito seu de fazer as coisas, escrito por extenso — “como eu escrevo
              pra cliente”, “o que faz um lead valer a pena”. A Mia lê quando a situação bate.
            </p>
          </div>
        ) : (
          <ul className="mt-1 flex flex-col">
            {instrucoes.map((i) => (
              <li key={i.id} className="border-b border-aurora-line-soft last:border-none">
                <Link
                  href={`/app/memoria/${i.slug}`}
                  className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-4 gap-y-2 py-[18px] transition hover:opacity-80"
                >
                  <div className="min-w-0">
                    <span className="block text-[15px] font-semibold leading-snug text-aurora-fg">
                      {i.nome}
                    </span>
                    <span className="mt-1 block text-[13px] leading-relaxed text-aurora-muted">
                      {i.quando_usar || "— falta o “quando usar”, sem isso ela não sabe quando abrir."}
                    </span>
                    <span className="mt-2 block font-mono text-[11px] text-aurora-muted-2">
                      {i.texto.length.toLocaleString("pt-BR")} caracteres · {usoTexto(i.usos, i.ultimo_uso)} ·
                      editada em {dataTexto(i.atualizado_em)}
                      {i.origem === "proposta" && " · escrita pela Mia"}
                    </span>
                  </div>
                  <span
                    className={`rounded-full px-2.5 py-0.5 font-mono text-[9.5px] font-bold uppercase tracking-wide ${
                      i.ativo
                        ? "bg-aurora-ok/10 text-aurora-ok"
                        : "bg-aurora-fg/[0.06] text-aurora-muted"
                    }`}
                  >
                    {i.ativo ? "ativa" : "desligada"}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}

        {instrucoes.length < MAX_INSTRUCOES && (
          <Link
            href="/app/memoria/nova"
            className="aurora-glow-btn mt-6 inline-flex items-center gap-2 rounded-full bg-aurora-accent px-5 py-2.5 text-[13.5px] font-bold text-aurora-accent-ink transition hover:opacity-90"
          >
            Escrever uma instrução
          </Link>
        )}

        {/* ── Fatos automáticos ─────────────────────────────────────── */}
        <div className="mt-12 flex items-baseline justify-between gap-4 border-b border-aurora-line pb-3">
          <span className="text-[11px] font-bold uppercase tracking-[0.16em] text-aurora-muted-2">
            Fatos que ela juntou sozinha
          </span>
          <span className="font-mono text-[11.5px] tabular-nums text-aurora-muted">
            {fatos.length} de 60
          </span>
        </div>

        {fatos.length === 0 ? (
          <p className="mt-5 text-[13px] leading-relaxed text-aurora-muted">
            Nada ainda. Ela guarda em silêncio o que se repete — preferências, pessoas, rotinas — e o
            que aparecer vai listado aqui.
          </p>
        ) : (
          <FatosDoPerfil
            fatos={fatos.map((f) => ({
              ...f,
              rotulo: ROTULO_CATEGORIA[f.category] ?? ROTULO_CATEGORIA.outro,
            }))}
          />
        )}

        <p className="mt-6 max-w-xl text-[12.5px] leading-relaxed text-aurora-muted">
          Fatos não se editam aqui de propósito: corrigir uma linha solta é consertar a memória
          errada. Se um fato merece virar regra, use “virar instrução” — o editor abre com o texto
          dentro, e aí você escreve o que ela deve fazer com aquilo.
        </p>
      </section>
    </main>
  );
}
