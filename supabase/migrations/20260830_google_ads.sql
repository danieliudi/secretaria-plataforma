-- Google Ads por tenant.
--
-- POR QUE ISTO EXISTE: a Mia já vê tráfego (GA4), lead (CRM) e proposta (CRM),
-- mas não vê o GASTO que gerou tudo isso. GA4 é Google *Analytics* — enxerga
-- que chegou gente pelo anúncio, não quanto se pagou por ela, em qual palavra,
-- nem se a campanha ainda está de pé. Sem esse elo, ninguém responde "quanto
-- custou um cliente".
--
-- DESLIGADO POR PADRÃO, e isso é requisito, não detalhe: a esmagadora maioria
-- dos tenants não roda Google Ads. Uma funcionalidade que assume que todo mundo
-- tem vira erro no relatório de quem não tem.
alter table public.tenants
  -- Chave de liga/desliga separada do mapa de contas de propósito: permite
  -- pausar sem perder a configuração, e deixa "desligado por escolha"
  -- distinguível de "nunca configurado" — que são mensagens diferentes na tela.
  add column if not exists google_ads_ativo boolean not null default false,

  -- frente → customer id do Google Ads (só dígitos, sem hífen).
  -- Espelha ga4_property_map: mesma ideia, mesmo formato, configurado no banco.
  --   {"resibag": "1234567890", "sanwey": "0987654321"}
  add column if not exists google_ads_customer_map jsonb not null default '{}'::jsonb,

  -- Conta GERENCIADORA (MCC) por onde as contas acima são acessadas. Vai no
  -- header `login-customer-id` de toda chamada. Fica separado do mapa porque é
  -- um só pra todas as frentes do tenant.
  add column if not exists google_ads_login_customer_id text;

comment on column public.tenants.google_ads_ativo is
  'Liga a leitura do Google Ads pra este tenant. Falso = a Mia nem tenta, e diz na tela que está desligado.';
comment on column public.tenants.google_ads_customer_map is
  'frente → customer id do Google Ads (só dígitos). Mesmo formato do ga4_property_map.';
comment on column public.tenants.google_ads_login_customer_id is
  'Customer id da conta gerenciadora (MCC), usado no header login-customer-id.';

-- Guarda de formato: customer id do Google Ads é numérico de 10 dígitos. Sem
-- isto, um id com hífen (que é como o Google MOSTRA na interface: 123-456-7890)
-- entraria no banco e a API responderia um 400 sem explicar o porquê.
alter table public.tenants
  add constraint tenants_google_ads_login_customer_id_formato
  check (google_ads_login_customer_id is null or google_ads_login_customer_id ~ '^[0-9]{8,12}$');
