# secretaria-plataforma

Onboarding self-serve da secretária agêntica: login com Google, wizard de
configuração (persona + gerenciador de tarefas), grava tudo direto na mesma
base multi-tenant do projeto **secretaria-agentic** (tabela `tenants` +
Vault). Depois do wizard, a pessoa some com o próprio bot funcionando — nunca
vê nem baixa uma linha de código.

Next.js 16 (App Router, Turbopack) + Supabase Auth (`@supabase/ssr`). Ver
`AGENTS.md` na raiz — essa versão do Next tem convenções diferentes do usual
(ex: `middleware.ts` virou `proxy.ts`).

## Como funciona

1. **`/login`** — botão "Entrar com Google". Pede login **e** os escopos de
   Calendar/Gmail/Tasks no mesmo consentimento (`access_type=offline` +
   `prompt=consent`, senão o Google não devolve `refresh_token`).
2. **`/auth/callback`** — troca o `code` pela sessão, garante a linha em
   `tenants` (`auth_user_id`) e grava o `refresh_token` do Google no Vault
   (`lib/tenant-provisioning.ts`).
3. **`/onboarding`** — wizard de 2 passos: persona (nome/cargo/frentes) e
   gerenciador de tarefas (ClickUp/Notion/Trello/Google Tasks + token +
   mapa de frentes). Cada passo chama uma API route
   (`app/api/onboarding/*`) que grava em `tenants` via **service role**
   (RLS de `tenants` hoje nega tudo pra `authenticated`; toda escrita passa
   por uma rota server-side que verifica a sessão antes).

Depois disso o tenant já está pronto pro **backend** (edge functions do
`secretaria-agentic`) usar — só falta o canal (WhatsApp/Telegram), que ainda
é conectado manualmente (ver "Pendências" abaixo).

## Setup local

```bash
npm install
cp .env.local.example .env.local   # preencher com os valores abaixo
npm run dev
```

Valores de `.env.local`: `NEXT_PUBLIC_SUPABASE_URL` e
`NEXT_PUBLIC_SUPABASE_ANON_KEY` (Supabase → Project Settings → Data API) e
`SUPABASE_SERVICE_ROLE_KEY` (Project Settings → API Keys → `service_role` —
nunca commitar, nunca usar num Client Component).

## Setup externo pendente (obrigatório antes de qualquer login funcionar)

1. Habilitar o provider Google no Supabase Auth — Dashboard do projeto
   `secretaria-agentic` (`edaogdfeuxrylwqpopqe`) → Authentication → Sign In /
   Providers → Google. Importante: usar o MESMO Client ID/Secret que já está
   configurado como `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` nas edge
   functions — um `refresh_token` só é válido pra trocar por `access_token`
   sob o client OAuth que o emitiu. Usar um client diferente aqui quebra
   silenciosamente o acesso a Calendar/Gmail/Tasks depois.
2. Redirect URI no Google Cloud Console — no mesmo OAuth client acima,
   adicionar `https://<project-ref>.supabase.co/auth/v1/callback` (Supabase
   expõe esse callback fixo) em "Authorized redirect URIs".
3. URL Configuration no Supabase Auth — Authentication → URL Configuration →
   Redirect URLs: adicionar a URL do deploy (Vercel) + `/auth/callback`, e
   `http://localhost:3000/auth/callback` pra desenvolvimento local.
4. Deploy na Vercel — importar este repositório, setar as 3 env vars acima
   nas configurações do projeto.

## Pendências conhecidas (não bloqueiam o piloto, mas documentar)

* Conexão do canal (WhatsApp/Telegram) ainda é manual. O wizard termina sem
  provisionar instância do WhatsApp nem bot do Telegram — isso é trabalho de
  infraestrutura (Evolution API precisa de número dedicado por tenant;
  Telegram precisa criar o bot via @BotFather e configurar o webhook
  `/telegram/<slug>`). Automatizar isso é o próximo passo grande desta
  plataforma.
* Trello precisa de 2 credenciais (`TRELLO_API_KEY` + `TRELLO_API_TOKEN`),
  mas `tenants` só tem 1 coluna de token por provider — o wizard só grava o
  token; a API key continua vindo do ambiente global das edge functions (gap
  já documentado em `secretaria-agentic/docs/multi-tenant.md`).
* Mapa de frentes é JSON cru no wizard (sem validação de formato nem UI
  guiada por plataforma) — funcional, mas exige que quem preenche saiba o
  formato esperado (exemplos aparecem como placeholder no campo). Uma versão
  futura poderia ter um formulário estruturado por linha em vez de textarea.
* Sem página de "gerenciar depois" — hoje o wizard só roda uma vez após o
  login; pra editar a configuração é preciso mexer direto na tabela
  `tenants` (ou reautorizar o Google, que atualiza o refresh token). Uma
  tela de configurações pós-onboarding é trabalho futuro.

## Repositório

Este projeto é separado do `secretaria-agentic` (que tem as edge functions e
a migration que criou `tenants`/as RPCs de Vault) de propósito — front-end e
back-end evoluem e deployam independentes, compartilhando só o Supabase.
