// Service worker de PROPÓSITO ÚNICO: receber o áudio que o Android manda pelo
// "Compartilhar com...". Nada mais.
//
// POR QUE ELE PRECISA EXISTIR: o share_target do manifest faz o sistema
// operacional mandar um POST multipart com o ARQUIVO pra /app/reunioes/receber.
// Se esse POST fosse direto pro servidor, morreria: função da Netlify aceita
// no máximo 6 MB de corpo, e uma hora de gravação de celular dá 30-60 MB.
// Aqui o POST é interceptado ANTES de sair do aparelho, o arquivo é guardado
// no cache local, e a página que abre em seguida sobe ele direto pro Supabase
// Storage — que aguenta o tamanho e nunca passa pelo nosso servidor.
//
// POR QUE ELE NÃO FAZ CACHE DE ASSET: um service worker que guarda JS/CSS num
// app Next.js serve chunk velho depois de um deploy e quebra a navegação de um
// jeito que a pessoa não consegue consertar (nem recarregar resolve). Este
// arquivo devolve `return` pra TODA requisição que não seja o POST do
// compartilhamento — não há um único caminho aqui que responda por um asset.

const CACHE_COMPARTILHADO = "mia-compartilhado-v1";
const CHAVE_AUDIO = "/__compartilhado/audio";
const ROTA_RECEBER = "/app/reunioes/receber";

// Assume o controle na primeira visita, sem esperar a aba ser fechada e
// reaberta: sem isto, quem instala o app e tenta compartilhar em seguida cai
// no POST direto pro servidor (que falha por tamanho) na primeira vez.
self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      // Limpa versões antigas do cache de compartilhamento — não toca em
      // nenhum outro cache, que não é nosso.
      const nomes = await caches.keys();
      await Promise.all(
        nomes
          .filter((n) => n.startsWith("mia-compartilhado-") && n !== CACHE_COMPARTILHADO)
          .map((n) => caches.delete(n)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "POST") return;

  let url;
  try {
    url = new URL(req.url);
  } catch {
    return;
  }
  // Mesma origem e exatamente a rota do share_target. Qualquer outro POST do
  // app (as rotas de /api, o login) passa direto, sem o SW encostar.
  if (url.origin !== self.location.origin || url.pathname !== ROTA_RECEBER) return;

  event.respondWith(
    (async () => {
      try {
        const form = await req.formData();
        const arquivo = form.get("audio");

        if (arquivo && typeof arquivo === "object" && "type" in arquivo) {
          const cache = await caches.open(CACHE_COMPARTILHADO);
          // Guarda o arquivo como um Response. O nome original vai num header
          // próprio (percent-encoded: nome de arquivo aceita acento e header
          // HTTP não) só pra virar o título da reunião — não é usado pra
          // montar caminho nenhum no Storage.
          await cache.put(
            CHAVE_AUDIO,
            new Response(arquivo, {
              headers: {
                "Content-Type": arquivo.type || "application/octet-stream",
                "X-Mia-Nome": encodeURIComponent(String(arquivo.name || "gravacao")),
              },
            }),
          );
        }

        // 303 pra o navegador trocar o POST por um GET na navegação seguinte.
        return Response.redirect(`${ROTA_RECEBER}?compartilhado=1`, 303);
      } catch {
        // Falhou guardar (cota, arquivo corrompido): manda pra mesma tela sem
        // a marca, e ela mostra o estado de "não recebi nada" em vez de ficar
        // girando pra sempre.
        return Response.redirect(`${ROTA_RECEBER}?erro=1`, 303);
      }
    })(),
  );
});
