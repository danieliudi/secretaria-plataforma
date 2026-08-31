import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { AppHeader } from "@/components/AppHeader";
import { type Instrucao, usoTexto } from "@/lib/instrucoes";
import { EditorInstrucao } from "./EditorInstrucao";

// Editor de UMA instrução. O slug "nova" é o caso de criação — mesma tela, sem
// linha no banco ainda. `?de=` pré-preenche o texto a partir de um fato do
// perfil ("virar instrução").
export const dynamic = "force-dynamic";

function primeiroNome(nomeCompleto: string): string {
  return nomeCompleto.trim().split(/\s+/)[0] ?? "";
}

export default async function EditorPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ de?: string }>;
}) {
  const { slug } = await params;
  const { de } = await searchParams;

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

  let instrucao: Instrucao | null = null;
  if (slug !== "nova") {
    // Filtro por tenant_id além do slug: slug é derivado do nome e colide entre
    // contas com facilidade ("como-eu-escrevo" pode existir em várias).
    const { data } = await admin
      .from("instrucoes")
      .select("id, slug, nome, quando_usar, texto, ativo, origem, usos, ultimo_uso, atualizado_em")
      .eq("tenant_id", tenant.id)
      .eq("slug", slug)
      .maybeSingle();
    if (!data) redirect("/app/memoria");
    instrucao = data as Instrucao;
  }

  // `?de=` vem da URL, então NÃO dá pra confiar que é mesmo um fato do perfil:
  // qualquer link montado por terceiro chegaria aqui, e a tela diria "comecei
  // com o fato que ela já sabia" sobre um texto que ela nunca soube. Confere
  // contra o perfil DESTE tenant antes de tratar como fato; o que não casar
  // vira campo vazio e a tela usa o texto neutro.
  let deFato: string | null = null;
  if (!instrucao && de) {
    const { data } = await admin
      .from("user_profile")
      .select("value")
      .eq("tenant_id", tenant.id)
      .eq("value", de)
      .limit(1)
      .maybeSingle();
    if (data) deFato = de;
  }

  // O fato entra só como PONTO DE PARTIDA, e a tela diz isso: o valor da
  // instrução está em escrever o que fazer com o fato, não em repetir o fato.
  const textoInicial = instrucao?.texto ?? (deFato ? `${deFato}\n\n` : "");

  return (
    <main className="aurora-bg min-h-screen">
      <AppHeader
        active="app"
        isPlatformOwner={Boolean(tenant.is_platform_owner)}
        pendentes={0}
        userLabel={primeiroNome(tenant.nome ?? "") || user.email || ""}
      />

      <section className="mx-auto w-full max-w-2xl px-5 py-8 sm:px-8">
        <Link
          href="/app/memoria"
          className="text-[12.5px] font-medium text-aurora-muted transition hover:text-aurora-fg"
        >
          ‹ Memória
        </Link>

        <div className="mt-4 flex flex-col gap-2">
          <span className="text-[11px] font-bold uppercase tracking-[0.09em] text-aurora-accent-text">
            {instrucao ? "Instrução" : "Nova instrução"}
          </span>
          <h1 className="text-[24px] font-semibold leading-tight tracking-tight text-aurora-fg">
            {instrucao?.nome ?? "O que ela precisa saber fazer"}
          </h1>
          {instrucao ? (
            <p className="font-mono text-[11.5px] text-aurora-muted">
              {instrucao.ativo ? "ativa" : "desligada"} · {usoTexto(instrucao.usos, instrucao.ultimo_uso)}
              {instrucao.origem === "proposta" && " · escrita pela Mia, esperando você"}
            </p>
          ) : (
            <p className="max-w-lg text-[13.5px] leading-relaxed text-aurora-muted">
              {deFato
                ? "Comecei com o fato que ela já sabia. Reescreva como instrução: o que ela deve FAZER sabendo disso."
                : "Um jeito seu de fazer as coisas, escrito por extenso. Ela lê quando a situação bater com o gatilho."}
            </p>
          )}
        </div>

        <EditorInstrucao
          id={instrucao?.id ?? null}
          nomeInicial={instrucao?.nome ?? ""}
          quandoUsarInicial={instrucao?.quando_usar ?? ""}
          textoInicial={textoInicial}
          ativoInicial={instrucao?.ativo ?? false}
        />
      </section>
    </main>
  );
}
