"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

// Lista dos fatos automáticos, com os dois caminhos de saída: apagar, ou virar
// instrução. "Virar instrução" é só navegação com o texto pré-preenchido — não
// existe conversão automática de propósito: o valor da instrução está em você
// escrever o que fazer com o fato, não em copiar o fato pra outra tabela.

interface FatoVisivel {
  category: string;
  key: string;
  value: string;
  rotulo: { texto: string; classe: string };
}

export function FatosDoPerfil({ fatos }: { fatos: FatoVisivel[] }) {
  const router = useRouter();
  const [apagando, setApagando] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [apagados, setApagados] = useState<Set<string>>(new Set());

  async function apagar(key: string) {
    setErro(null);
    setApagando(key);
    try {
      const res = await fetch("/api/instrucoes/fato", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key }),
      });
      if (!res.ok) {
        const { error } = await res.json().catch(() => ({ error: null }));
        throw new Error(error ?? "não deu pra apagar");
      }
      setApagados((atual) => new Set(atual).add(key));
      router.refresh();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "não deu pra apagar");
    } finally {
      setApagando(null);
    }
  }

  const visiveis = fatos.filter((f) => !apagados.has(f.key));

  return (
    <>
      {erro && (
        <p className="mt-4 rounded-lg border border-aurora-crit/30 bg-aurora-crit/5 px-3 py-2 text-[12.5px] text-aurora-crit">
          {erro}
        </p>
      )}
      <ul className="mt-1 flex flex-col">
        {visiveis.map((f) => (
          <li
            key={f.key}
            className="flex flex-wrap items-start gap-x-3 gap-y-2 border-b border-aurora-line-soft py-3 last:border-none"
          >
            <span
              className={`mt-[3px] flex-none rounded-full px-2 py-0.5 font-mono text-[9.5px] font-bold uppercase tracking-wide ${f.rotulo.classe}`}
            >
              {f.rotulo.texto}
            </span>
            <span className="min-w-[200px] flex-1 text-[13.5px] leading-relaxed text-aurora-muted-2">
              {f.value}
            </span>
            <span className="flex flex-none items-center gap-3 text-[12px]">
              <button
                type="button"
                onClick={() => apagar(f.key)}
                disabled={apagando === f.key}
                className="text-aurora-muted transition hover:text-aurora-crit disabled:opacity-50"
              >
                {apagando === f.key ? "apagando…" : "apagar"}
              </button>
              <a
                href={`/app/memoria/nova?de=${encodeURIComponent(f.value)}`}
                className="font-semibold text-aurora-accent-text transition hover:opacity-80"
              >
                virar instrução
              </a>
            </span>
          </li>
        ))}
      </ul>
    </>
  );
}
