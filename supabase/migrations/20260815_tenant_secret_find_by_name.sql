-- RPC de recuperação pra colisão de nome no Vault.
--
-- POR QUE EXISTE: `upsertTenantSecret` (lib/tenant-provisioning.ts) decide
-- criar-ou-atualizar olhando só pra coluna `tenants.*_secret_id`. O nome do
-- segredo no Vault é DETERMINÍSTICO por tenant+provider
-- (`${provider}_refresh_${tenant.id}`). Se a gravação da coluna falhar DEPOIS
-- do segredo já existir no Vault — foi o caso real de 14/08/2026, onde o bug
-- de cookie do /auth/callback (corrigido na mesma sessão) derrubou a escrita
-- entre os dois passos — o tenant fica travado pra sempre: todo login seguinte
-- tenta CREATE de novo, colide com `secrets_name_idx`, falha, e a coluna nunca
-- é gravada. O Vault tinha o refresh token válido havia dias; a coluna que
-- deveria apontar pra ele ficou null até alguém notar o padrão no log e
-- religar manualmente por SQL.
--
-- Esta função fecha o ciclo: quando `tenant_secret_create` colide, o código
-- chama esta RPC pra achar o id do segredo já existente e reusa ele — sem
-- precisar de acesso direto a `vault.secrets`, que o PostgREST não expõe (daí
-- as quatro RPCs em vez de tabela pública).
--
-- Devolve SÓ O ID, nunca o conteúdo do segredo — o mínimo que o chamador
-- precisa pra decidir entre criar e atualizar.
create or replace function public.tenant_secret_find_id_by_name(p_name text)
returns uuid
language plpgsql
security definer
set search_path = public, vault
as $$
declare
  v_id uuid;
begin
  select id into v_id from vault.secrets where name = p_name;
  return v_id;
end;
$$;

-- Mesma postura das outras três: só service_role (edge functions e o Next.js
-- via createServiceClient) executa. anon e authenticated nunca tocam Vault
-- diretamente.
revoke all on function public.tenant_secret_find_id_by_name(text) from public;
revoke all on function public.tenant_secret_find_id_by_name(text) from anon;
revoke all on function public.tenant_secret_find_id_by_name(text) from authenticated;
grant execute on function public.tenant_secret_find_id_by_name(text) to service_role;
