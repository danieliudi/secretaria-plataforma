// Apagar um fato do perfil automático a partir da tela de Memória.
//
// Só DELETE: os fatos não são editáveis aqui de propósito. Editar um fato solto
// seria consertar a memória errada — o caminho pra corrigir de verdade é
// "virar instrução", que abre o editor com o texto pré-preenchido e deixa o
// fato pra trás. Aqui fica só a saída: apagar o que envelheceu ou nunca esteve
// certo.
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { semDadoPessoal } from "@/lib/log-seguro";

export async function DELETE(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "não autenticado" }, { status: 401 });

  let body: { key?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }
  const key = typeof body.key === "string" ? body.key.trim().slice(0, 60) : "";
  if (!key) return NextResponse.json({ error: "key inválida" }, { status: 400 });

  const admin = createServiceClient();
  const { data: tenant } = await admin
    .from("tenants")
    .select("id, aprovado_em, recusado_em, active")
    .eq("auth_user_id", user.id)
    .maybeSingle();
  if (!tenant || !tenant.aprovado_em || tenant.recusado_em || tenant.active === false) {
    return NextResponse.json({ error: "sem acesso" }, { status: 401 });
  }

  // Filtro por tenant_id ALÉM da key: `key` é snake_case curto e colide entre
  // contas com facilidade ("prefere_manha" existe em qualquer perfil). Sem
  // este filtro, apagar um fato daqui apagaria o de outra pessoa.
  const { error } = await admin
    .from("user_profile")
    .delete()
    .eq("tenant_id", tenant.id)
    .eq("key", key);
  if (error) {
    return NextResponse.json({ error: semDadoPessoal(error.message) }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
