// Cliente Supabase com a SERVICE ROLE KEY — ignora RLS por completo.
// Só pode ser importado em código server-only (Route Handlers, Server
// Components): NUNCA num Client Component, a key vazaria pro bundle do browser.
//
// Uso obrigatório: só depois de verificar a identidade do usuário via
// server.ts (createClient().auth.getUser()) — nunca confie num id vindo do
// corpo da requisição. Todo acesso a `tenants`/segredos passa por aqui porque
// hoje não existe policy de RLS liberando `authenticated` (só service_role).
import { createClient as createSupabaseClient } from "@supabase/supabase-js";

export function createServiceClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}
