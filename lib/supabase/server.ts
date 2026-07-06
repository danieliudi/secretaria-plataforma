// Cliente Supabase pro server (Server Components, Route Handlers). Roda com a
// sessão do usuário logado (anon key + cookies) — respeita RLS. Pra
// ler/gravar em `tenants` (RLS nega tudo pra authenticated hoje) use
// service.ts, sempre depois de verificar a identidade por aqui.
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // Chamado de um Server Component (sem acesso de escrita a
            // cookies) — o proxy.ts já cuida de refrescar a sessão.
          }
        },
      },
    },
  );
}
