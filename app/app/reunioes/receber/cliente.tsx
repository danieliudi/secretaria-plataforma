"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { BUCKET_REUNIOES, extensaoDoTipo, tipoLimpo, tipoPorExtensao } from "@/lib/reunioes";

// Precisa bater com o sw.js.
const CACHE_COMPARTILHADO = "mia-compartilhado-v1";
const CHAVE_AUDIO = "/__compartilhado/audio";

type Etapa = "lendo" | "enviando" | "pronto" | "vazio" | "erro";

function formataTamanho(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  return mb >= 1 ? `${mb.toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

export function ReceberReuniao() {
  const [etapa, setEtapa] = useState<Etapa>("lendo");
  const [erro, setErro] = useState<string>("");
  const [nome, setNome] = useState<string>("");
  const [tamanho, setTamanho] = useState<number>(0);

  // Guarda contra o efeito rodar duas vezes (StrictMode em dev, ou re-render):
  // sem isto, o mesmo áudio viraria duas reuniões e duas cobranças.
  const jaRodou = useRef(false);

  const processar = useCallback(async () => {
    if (!("caches" in window)) {
      setEtapa("vazio");
      return;
    }

    const cache = await caches.open(CACHE_COMPARTILHADO);
    const guardado = await cache.match(CHAVE_AUDIO);
    if (!guardado) {
      setEtapa("vazio");
      return;
    }

    // Consome já: se algo abaixo falhar, a pessoa compartilha de novo em vez
    // de a página reprocessar um arquivo velho na próxima visita.
    await cache.delete(CHAVE_AUDIO);

    let nomeArquivo = "gravacao";
    const cabecalho = guardado.headers.get("X-Mia-Nome");
    if (cabecalho) {
      try {
        nomeArquivo = decodeURIComponent(cabecalho);
      } catch {
        /* nome estranho: fica o default */
      }
    }

    const blob = await guardado.blob();
    // O tipo vem do que o sistema informou. Quando ele manda
    // "application/octet-stream" (acontece em alguns gravadores de Android),
    // cai pra dedução pela extensão do nome — que só serve pra ESCOLHER um
    // tipo conhecido, nunca pra montar caminho.
    // `tipoLimpo` é obrigatório aqui: o Storage compara o content-type com a
    // lista do bucket de forma EXATA, e um 'audio/mp4; codecs="..."' seria
    // recusado mesmo sendo um tipo que aceitamos.
    const tipo = extensaoDoTipo(blob.type)
      ? tipoLimpo(blob.type)
      : (tipoPorExtensao(nomeArquivo) ?? tipoLimpo(blob.type));

    setNome(nomeArquivo);
    setTamanho(blob.size);
    setEtapa("enviando");

    const registrar = await fetch("/api/reunioes/registrar", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nome: nomeArquivo, tipo, bytes: blob.size }),
    });
    const dadosRegistro = await registrar.json().catch(() => ({}));
    if (!registrar.ok) {
      throw new Error(dadosRegistro?.error ?? "Não consegui registrar essa gravação.");
    }

    const { id, path } = dadosRegistro as { id: string; path: string };

    // Upload direto pro Storage. A policy do bucket só aceita a pasta do
    // próprio tenant, e o caminho veio pronto do servidor.
    const supabase = createClient();
    const { error: upErr } = await supabase.storage
      .from(BUCKET_REUNIOES)
      .upload(path, blob, { contentType: tipo, upsert: false });
    if (upErr) {
      // O MOTIVO REAL vai pra tela. A primeira versão disto trocava qualquer
      // falha por "falhou no meio do caminho", e no primeiro teste de verdade
      // essa frase escondeu um estouro de tamanho — quem estava testando não
      // tinha como saber o que fazer. Mensagem amigável só quando dá pra
      // reconhecer a causa; fora isso, o texto do Storage cru.
      const bruto = upErr.message ?? "";
      const tamanho = /exceed|maximum allowed size|too large|payload/i.test(bruto);
      throw new Error(
        tamanho
          ? `Essa gravação (${formataTamanho(blob.size)}) passou do limite de upload do servidor.`
          : `O envio do áudio falhou: ${bruto || "motivo não informado pelo servidor"}`,
      );
    }

    const fechar = await fetch("/api/reunioes/enviado", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    if (!fechar.ok) {
      const dados = await fechar.json().catch(() => ({}));
      throw new Error(dados?.error ?? "O áudio subiu, mas não consegui colocar na fila.");
    }

    setEtapa("pronto");
  }, []);

  useEffect(() => {
    if (jaRodou.current) return;
    jaRodou.current = true;
    processar().catch((e: unknown) => {
      setErro(e instanceof Error ? e.message : "Deu alguma coisa errada.");
      setEtapa("erro");
    });
  }, [processar]);

  return (
    <div className="rounded-2xl border border-aurora-line bg-aurora-surface p-6 shadow-[var(--aurora-shadow)]">
      {etapa === "lendo" && (
        <Estado titulo="Pegando a gravação…" descricao="Só um instante." pulsando />
      )}

      {etapa === "enviando" && (
        <Estado
          titulo="Recebendo a gravação"
          descricao={`${nome}${tamanho ? ` · ${formataTamanho(tamanho)}` : ""}`}
          pulsando
        />
      )}

      {etapa === "pronto" && (
        <>
          <Estado
            titulo="Recebi. Já vou escutar."
            descricao="Vou transcrever, separar quem falou o quê e te mandar a ata no WhatsApp quando terminar. Costuma levar alguns minutos."
          />
          <div className="mt-5 flex flex-wrap gap-2">
            <Link
              href="/app/reunioes"
              className="rounded-full bg-aurora-accent px-4 py-2 text-[13px] font-semibold text-aurora-accent-ink transition hover:brightness-105"
            >
              Ver minhas reuniões
            </Link>
            <Link
              href="/app"
              className="rounded-full border border-aurora-line px-4 py-2 text-[13px] font-semibold text-aurora-muted-2 transition hover:bg-aurora-surface-2"
            >
              Voltar
            </Link>
          </div>
        </>
      )}

      {etapa === "vazio" && (
        <>
          <Estado
            titulo="Não veio nenhuma gravação"
            descricao="Esta tela é o destino do “Compartilhar com…” do celular. Grave a reunião no gravador do aparelho, toque em compartilhar e escolha a Mia."
          />
          <Link
            href="/app/reunioes"
            className="mt-5 inline-block rounded-full border border-aurora-line px-4 py-2 text-[13px] font-semibold text-aurora-muted-2 transition hover:bg-aurora-surface-2"
          >
            Ver minhas reuniões
          </Link>
        </>
      )}

      {etapa === "erro" && (
        <>
          <Estado titulo="Não consegui receber" descricao={erro} tom="crit" />
          <Link
            href="/app"
            className="mt-5 inline-block rounded-full border border-aurora-line px-4 py-2 text-[13px] font-semibold text-aurora-muted-2 transition hover:bg-aurora-surface-2"
          >
            Voltar
          </Link>
        </>
      )}
    </div>
  );
}

function Estado({
  titulo,
  descricao,
  pulsando,
  tom,
}: {
  titulo: string;
  descricao: string;
  pulsando?: boolean;
  tom?: "crit";
}) {
  return (
    <div className="flex gap-3.5">
      <span
        aria-hidden="true"
        className={`mt-1 h-2.5 w-2.5 flex-none rounded-full ${
          tom === "crit" ? "bg-aurora-crit" : "bg-aurora-accent"
        } ${pulsando ? "animate-pulse" : ""}`}
      />
      <div>
        <h1 className="text-[17px] font-bold tracking-tight text-aurora-fg">{titulo}</h1>
        <p className="mt-1.5 text-[13.5px] leading-relaxed text-aurora-muted">{descricao}</p>
      </div>
    </div>
  );
}
