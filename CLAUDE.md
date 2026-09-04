# Regras de trabalho neste repositório

Carregado em toda sessão. Vale **sempre**, inclusive em modo automático — modo
automático dá liberdade pra pesquisar, escrever e testar; não dá licença pra
decidir o rumo do produto nem pra entregar sem conferência.

Este arquivo é o **contrato**: regra e gatilho, nada mais. Duas leituras
laterais, sob demanda:

- **`docs/mapa.md`** — o que existe (funções, rotas, jobs, integrações) e o que
  quebra sem cada peça. Consulte antes de assumir que algo não existe.
- **`docs/licoes.md`** — por que cada regra abaixo existe, com data e o erro que
  a originou. Leia quando quiser o racional; não é preciso pra trabalhar.

Se um texto explica o passado, ele mora em `licoes.md`. Se muda o que você faz
agora, mora aqui.

## 1. Mockup antes de construir

Antes de qualquer mudança de plataforma (tela, fluxo, texto que o usuário lê,
comportamento da secretária, dados), **mostre primeiro o que vai ser feito**.

- **Interface → artifact HTML renderizado**, nunca ASCII. Leia o componente e os
  tokens reais antes (`app/globals.css`, o componente que vai mudar, a fonte em
  `.next/static/media/`) — mockup de memória erra o que a tela já é. Reproduza a
  tela e use o espaço em volta pro que ela não mostra sozinha (o efeito no
  WhatsApp, o estado seguinte, o erro).
- **Backend/comportamento → texto**: antes/depois, o que muda pro usuário, o que
  muda no banco.

O mockup vem **antes** do código, pra ele poder dizer "não é isso" enquanto
ainda é barato.

## 2. Perguntar com opções, não decidir sozinho

Havendo mais de um caminho razoável, traga **A / B / C com trade-off e uma
recomendação**, e espere a escolha. Vale pra arquitetura, dependência, qualquer
coisa que **custe dinheiro**, mudança irreversível (migration destrutiva,
rotação de chave, remoção de tenant) e texto que o usuário final lê.

Não vale pra detalhe mecânico (nome de variável, ordem de import, formatação) —
isso decide e segue.

## 3. Check de segurança antes de entregar

Depois de executado, **antes de dizer que terminou**, rode sobre tudo que mexeu
— código, comentário, migration, configuração:

- **Tenant** — toda query nova filtra por `tenant_id`? Nenhum caminho novo cai
  em tenant padrão por fallback?
- **Auth** — endpoint novo/alterado exige `isInternalCall()`, `verify_jwt` ou
  secret de webhook? Comparação de segredo em tempo constante?
- **Segredos** — nenhum valor real em código, comentário, log, commit ou chat.
  Vault ou env var; verificação só por fingerprint.
- **PII em log** — nada de telefone, e-mail, `chat_id` ou conteúdo de mensagem.
- **Entrada hostil** — payload de webhook, texto de usuário e resposta de API
  externa validados e com limite de tamanho.
- **Portão de acesso** — funcionalidade paga respeita `aprovado_em` no backend,
  não só na tela.

Reporte o resultado junto com a entrega, inclusive quando não achar nada. Se
achar, corrija antes ou aponte explicitamente o que ficou aberto e por quê.

## 4. Verde não é prova — nunca reporte pronto só com build ou teste

Build que passa prova ausência de erro de sintaxe, não presença do que foi
pedido. Antes de dizer "pronto":

- **Teste local aqui mente por padrão.** O proxy bloqueia `deno.land`, então a
  suíte roda com import-map de stub. Rode `testes.yml` **no CI**
  (`comportamento: false`, pra não gastar os ~US$ 0,20) e cite o run.
- Rode o caminho real e **leia a saída**, não o exit code. `deno run` imprimindo
  o valor vale mais que um teste verde.
- Mudança de tela: veja a tela. Mudança de mensagem: renderize a mensagem.

## 5. Afirmação carrega a origem

A classe de erro mais cara deste projeto é a secretária dizer uma coisa e o
banco ter outra. Vale pra ela e pra você:

- Fato dito ao usuário (prazo, título, frente, dia da semana, número) sai do
  **retorno da tool**, ecoado — nunca recalculado ou lembrado.
- Percentual ou razão mostra o denominador junto, ou não é mostrado.
- Se o filtro descartou linha, diga quantas.
- Não sabe? Diga que não sabe. Nunca preencha com o plausível.

## 6. Erro da sessão vira regra datada, não anedota

Afirmação errada que chegou a mudar uma decisão, ou bug que a sessão introduziu
e descobriu depois, volta pra `docs/licoes.md` com data e a regra derivada — no
lugar onde teria evitado o erro. Não morre no histórico da conversa.

Vale pra número também: preço, contagem, limite de API e prazo se **conferem
antes de afirmar**, e a origem da conferência entra junto.

## 7. Identificador que outro sistema lê é contrato, não nome

Renomear quebra em silêncio, e o sintoma aparece longe da causa. Confira quem lê
do outro lado antes de mexer em: valor de `task_provider` (tem CHECK no banco),
`tenants.slug`, nomes de frente em `tenants.frentes` (usados como chave no
`list_map` dos providers), `jobname` do pg_cron, `origem` em `uso_modelo`.

## 8. Nunca pausar por mensagem que chega no meio

Mensagem nova durante um trabalho em andamento não para o que está em curso. Se
der pra paralelizar sem conflito, faça em paralelo; se não, enfileire e siga até
um ponto de corte natural. Só interrompa de verdade se for correção de rumo do
que está sendo feito, ou pedido explícito de parar.

---

# Contexto do projeto

Plataforma multi-tenant de uma secretária de IA. Next.js (Netlify) + Supabase
edge functions (Deno) + WhatsApp via Evolution API + Telegram. Tudo em pt-BR,
inclusive comentários de código.

## Armadilhas que já custaram caro

Só o que morde durante o trabalho — a história de cada uma está em
`docs/licoes.md`.

- **`verify_jwt` roda antes do nosso código**, e `sb_secret_...` não é JWT.
  Função com auth própria precisa de `verify_jwt = false` em
  `supabase/config.toml` (versionado justamente por isso).
- **O secret do Google OAuth vive em 3 lugares** — Auth Provider, secret das
  Edge Functions, env var do Netlify — e tem que ser idêntico nos três.
  Divergência dá `invalid_client` sem dizer qual.
- **`NEXT_PUBLIC_*` é lido em build**, não em runtime: mudar no Netlify exige
  novo deploy.
- **pg_cron lê a service-role key do Vault em execução**, nunca embutida no
  `cron.job.command` — senão rotacionar a chave quebra todos os jobs.
- **`supabase functions deploy --prune` precisa de `--yes`** no CI: sem stdin o
  prompt trava e o job falha *depois* de já ter deployado.
- **Fuso fixo em `America/Sao_Paulo`** pra todos os tenants, no código. Não é bug
  hoje; é o limite pro primeiro tenant fora do Brasil.
