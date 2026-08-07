const GROQ_URL = "https://api.groq.com/openai/v1/audio/transcriptions";
const GROQ_MODEL = "whisper-large-v3";

export interface TranscribeDeps { fetch: typeof fetch; env: (k: string) => string | undefined; }

export function defaultTranscribeDeps(): TranscribeDeps {
  return { fetch, env: (k) => Deno.env.get(k) };
}

export async function transcribeAudio(bytes: Uint8Array, fileName: string, deps: TranscribeDeps = defaultTranscribeDeps(), language = "pt"): Promise<string> {
  const key = deps.env("GROQ_API_KEY");
  if (!key) throw new Error("GROQ_API_KEY nao setada");
  const form = new FormData();
  form.append("file", new Blob([bytes]), fileName);
  form.append("model", GROQ_MODEL);
  form.append("language", language);
  form.append("response_format", "json");
  const res = await deps.fetch(GROQ_URL, { method: "POST", headers: { Authorization: `Bearer ${key}` }, body: form });
  if (!res.ok) throw new Error(`Groq transcribe ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = (await res.json()) as { text?: string };
  return (data.text ?? "").trim();
}
