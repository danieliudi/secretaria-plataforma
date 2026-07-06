// Cliente Supabase pro browser (Client Components). Usa a anon/publishable
// key — segura de expor, respeita RLS. Nunca usar aqui a service role key.
import { createBrowserClient } from "@supabase/ssr";

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
