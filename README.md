# secretaria-plataforma

Onboarding self-serve da secretária agêntica: login com Google, wizard de
configuração (persona + gerenciador de tarefas), grava tudo direto na mesma
base multi-tenant do projeto **secretaria-agentic** (tabela `tenants` +
Vault). Depois do wizard, a pessoa some com o próprio bot funcionando — nunca
vê nem baixa uma linha de código.

Next.js 16 (App Router, Turbopack) + Supabase Auth (`@supabase/ssr`). Atenção:
essa versão do Next tem convenções diferentes do usual — o antigo
`middleware.ts` virou `proxy.ts` (mesma API, `NextRequest`/`NextResponse`, só
o nome do arquivo e da função exportada mudou; ver comentário no topo do
arquivo).

## Como funciona

Pensado pra quem não tem nenhuma bagagem técnica (ex: alguém que só usa
Office/e-mail, ou não tem familiaridade com "tokens"/"integrações") — por
isso o wizard esconde complexidade por padrão e só mostra opções avançadas
pra quem pede.

1. **`/login`** — dois botões, "Entrar com Google" e "Entrar com Outlook".
   Cada um pede login **e** os escopos de Calendar/Mail no mesmo
   consentimento (Google: `access_type=offline` + `prompt=consent`; Outlook:
   scope `offline_access` + `prompt=consent`), senão o provider não devolve
   `refresh_token`. A pessoa usa qualquer um dos dois que já tiver no dia a
   dia — não precisa ter conta Google pra usar a plataforma.
2. **`/auth/callback`** — troca o `code` pela sessão, garante a linha em
   `tenants` (`auth_user_id`) e grava o `refresh_token` do provider no Vault
   (`lib/tenant-provisioning.ts`), na coluna certa
   (`google_refresh_token_secret_id` ou `outlook_refresh_token_secret_id`,
   ver `lib/oauth-providers.ts`). Essa mesma rota atende tanto o login
   inicial quanto uma vinculação de conta feita depois (item 3) — os dois
   casos são diferenciados por `?provider=` e `?intent=login|link` na URL de
   retorno, pra saber em qual coluna gravar e pra onde mandar a pessoa se der
   erro (uma vinculação que falha nunca deve devolver pro `/login`, já que a
   pessoa já está logada).
3. **`/onboarding`** — wizard de 3 passos:
   * **Passo 1 (persona)** — nome, cargo, áreas da vida (tudo exceto nome é
     opcional). No topo, um cartão "Contas conectadas" mostra Google/Outlook
     com um botão "Conectar" pra quem a pessoa ainda não linkou — usa
     `supabase.auth.linkIdentity()` (mesmo mecanismo do login, mas pra
     adicionar uma segunda conta a quem já está logado).
   * **Passo 2 (tarefas)** — Google Tasks fica em destaque (zero fricção,
     reusa o login); ClickUp/Notion/Trello ficam recolhidos atrás de "Já usa
     ClickUp, Notion ou Trello?" pra não confundir quem nunca ouviu falar
     dessas ferramentas. As três buscam as listas/databases reais da pessoa
     (`app/api/onboarding/{clickup-lists,notion-databases,trello-lists}`) pra
     ela escolher pelo nome — Trello usa a API key própria da pessoa se ela
     colar uma, senão a `TRELLO_API_KEY` global (ver "Setup local"); sem
     nenhuma das duas, cai num textarea de fallback pra colar o mapa em JSON.
   * **Passo 3 (canal)** — WhatsApp/Telegram/ambos. Escolhendo Telegram, o
     próprio onboarding chama o `setWebhook` da API do Telegram
     (`app/api/onboarding/channel`) apontando pra
     `.../functions/v1/telegram/<slug>` — o bot já sai funcionando, sem
     ninguém configurando isso manualmente. Se falhar (token errado, rede),
     não trava o onboarding, só avisa na tela de recibo.

   Termina numa tela de recibo com um link "Editar configuração" que volta
   pro passo 1 — como cada passo faz upsert (não só insert), reabrir
   `/onboarding` depois (a raiz `/` já redireciona quem está logado pra lá)
   serve como tela de "gerenciar depois". Cada passo chama uma API route
   (`app/api/onboarding/*`) que grava em `tenants` via **service role** (RLS
   de `tenants` hoje nega tudo pra `authenticated`; toda escrita passa por
   uma rota server-side que verifica a sessão antes).

Depois disso o tenant já está pronto pro **backend** (edge functions do
`secretaria-agentic`) usar — só falta o WhatsApp, que ainda é conectado
manualmente (ver "Pendências" abaixo; Telegram já é automático, ver acima).

## Setup local

```bash
npm install
cp .env.local.example .env.local   # preencher com os valores abaixo
npm run dev
```

Valores de `.env.local`: `NEXT_PUBLIC_SUPABASE_URL` e
`NEXT_PUBLIC_SUPABASE_ANON_KEY` (Supabase → Project Settings → Data API) e
`SUPABASE_SERVICE_ROLE_KEY` (Project Settings → API Keys → `service_role` —
nunca commitar, nunca usar num Client Component). `TRELLO_API_KEY` é
opcional — key compartilhada usada como fallback quando a pessoa não cola a
própria no wizard (developer.trello.com/docs/get-started); sem nenhuma das
duas, o wizard continua funcionando, só cai no textarea manual pro Trello.

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
5. **Outlook (Azure App Registration)** — pra habilitar o botão "Entrar com
   Outlook":
   1. portal.azure.com → Microsoft Entra ID → App registrations → New
      registration. **Supported account types: "Contas em qualquer diretório
      organizacional e contas pessoais da Microsoft"** — obrigatório essa
      opção específica (é a única compatível com o endpoint `common` que o
      Supabase usa por padrão, cobrindo tanto conta pessoal Outlook/Hotmail
      quanto conta corporativa Microsoft 365).
   2. Authentication → Add a platform → **Web** → redirect URI
      `https://edaogdfeuxrylwqpopqe.supabase.co/auth/v1/callback` (mesmo
      callback fixo que o Google já usa).
   3. Certificates & secrets → novo client secret → copiar o **Value** na
      hora (só aparece uma vez).
   4. API permissions → Microsoft Graph → Delegated →
      `Calendars.ReadWrite`, `Mail.Read`, `offline_access`, `email`,
      `openid`, `profile`.
   5. Colar o Application (client) ID + o secret em Supabase Dashboard →
      Authentication → Providers → Azure, habilitar.
   6. Habilitar **"Manual Linking"** nas configurações de Authentication do
      projeto Supabase — obrigatório pro `linkIdentity()` funcionar (é o que
      permite vincular uma segunda conta a quem já está logado).
   * Risco a documentar: TI de empresas costuma bloquear consentimento de
     apps novos pedindo Calendar/Mail — isso acontece na tela da própria
     Microsoft, antes de chegar no nosso callback, não dá pra contornar em
     código. Se acontecer, orientar a pessoa a pedir liberação ao TI ou usar
     uma conta pessoal.

## Pendências conhecidas (não bloqueiam o piloto, mas documentar)

* **WhatsApp ainda é manual** — o wizard não provisiona a instância Evolution
  API (precisa de número dedicado por tenant, linkado por QR code). Telegram
  já não tem esse problema: o onboarding registra o webhook do bot sozinho
  (ver "Como funciona" acima).
* Mapa de frentes só é JSON cru no fallback do Trello quando nem a API key
  própria nem a `TRELLO_API_KEY` global estão disponíveis (ClickUp, Notion e
  Google Tasks sempre têm UI guiada com busca automática).
* As colunas `tenants.trello_api_key_secret_id` e
  `tenants.outlook_refresh_token_secret_id` já foram aplicadas em produção
  (migration `tenants_add_trello_api_key_and_outlook_refresh_token`) —
  `/onboarding` já pode gravar/ler as duas. O código do backend
  (`secretaria-agentic`) que efetivamente *usa* a key própria do Trello
  (`buildTenantEnv`) está pronto na branch `claude/trello-api-key-per-tenant`
  mas as edge functions ainda não foram redeployadas com ela — até lá, todo
  tenant continua usando a `TRELLO_API_KEY` global (zero regressão, só a
  personalização por tenant que ainda não está ativa).
* **Fase 2 do Outlook não implementada ainda**: hoje conectar o Outlook só
  guarda o refresh token no Vault — a secretária (backend, `secretaria-agentic`)
  ainda não lê/escreve Calendar/Mail via Microsoft Graph, só Google. Isso é
  trabalho futuro (novo `_shared/microsoft-oauth.ts` + providers de
  calendário/e-mail que agreguem Google e Outlook ao mesmo tempo).

## Repositório

Este projeto é separado do `secretaria-agentic` (que tem as edge functions e
a migration que criou `tenants`/as RPCs de Vault) de propósito — front-end e
back-end evoluem e deployam independentes, compartilhando só o Supabase.
