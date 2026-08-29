"use client";

import { useEffect } from "react";

// Registra o service worker de /public/sw.js. Ele existe por UM motivo só:
// receber o áudio que o Android manda pelo "Compartilhar com..." (ver os
// comentários no próprio sw.js). Não faz cache de nada.
//
// Fica no layout raiz, e não só na área logada, porque é o navegador que
// decide quando oferecer "instalar app" — e ele precisa ter visto o manifest
// e o service worker antes. Quem chega pela landing e instala dali já sai com
// o compartilhamento funcionando.
export function RegistraServiceWorker() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    // Falha em silêncio de propósito: navegador sem suporte, aba anônima com
    // storage bloqueado ou http local não podem virar erro na tela de quem só
    // queria ver o site.
    navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {});
  }, []);

  return null;
}
