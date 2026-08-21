-- Toggle do wizard: "sempre responder em áudio", independente do formato da
-- mensagem recebida. Complementa o espelhamento (responde em áudio quando a
-- pessoa manda áudio) — ver _shared/tts.ts e o campo `kind` que o webhook
-- passa a receber de cada canal.
ALTER TABLE public.tenants
  ADD COLUMN resposta_audio_sempre boolean NOT NULL DEFAULT false;
