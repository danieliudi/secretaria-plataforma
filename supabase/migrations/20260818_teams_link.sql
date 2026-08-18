-- Vínculo do Microsoft Teams — mesmo modelo do WhatsApp por número
-- compartilhado (código de 6 caracteres), porque o bot do Teams também é UM
-- só, compartilhado entre vários tenants, ao contrário do Telegram (bot
-- próprio por tenant, autorizado por chat_id trust-on-first-use).
--
-- teams_authorized_user_id guarda o aadObjectId (GUID) da pessoa vinculada —
-- é o identificador estável de conta pessoal da Microsoft, ao contrário do
-- `from.id` da Activity, que pode variar por conversa.
alter table public.tenants
  add column teams_authorized_user_id text,
  add column teams_link_code text,
  add column teams_link_code_expires_at timestamptz;

alter table public.tenants
  add constraint tenants_teams_authorized_user_id_key unique (teams_authorized_user_id);

alter table public.tenants
  add constraint tenants_teams_authorized_user_id_guid
  check (
    teams_authorized_user_id is null
    or teams_authorized_user_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  );
