# Marca — arquivos originais

Pasta pros arquivos de logo originais (não os recriados no mockup de redesign).
Sobe aqui exatamente com estes nomes, que o código já vai procurar por eles:

- `mia-mark.png` — o símbolo sozinho (círculo escuro com o monograma).
- `mia-wordmark.png` — o lockup horizontal (símbolo + "MIA" + tagline).

Prefira PNG com fundo transparente se tiver — funciona melhor em qualquer
fundo (claro, escuro, dentro do círculo). Se só tiver a versão com fundo
sólido mesmo, sobe assim que já resolve.

Depois de subir, é só avisar que a integração no favicon/header é o próximo passo.

## Derivados de exibição — não edite à mão

O código NÃO aponta pros originais acima. Ele usa versões geradas no tamanho
que aparece na tela:

- `mia-mark-64.png` (96x64) — usado no header e no rodapé do site.
- `mia-mark-tight-120.png` (135x120) — usado no lockup da área logada.

Por quê: até 01/09/2026 o header servia o original de 1536x1024 (**954 KB**)
pra desenhar um símbolo de **17 pixels** de altura, em toda página pública e no
/login. Os derivados são gerados a 3x o maior uso na tela, então o resultado é
idêntico inclusive em retina — muda só o peso (954 KB -> 5 KB).

Se trocar um original, gere o derivado de novo (qualquer redimensionamento
LANCZOS serve; mantenha RGBA pra não perder a transparência) e mantenha o
mesmo nome de arquivo.
