// QA das variações de entrada (login, callback, guardas de rota).
//
// POR QUE ISTO EXISTE: um conserto do redirect de OAuth foi pra branch sem
// nenhuma verificação automática, e só um teste manual pegaria a regressão.
// Esta suíte é o mínimo que tem que passar ANTES de qualquer pessoa testar.
//
// COMO RODAR:
//   1. npm install -D playwright-core   (uma vez)
//   2. Em .env.local, aponte NEXT_PUBLIC_SITE_URL pra um host que NÃO seja o
//      do dev server — ex: https://host-canonico-de-teste.invalid. É isso que
//      exercita o bloco E; sem essa variável o teste E vira no-op.
//   3. npm run dev
//   4. node scripts/qa-login.mjs
//   5. Devolva o .env.local ao normal quando terminar.
//
// Variáveis: BASE (padrão localhost:3000), QA_SITE_URL (o mesmo valor do
// NEXT_PUBLIC_SITE_URL usado no passo 2), CHROME (caminho do binário).
//
// O QUE ESTA SUÍTE NÃO COBRE — precisa de conta real e teste manual:
//   - Handshake completo do OAuth com Google e com Outlook.
//   - Primeiro login (cria tenant) x login de quem já tem conta.
//   - Vínculo de segunda conta pelo wizard (intent=link) COM sessão válida.
//   - Consentimento sem provider_refresh_token (login repetido sem prompt).
//   - Estados de conta: pendente, aprovado, recusado, pausado.
//   - Sessão expirada no meio do wizard.
//   - Entrada pelo permalink de deploy da Netlify em produção.

import { chromium } from "playwright-core";

const BASE = process.env.BASE ?? "http://localhost:3000";
const r = [];
const check = (id, desc, passou, obs = "") => {
  r.push({ id, desc, passou, obs });
  console.log(`${passou ? "OK  " : "FALHA"} ${id}  ${desc}${obs ? `  — ${obs}` : ""}`);
};

const browser = await chromium.launch({
  executablePath: process.env.CHROME ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
  args: ["--no-sandbox"],
});

async function novaPagina() {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const p = await ctx.newPage();
  p.on("pageerror", (e) => console.log(`   [pageerror] ${e.message}`));
  return p;
}

// ── A. guardas de rota sem sessão ───────────────────────────────────────────
for (const rota of ["/app", "/onboarding", "/admin"]) {
  const p = await novaPagina();
  await p.goto(BASE + rota, { waitUntil: "domcontentloaded", timeout: 20000 });
  const u = new URL(p.url());
  check(`A${rota}`, `${rota} sem sessão manda pro /login`, u.pathname === "/login", `foi pra ${u.pathname}`);
  await p.context().close();
}

// ── B. /login renderiza o essencial ─────────────────────────────────────────
{
  const p = await novaPagina();
  await p.goto(`${BASE}/login`, { waitUntil: "networkidle", timeout: 20000 });
  check("B1", "botão Google presente", await p.getByRole("button", { name: /Entrar com Google/ }).isVisible());
  check("B2", "botão Outlook presente", await p.getByRole("button", { name: /Entrar com Outlook/ }).isVisible());
  const txt = await p.locator("main").innerText();
  check("B3", "não vaza mensagem de erro sem ?error", !/Tenta de novo/.test(txt));
  await p.context().close();
}

// ── C. mensagens de erro na tela de login ───────────────────────────────────
const errosEsperados = [
  ["missing_code", "Não recebemos a confirmação"],
  ["auth_failed", "Não conseguimos confirmar seu login"],
  ["coisa_inventada", "Algo deu errado"],
];
for (const [code, esperado] of errosEsperados) {
  const p = await novaPagina();
  await p.goto(`${BASE}/login?error=${code}`, { waitUntil: "networkidle", timeout: 20000 });
  const txt = await p.locator("main").innerText();
  check(`C:${code}`, `?error=${code} mostra a mensagem certa`, txt.includes(esperado), esperado);
  // legibilidade da caixa de erro (o rebrand mexeu na paleta)
  const cor = await p.evaluate(() => {
    const el = [...document.querySelectorAll("p")].find((e) => /Tenta de novo|Algo deu errado/.test(e.textContent || ""));
    if (!el) return null;
    const s = getComputedStyle(el);
    return { texto: s.color, fundo: s.backgroundColor };
  });
  check(`C:${code}:cor`, `caixa de erro tem contraste legível`, !!cor && cor.texto !== cor.fundo, cor ? `${cor.texto} sobre ${cor.fundo}` : "não achou");
  await p.context().close();
}

// ── D. /auth/callback — caminhos de falha (não precisam de OAuth real) ──────
// intent=link só acontece de DENTRO do wizard, onde há sessão. Sem sessão, o
// proxy.ts intercepta /onboarding e manda pro /login preservando a query — por
// isso o destino esperado aqui é /login, não /onboarding. O que se testa é que
// o parâmetro certo (link_error) foi montado pelo callback.
const callbacks = [
  { q: "", espera: "/login", param: "error=missing_code", desc: "sem code" },
  { q: "?intent=link", espera: "/login", param: "link_error=missing_code", desc: "sem code, intent=link (sem sessão)" },
  { q: "?code=lixo_invalido&intent=login&provider=google", espera: "/login", param: "error=auth_failed", desc: "code inválido, google" },
  { q: "?code=lixo_invalido&intent=login&provider=azure", espera: "/login", param: "error=auth_failed", desc: "code inválido, azure" },
  { q: "?code=lixo_invalido&intent=link&provider=google", espera: "/login", param: "link_error=auth_failed", desc: "code inválido, intent=link (sem sessão)" },
  { q: "?code=lixo_invalido&provider=provider_que_nao_existe", espera: "/login", param: "error=auth_failed", desc: "provider inválido não quebra" },
];
for (const c of callbacks) {
  const p = await novaPagina();
  await p.goto(`${BASE}/auth/callback${c.q}`, { waitUntil: "domcontentloaded", timeout: 25000 });
  const u = new URL(p.url());
  const okPath = u.pathname === c.espera;
  const okParam = u.search.includes(c.param);
  check(`D:${c.desc}`, `callback ${c.desc} → ${c.espera}?${c.param}`, okPath && okParam, `foi pra ${u.pathname}${u.search}`);
  await p.context().close();
}

// ── E. origem canônica (o conserto do loop de PKCE) ─────────────────────────
{
  const p = await novaPagina();
  await p.goto(`${BASE}/login`, { waitUntil: "networkidle", timeout: 20000 });
  // Teste COMPORTAMENTAL, não de bundle: o que importa é pra onde o navegador
  // vai. Checar o chunk é frágil — o Turbopack carrega sob demanda e o módulo
  // pode não estar em nenhum <script src> do HTML inicial.
  const CANONICA = process.env.QA_SITE_URL ?? "https://host-canonico-de-teste.invalid";
  const navegacoes = [];
  p.on("framenavigated", (f) => { if (f === p.mainFrame()) navegacoes.push(f.url()); });
  // O host canônico de teste não resolve (.invalid), então a navegação falha —
  // mas a TENTATIVA aparece aqui, que é exatamente o que se quer provar.
  p.on("requestfailed", (req) => { if (req.isNavigationRequest()) navegacoes.push(req.url()); });

  await p.getByRole("button", { name: /Entrar com Google/ }).click().catch(() => {});
  await p.waitForTimeout(3000);

  const tentouCanonica = navegacoes.some((u) => u.startsWith(CANONICA));
  const tentouOAuth = navegacoes.some((u) => /accounts\.google|supabase\.co\/auth/.test(u));
  check(
    "E1",
    "em host não-canônico, o clique vai pra origem canônica ANTES do OAuth",
    tentouCanonica,
    `navegações: ${JSON.stringify(navegacoes.slice(-4))}`,
  );
  check(
    "E2",
    "e NÃO inicia o OAuth no host errado (é o que quebrava o PKCE)",
    !tentouOAuth,
    tentouOAuth ? "iniciou OAuth no host errado" : "não iniciou",
  );
  await p.context().close();
}

console.log("\n───────────────────────────────");
const falhas = r.filter((x) => !x.passou);
console.log(`${r.length - falhas.length}/${r.length} passaram`);
if (falhas.length) {
  console.log("\nFALHAS:");
  for (const f of falhas) console.log(`  ${f.id}: ${f.desc} — ${f.obs}`);
}
await browser.close();
process.exit(falhas.length ? 1 : 0);
