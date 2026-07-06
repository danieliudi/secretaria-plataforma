"use client";

import { use, useState } from "react";
import { createClient } from "@/lib/supabase/client";

// Escopos pedidos JÁ no login: além de identidade, Calendar/Gmail/Tasks — uma
// tela só resolve login + as integrações. access_type=offline + prompt=consent
// garantem que o Google devolva um refresh_token (senão só vem access_token,
// que expira em ~1h e não serve pro /fast operar depois).
const GOOGLE_SCOPES = [
  "https://www.googleapis.com/auth/calendar",
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/tasks",
].join(" ");

const ERROR_MESSAGES: Record<string, string> = {
  missing_code: "Não recebemos a confirmação do Google. Tenta de novo?",
  auth_failed: "Não conseguimos confirmar seu login. Tenta de novo?",
};

export default function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  // `use()` numa Promise em Client Component — suporte oficial desta versão
  // do Next pra ler searchParams sem precisar de Server Component por cima.
  const { error: errorParam } = use(searchParams);
  const [loading, setLoading] = useState(false);

  async function handleLogin() {
    setLoading(true);
    const supabase = createClient();
    const redirectTo = `${window.location.origin}/auth/callback`;
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo,
        scopes: GOOGLE_SCOPES,
        queryParams: { access_type: "offline", prompt: "consent" },
      },
    });
    if (error) {
      setLoading(false);
      console.error("[login] signInWithOAuth falhou:", error.message);
    }
    // Sucesso: o navegador é redirecionado pro Google, não há mais o que fazer aqui.
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 p-8 text-center">
      <h1 className="text-3xl font-semibold">Sua secretária, em minutos</h1>
      <p className="max-w-md text-neutral-500">
        Entre com sua conta Google pra conectar agenda, email e tarefas — sem
        precisar mexer em nada técnico. Você configura o resto na próxima tela.
      </p>
      {errorParam && (
        <p className="max-w-md rounded-lg bg-red-50 px-4 py-2 text-sm text-red-700">
          {ERROR_MESSAGES[errorParam] ?? "Algo deu errado. Tenta de novo?"}
        </p>
      )}
      <button
        onClick={handleLogin}
        disabled={loading}
        className="rounded-full bg-black px-6 py-3 font-medium text-white transition hover:bg-neutral-800 disabled:opacity-60"
      >
        {loading ? "Redirecionando…" : "Entrar com Google"}
      </button>
    </main>
  );
}
