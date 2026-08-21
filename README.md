# secretaria-plataforma

Monorepo da secretária agêntica multi-tenant: front-end de onboarding
self-serve (login com Google/Outlook, wizard de configuração) **e** backend
(edge functions Deno em `supabase/functions/`), compartilhando a mesma base
`tenants` + Vault no Supabase. Depois do wizard, a pessoa some com o próprio
bot funcionando — nunca vê nem baixa uma linha de código.

Front-end: Next.js 16 (App Router, Turbopack) + Supabase Auth (`@supabase/ssr`).
Atenção: essa versão do Next tem convenções diferentes do usual — o antigo
`middleware.ts` virou `proxy.ts` (mesma API, `NextRequest`/`NextResponse`, só
o nome do arquivo e da função exportada mudou; ver comentário no topo do
arquivo).

Backend: `supabase/functions/{reflex,fast,cron,telegram}` (Deno, deploy via
GitHub Actions — ver "Deploy do backend" abaixo). Antes vivia num repositório
separado (`secretaria-agentic`); os dois foram consolidados aqui pra parar de
divergir código-vivo entre repo e produção (ver seção "Deploy do backend").

## Como funciona

Pensado pra quem não tem nenhuma bagagem técnica (ex: alguém que só usa
Office/e-mail, ou não tem familiaridade com "tokens"/"integrações") — por
isso o wizard esconde complexidade por padrão e só mostra opções avançadas
pra quem pede.

1. **`/login`** — botão(ões) de entrada, um por provider habilitado em
   `lib/oauth-providers.ts` (`enabled: true`). Cada um pede login **e** os
   escopos de Calendar/Mail no mesmo consentimento (Google:
   `access_type=offline` + `prompt=consent`; Outlook: scope `offline_access`
   + `prompt=consent`), senão o provider não devolve `refresh_token`. **Hoje
   só o Google está habilitado** — o suporte a Outlook já está implementado
   de ponta a ponta (callback, colunas, vinculação), mas fica escondido da UI
   até o Azure App Registration estar configurado (ver "Setup externo
   pendente"), pra não mostrar um botão que não funciona. Pra reativar, é só
   trocar `enabled: false` → `true` no `azure` de `OAUTH_PROVIDERS`.
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
     opcional). No topo, um cartão "Contas conectadas" mostra os provedores
     habilitados (hoje só Google) com um botão "Conectar" pra quem a pessoa
     ainda não linkou — usa `supabase.auth.linkIdentity()` (mesmo mecanismo
     do login, mas pra adicionar uma segunda conta a quem já está logado).
   * **Passo 2 (tarefas)** — Google Tasks fica em destaque (zero fricção,
     reusa o login); ClickUp/Notion/Trello ficam recolhidos atrás de "Já usa
     ClickUp, Notion ou Trello?" pra não confundir quem nunca ouviu falar
     dessas ferramentas. As três buscam as listas/databases reais da pessoa
     (`app/api/onboarding/{clickup-lists,notion-databases,trello-lists}`) pra
     ela escolher pelo nome — Trello usa a API key própria da pessoa se ela
     colar uma, senão a `TRELLO_API_KEY` global (ver "Setup local"); sem
     nenhuma das duas, cai num textarea de fallback pra colar o mapa em JSON.
   * **Passo 3 (canal)** — WhatsApp (marcado como recomendado — é o canal
     mais natural pro público-alvo), Telegram ou ambos. Escolhendo Telegram,
     o próprio onboarding chama o `setWebhook` da API do Telegram
     (`app/api/onboarding/channel`) apontando pra
     `.../functions/v1/telegram/<slug>` — o bot já sai funcionando, sem
     ninguém configurando isso manualmente. Se falhar (token errado, rede),
     não trava o onboarding, só avisa na tela de recibo. Escolhendo WhatsApp,
     a mesma rota gera um código de vínculo de 6 letras (30min de validade,
     mesmo alfabeto/TTL de `createWhatsAppLinkCode` no backend) e mostra na
     tela de recibo — a pessoa manda esse código numa mensagem pro número
     compartilhado da plataforma (instância `secretaria`) pra vincular o
     próprio WhatsApp, sem token nem configuração manual nenhuma.

   Termina numa tela de recibo com um link "Editar configuração" que volta
   pro passo 1 — como cada passo faz upsert (não só insert), reabrir
   `/onboarding` depois (a raiz `/` já redireciona quem está logado pra lá)
   serve como tela de "gerenciar depois". Cada passo chama uma API route
   (`app/api/onboarding/*`) que grava em `tenants` via **service role** (RLS
   de `tenants` hoje nega tudo pra `authenticated`; toda escrita passa por
   uma rota server-side que verifica a sessão antes).

Depois disso o tenant já está pronto pro **backend** (`supabase/functions/`,
neste mesmo repo) usar — Telegram e WhatsApp funcionam ponta a ponta.

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

## Deploy do backend (edge functions)

`.github/workflows/deploy-edge-functions.yml` roda `supabase functions
deploy --project-ref edaogdfeuxrylwqpopqe` a cada push em `main` que toque
`supabase/functions/**` (também dá pra disparar manualmente via
"Run workflow"). Isso existe pra fechar o motivo raiz de vários bugs desta
sessão: com dois repositórios, código deployado em produção divergia
silenciosamente do que estava no git (deploys manuais por function, sem
histórico). Com o CI, `supabase/functions/` neste repo passa a ser a fonte
única de verdade — o que está em produção é sempre o que está em `main`.

**Setup pendente (só quem administra a plataforma pode fazer):**
1. Gerar um access token em
   [supabase.com/dashboard/account/tokens](https://supabase.com/dashboard/account/tokens).
2. Adicionar como secret do repositório: Settings → Secrets and variables →
   Actions → New repository secret → nome `SUPABASE_ACCESS_TOKEN`.

Sem esse secret, o workflow falha (mas não bloqueia nada além do próprio
deploy automático — dá pra continuar deployando manualmente com
`supabase functions deploy` local até configurar).

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
      `Calendars.ReadWrite`, `Mail.Read`, `Tasks.ReadWrite`, `offline_access`,
      `email`, `openid`, `profile`.
   5. Colar o Application (client) ID + o secret em Supabase Dashboard →
      Authentication → Providers → Azure, habilitar.
   6. Habilitar **"Manual Linking"** nas configurações de Authentication do
      projeto Supabase — obrigatório pro `linkIdentity()` funcionar (é o que
      permite vincular uma segunda conta a quem já está logado).
   7. **Além do provider do Supabase Auth** (que só serve pro LOGIN), colar o
      MESMO Application (client) ID + client secret também em Supabase
      Dashboard → Edge Functions → Secrets, como `MICROSOFT_CLIENT_ID` e
      `MICROSOFT_CLIENT_SECRET` — é o que `_shared/microsoft-oauth.ts` usa
      pra trocar o refresh_token de cada tenant por access_token na hora de
      falar com o Graph (Microsoft To Do). Sem isso o login funciona mas
      Microsoft To Do falha em toda chamada. Mesmo App Registration reusado
      pelo bot do Teams (`TEAMS_APP_ID`/`TEAMS_APP_PASSWORD`) — são o MESMO
      app, só duplicado sob nomes de secret diferentes porque cada
      integração lê sua própria variável.
   * Risco a documentar: TI de empresas costuma bloquear consentimento de
     apps novos pedindo Calendar/Mail — isso acontece na tela da própria
     Microsoft, antes de chegar no nosso callback, não dá pra contornar em
     código. Se acontecer, orientar a pessoa a pedir liberação ao TI ou usar
     uma conta pessoal.

## Pendências conhecidas (não bloqueiam o piloto, mas documentar)

* **WhatsApp por número compartilhado — ativado.** `/onboarding` gera o
  código de vínculo de 6 letras (`app/api/onboarding/channel`) e o backend
  (`supabase/functions/reflex/index.ts`, `handleSharedNumberMessage`) consome
  esse código e autoriza o número que mandou a mensagem. Os dois
  pré-requisitos que bloqueavam isso já foram resolvidos:
  1. O workflow do n8n (`Secretaria Agentic — WhatsApp`) já manda `instance`
     no corpo da chamada pro `reflex`.
  2. O secret `PLATFORM_EVOLUTION_INSTANCE=secretaria` foi setado nas edge
     functions (Supabase Dashboard → Edge Functions → Secrets) — mesma
     instância (`secretaria`) que o n8n já usa pra falar com o Evolution API,
     desligando o killswitch temporário que existia em `reflex/index.ts`
     (comentário "KILLSWITCH TEMPORÁRIO (05/08)").

  Como o valor de um secret não é algo que eu (Claude) consigo ler de volta
  pra confirmar, vale um teste rápido ponta a ponta antes de contar com isso
  em produção: completar o passo 3 do wizard escolhendo WhatsApp com um
  número de teste e mandar o código gerado pro número da plataforma — a
  resposta esperada é a mensagem de sucesso de `LINK_SUCCESS_MESSAGE` em
  `reflex/index.ts` ("✅ Pronto, esse WhatsApp já está vinculado...").
* As colunas `tenants.trello_api_key_secret_id` e
  `tenants.outlook_refresh_token_secret_id` já foram aplicadas em produção
  (migration `tenants_add_trello_api_key_and_outlook_refresh_token`) —
  `/onboarding` já pode gravar/ler as duas, e `buildTenantEnv`
  (`supabase/functions/_shared/tenant.ts`) já usa a key própria do Trello por
  tenant quando presente, caindo pra `TRELLO_API_KEY` global quando não.
* **Outlook habilitado na UI (18/08/2026)** — Azure App Registration
  concluído (tenant próprio criado via conta Azure — o Microsoft 365
  Developer Program não qualificou a conta pessoal) e provider Azure ligado
  no Supabase Auth; `enabled: true` em `lib/oauth-providers.ts`. Login e
  vinculação funcionam de ponta a ponta (callback, colunas, Vault — tudo já
  suportava os dois provedores). **Microsoft To Do (tarefas) tem backend
  completo** (`_shared/microsoft-oauth.ts` + `_shared/providers/microsoft-todo-provider.ts`,
  18/08/2026) — 5º provedor de tarefas, ao lado de Google Tasks/ClickUp/
  Notion/Trello, recomendado no wizard quando a pessoa loga com Outlook. **O
  que ainda falta (Fase 2, trabalho futuro):** Calendar/Mail via Microsoft
  Graph — hoje `calendar-read.ts`, `calendar-write.ts` e `gmail-read.ts` só
  falam com `googleapis.com`. Decisão já tomada sobre como isso vai
  funcionar quando alguém conectar os dois: **por capacidade** — Agenda e
  E-mail viram escolhas independentes no wizard (cada uma podendo vir de um
  provedor diferente), Tarefas continua sendo escolha à parte, não um
  provedor "principal" que governa tudo.
* **Mapa de frentes virou auto-criação (18/08/2026)** — o wizard não pede
  mais pra escolher uma lista/database já existente: ao concluir o passo de
  Tarefas, a Mia cria 1 lista nova por área nos 5 provedores
  (`lib/task-list-create.ts`, rota `/api/onboarding/task-provider`), sem
  exigir que a pessoa vá criar nada na origem antes. Efeitos colaterais a
  saber: ClickUp usa o primeiro space do primeiro workspace acessível pelo
  token, Trello usa o primeiro board, e o Notion exige que pelo menos 1
  PÁGINA (não só databases) esteja compartilhada com a integração — sem
  isso não tem onde criar o database novo. Idempotente: só cria lista pra
  área que ainda não está no `task_provider_list_map` salvo.
* **Canal virou múltipla escolha (18/08/2026)** — o passo 3 do wizard deixou
  de ser um rádio único (`whatsapp` | `telegram` | `both`) e virou checkbox:
  WhatsApp, Telegram e Teams, qualquer combinação. `tenants.channel_preference`
  perdeu o CHECK de enum fechado e agora guarda texto livre separado por
  vírgula (ex: `"whatsapp,teams"`) — é só exibição (cron de avisos, /admin),
  quem autoriza de verdade continua sendo cada coluna própria
  (`whatsapp_authorized_number` / `telegram_authorized_chat_id` /
  `teams_authorized_user_id`). Teams entrou no wizard usando o mesmo
  código de vínculo de 6 letras do WhatsApp.

## Repositório

Front-end e backend (edge functions) vivem juntos neste repo desde a
consolidação com o `secretaria-agentic` — antes eram dois projetos separados
e o código em produção divergia do que estava versionado em cada um deles
(deploys manuais, por function, sem CI). `secretaria-agentic` deve ser
arquivado assim que tudo estiver confirmado funcionando a partir daqui.
