#!/usr/bin/env node
// Confere se as contagens escritas em docs/mapa.md ainda batem com o código.
//
// POR QUE EXISTE: mapa que apodrece é pior que mapa nenhum — um inventário
// errado dá confiança falsa, e a sessão que confia nele decide errado sem
// perceber. Este script recalcula do código e aponta a divergência.
//
// FORA DO `build` DE PROPÓSITO. Documento defasado não deve travar deploy: o
// risco de um deploy urgente ser barrado por contagem de documentação é maior
// que o de o mapa ficar um dia desatualizado. Rode à mão, ou numa auditoria.
//
// O mapa declara os números num bloco de comentário HTML:
//   <!-- doc:check
//   edge_functions=7
//   ...
//   -->

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const MAPA = "docs/mapa.md";

/** Conta arquivos que casam com `filtro` em toda a árvore a partir de `raiz`. */
function contaArquivos(raiz, filtro) {
  let total = 0;
  const pilha = [raiz];
  while (pilha.length > 0) {
    const dir = pilha.pop();
    let itens;
    try {
      itens = readdirSync(dir);
    } catch {
      continue; // pasta que não existe conta zero, não quebra o script
    }
    for (const nome of itens) {
      if (nome === "node_modules" || nome === ".next" || nome.startsWith(".")) continue;
      const caminho = join(dir, nome);
      if (statSync(caminho).isDirectory()) pilha.push(caminho);
      else if (filtro(nome, caminho)) total++;
    }
  }
  return total;
}

/** Subpastas diretas de supabase/functions que são função de verdade. */
function contaEdgeFunctions() {
  return readdirSync("supabase/functions", { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith("_"))
    .length;
}

const real = {
  edge_functions: contaEdgeFunctions(),
  paginas: contaArquivos("app", (n) => n === "page.tsx"),
  rotas_api: contaArquivos("app/api", (n) => n === "route.ts"),
  migrations: contaArquivos("supabase/migrations", (n) => n.endsWith(".sql")),
  testes: contaArquivos("supabase/functions/_tests", (n) => n.endsWith(".test.ts")),
};

const texto = readFileSync(MAPA, "utf8");
const bloco = texto.match(/<!--\s*doc:check\s*([\s\S]*?)-->/);
if (!bloco) {
  console.error(`${MAPA}: bloco "<!-- doc:check ... -->" não encontrado.`);
  process.exit(1);
}

const declarado = Object.fromEntries(
  bloco[1]
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.includes("="))
    .map((l) => {
      const [k, v] = l.split("=");
      return [k.trim(), Number(v.trim())];
    }),
);

const divergencias = [];
for (const [chave, valorReal] of Object.entries(real)) {
  if (!(chave in declarado)) {
    divergencias.push(`  ${chave}: não declarado no mapa (real: ${valorReal})`);
  } else if (declarado[chave] !== valorReal) {
    divergencias.push(`  ${chave}: mapa diz ${declarado[chave]}, código tem ${valorReal}`);
  }
}
for (const chave of Object.keys(declarado)) {
  if (!(chave in real)) divergencias.push(`  ${chave}: declarado no mapa, mas o script não sabe contar`);
}

if (divergencias.length > 0) {
  console.error(`${MAPA} está defasado:\n${divergencias.join("\n")}\n`);
  console.error("Atualize o mapa (texto E bloco doc:check) e rode de novo.");
  process.exit(1);
}

const resumo = Object.entries(real).map(([k, v]) => `${k}=${v}`).join("  ");
console.log(`${MAPA} confere:  ${resumo}`);
