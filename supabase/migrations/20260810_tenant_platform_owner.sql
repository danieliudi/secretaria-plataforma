-- Marca explicitamente QUAL tenant é o dono da plataforma.
--
-- Motivo: os secrets globais das edge functions (Deno.env) são as contas
-- PESSOAIS do dono da plataforma — Google, ClickUp, GA4, Evolution, Telegram,
-- CRM da Sanwey. Até aqui `buildTenantEnv` terminava com
--     overrides.get(key) ?? Deno.env.get(key)
-- ou seja, QUALQUER campo que um tenant não tivesse configurado caía
-- silenciosamente na credencial pessoal do dono — um usuário novo sem Google
-- conectado operava na agenda e no Gmail dele.
--
-- Com esta coluna, herdar credencial pessoal do ambiente global passa a ser um
-- privilégio explícito de um único tenant, em vez do comportamento padrão de
-- todos. Ver SHARED_INFRA_KEYS em supabase/functions/_shared/tenant.ts para as
-- chaves que continuam compartilhadas por serem infra da plataforma (Anthropic,
-- Supabase, app OAuth) e não de ninguém.

alter table public.tenants
  add column if not exists is_platform_owner boolean not null default false;

comment on column public.tenants.is_platform_owner is
  'Somente o tenant do dono da plataforma pode herdar credenciais PESSOAIS dos secrets globais das edge functions. Todos os demais precisam ter as próprias no Vault — ausência é erro, nunca herança.';

-- O tenant `daniel` é o dono: é dele que são os secrets globais hoje.
update public.tenants set is_platform_owner = true where slug = 'daniel';

-- Garantia estrutural: no máximo um dono.
create unique index if not exists tenants_unico_platform_owner
  on public.tenants ((true)) where is_platform_owner;
