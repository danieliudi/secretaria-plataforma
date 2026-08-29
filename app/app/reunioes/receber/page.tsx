import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { AppHeader } from "@/components/AppHeader";
import { ReceberReuniao } from "./cliente";

// Destino do "Compartilhar com..." do Android. Quem chega aqui vem do menu do
// sistema, com um áudio na mão — a página não pede nada, só confirma e sobe.
//
// O POST do compartilhamento nunca chega neste Server Component: o service
// worker (public/sw.js) intercepta ANTES, guarda o arquivo no cache local e
// redireciona pra cá como GET com ?compartilhado=1. Ver sw.js pro motivo (o
// limite de 6 MB de corpo das funções da Netlify).
export const dynamic = "force-dynamic";

function primeiroNome(nomeCompleto: string): string {
  return nomeCompleto.trim().split(/\s+/)[0] ?? "";
}

export default async function ReceberPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const admin = createServiceClient();
  const { data: tenant } = await admin
    .from("tenants")
    .select("id, nome, aprovado_em, is_platform_owner")
    .eq("auth_user_id", user.id)
    .maybeSingle();

  if (!tenant) redirect("/onboarding");
  if (!tenant.aprovado_em) redirect("/onboarding");

  return (
    <main className="aurora-bg min-h-screen">
      <AppHeader
        active="app"
        isPlatformOwner={Boolean(tenant.is_platform_owner)}
        pendentes={0}
        userLabel={primeiroNome(tenant.nome ?? "") || user.email || ""}
      />
      <div className="mx-auto w-full max-w-lg px-5 py-8 sm:px-8">
        <ReceberReuniao />
      </div>
    </main>
  );
}
