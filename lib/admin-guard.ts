// Portão do /admin.
//
// A regra é `is_platform_owner` na linha do tenant do usuário logado — NÃO uma
// lista de e-mails no código. E-mail chumbado quebra silenciosamente quando o
// dono troca de conta, e qualquer um que consiga criar conta com aquele
// endereço vira administrador. A coluna só é escrita por migration.
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";

export interface DonoDaPlataforma {
  authUserId: string;
  tenantId: string;
}

/**
 * Devolve o dono se — e só se — o usuário logado for dono da plataforma.
 * `null` em qualquer outro caso (não logado, sem tenant, tenant comum).
 *
 * Quem chama trata `null` como 404, não como 403: uma página de administração
 * que responde "403" pra usuário comum confirma que ela existe.
 */
export async function carregaDonoDaPlataforma(): Promise<DonoDaPlataforma | null> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const admin = createServiceClient();
  const { data, error } = await admin
    .from("tenants")
    .select("id, is_platform_owner")
    .eq("auth_user_id", user.id)
    .maybeSingle();

  if (error) {
    console.error(`[admin] checagem de dono falhou (auth_user_id=${user.id}): ${error.message}`);
    return null;
  }
  if (!data?.is_platform_owner) return null;

  return { authUserId: user.id, tenantId: data.id as string };
}
