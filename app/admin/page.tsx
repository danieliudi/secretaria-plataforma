import { notFound } from "next/navigation";
import { createServiceClient } from "@/lib/supabase/service";
import { carregaDonoDaPlataforma } from "@/lib/admin-guard";
import AdminLista, { type CadastroAdmin } from "./lista";

// Server Component: carrega tudo com a service role DEPOIS de confirmar que
// quem pediu é o dono da plataforma. O e-mail vem de auth.users (não existe em
// `tenants`), então precisa da API de admin do Supabase Auth.
export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const dono = await carregaDonoDaPlataforma();
  // 404 e não "acesso negado": pra quem não é dono, esta página não existe.
  if (!dono) notFound();

  const admin = createServiceClient();
  const { data, error } = await admin
    .from("tenants")
    .select("slug, nome, cargo, frentes, channel_preference, auth_user_id, is_platform_owner, google_refresh_token_secret_id, whatsapp_authorized_number, telegram_authorized_chat_id, aprovado_em, recusado_em, created_at")
    .eq("active", true)
    .order("created_at", { ascending: false });

  if (error) {
    console.error(`[admin] listagem falhou: ${error.message}`);
    return (
      <main className="mx-auto flex w-full max-w-3xl flex-col gap-3 px-6 py-16">
        <h1 className="text-xl font-semibold text-foreground">Não conseguimos carregar a lista</h1>
        <p className="text-[13.5px] text-muted">Recarrega a página? Se persistir, o motivo está no log do servidor.</p>
      </main>
    );
  }

  const linhas = (data ?? []) as Array<Record<string, unknown>>;

  // O e-mail é o único dado que não mora em `tenants`. Uma chamada só,
  // casando por auth_user_id — evita N consultas numa lista que cresce.
  const emails = new Map<string, string>();
  try {
    const { data: usuarios } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
    for (const u of usuarios?.users ?? []) {
      if (u.email) emails.set(u.id, u.email);
    }
  } catch (err) {
    console.error(`[admin] listUsers falhou, seguindo sem e-mail: ${String(err)}`);
  }

  const cadastros: CadastroAdmin[] = linhas.map((t) => ({
    slug: String(t.slug),
    nome: (t.nome as string | null) ?? "",
    cargo: (t.cargo as string | null) ?? "",
    frentes: ((t.frentes as string[] | null) ?? []).join(", "),
    email: emails.get(String(t.auth_user_id)) ?? "",
    canal: (t.channel_preference as string | null) ?? "",
    dono: Boolean(t.is_platform_owner),
    googleConectado: Boolean(t.google_refresh_token_secret_id),
    canalVinculado: Boolean(t.whatsapp_authorized_number) || Boolean(t.telegram_authorized_chat_id),
    aprovadoEm: (t.aprovado_em as string | null) ?? null,
    recusadoEm: (t.recusado_em as string | null) ?? null,
    criadoEm: String(t.created_at),
  }));

  return <AdminLista cadastros={cadastros} />;
}
