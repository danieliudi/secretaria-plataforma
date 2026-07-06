"use client";

import { useState } from "react";

type Provider = "clickup" | "notion" | "trello" | "google_tasks";

const PROVIDER_OPTIONS: Array<{ value: Provider; label: string; hint: string; placeholder: string }> = [
  {
    value: "google_tasks",
    label: "Google Tasks",
    hint: "Grátis e já pronto — reusa o login que você acabou de fazer, sem token extra. Recomendado se você não usa nenhuma das outras plataformas ainda.",
    placeholder: '{"pessoal": "IDdaSuaListaAqui"}',
  },
  {
    value: "clickup",
    label: "ClickUp",
    hint: "Cole seu token pessoal (app.clickup.com/settings/apps) e o mapa de frente → lists.",
    placeholder: '{"resibag": {"Pauta & Reuniões": "901700000000"}}',
  },
  {
    value: "notion",
    label: "Notion",
    hint: "Token de uma integração interna (notion.so/my-integrations) — compartilhe cada database com ela antes.",
    placeholder: '{"resibag": "databaseIdAqui"}',
  },
  {
    value: "trello",
    label: "Trello",
    hint: "Token de acesso pessoal. (A API key do app fica combinada por enquanto — se precisar, fale com quem administra a plataforma.)",
    placeholder: '{"resibag": {"A Fazer": "60a1b2c3d4e5f6"}}',
  },
];

type Step = 1 | 2 | 3;

export default function OnboardingWizard(props: {
  slug: string;
  email: string;
  initialNome: string;
  initialCargo: string;
  initialFrentes: string;
  initialProvider: Provider;
  googleConnected: boolean;
}) {
  const [step, setStep] = useState<Step>(1);
  const [nome, setNome] = useState(props.initialNome);
  const [cargo, setCargo] = useState(props.initialCargo);
  const [frentes, setFrentes] = useState(props.initialFrentes);
  const [provider, setProvider] = useState<Provider>(props.initialProvider);
  const [token, setToken] = useState("");
  const [listMap, setListMap] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [finished, setFinished] = useState(false);

  const providerInfo = PROVIDER_OPTIONS.find((p) => p.value === provider)!;

  async function submitJson(url: string, body: unknown): Promise<boolean> {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? "Algo deu errado — tenta de novo?");
        return false;
      }
      return true;
    } catch {
      setError("Falha de conexão — tenta de novo?");
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function handlePersonaSubmit() {
    const frentesArr = frentes.split(",").map((f) => f.trim()).filter(Boolean);
    const ok = await submitJson("/api/onboarding/persona", { nome, cargo, frentes: frentesArr });
    if (ok) setStep(2);
  }

  async function handleProviderSubmit() {
    const ok = await submitJson("/api/onboarding/task-provider", { provider, token, list_map: listMap });
    if (ok) {
      setStep(3);
      setFinished(true);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col justify-center gap-8 p-8">
      <StepIndicator step={step} />

      {error && (
        <p className="rounded-lg bg-red-50 px-4 py-2 text-sm text-red-700">{error}</p>
      )}

      {step === 1 && (
        <section className="flex flex-col gap-4">
          <h1 className="text-2xl font-semibold">Quem é você?</h1>
          <p className="text-sm text-neutral-500">
            É o que a secretária usa pra falar com você — nome, cargo e as
            frentes/projetos que ela deve acompanhar.
          </p>
          <label className="flex flex-col gap-1 text-sm font-medium">
            Nome
            <input
              className="rounded-lg border px-3 py-2 text-base font-normal"
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              placeholder="Como quer ser chamado"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium">
            Cargo (opcional)
            <input
              className="rounded-lg border px-3 py-2 text-base font-normal"
              value={cargo}
              onChange={(e) => setCargo(e.target.value)}
              placeholder="Ex: sócio, gerente, freelancer…"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium">
            Frentes / projetos (separados por vírgula)
            <input
              className="rounded-lg border px-3 py-2 text-base font-normal"
              value={frentes}
              onChange={(e) => setFrentes(e.target.value)}
              placeholder="Ex: resibag, sanwey, pessoal"
            />
          </label>
          <button
            onClick={handlePersonaSubmit}
            disabled={saving || !nome.trim()}
            className="mt-2 rounded-full bg-black px-6 py-3 font-medium text-white transition hover:bg-neutral-800 disabled:opacity-60"
          >
            {saving ? "Salvando…" : "Continuar"}
          </button>
        </section>
      )}

      {step === 2 && (
        <section className="flex flex-col gap-4">
          <h1 className="text-2xl font-semibold">Onde ficam suas tarefas?</h1>
          <p className="text-sm text-neutral-500">
            Escolha onde a secretária vai ler e criar tarefas pra você.
          </p>
          <div className="flex flex-col gap-2">
            {PROVIDER_OPTIONS.map((opt) => (
              <label
                key={opt.value}
                className={`flex cursor-pointer flex-col gap-1 rounded-lg border px-4 py-3 ${
                  provider === opt.value ? "border-black" : "border-neutral-200"
                }`}
              >
                <span className="flex items-center gap-2 font-medium">
                  <input
                    type="radio"
                    name="provider"
                    checked={provider === opt.value}
                    onChange={() => setProvider(opt.value)}
                  />
                  {opt.label}
                </span>
                <span className="text-xs text-neutral-500">{opt.hint}</span>
              </label>
            ))}
          </div>
          {provider !== "google_tasks" && (
            <label className="flex flex-col gap-1 text-sm font-medium">
              Token de acesso
              <input
                type="password"
                className="rounded-lg border px-3 py-2 text-base font-normal"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder="Cole o token aqui"
              />
            </label>
          )}
          <label className="flex flex-col gap-1 text-sm font-medium">
            Mapa de frentes (JSON)
            <textarea
              className="min-h-24 rounded-lg border px-3 py-2 font-mono text-xs font-normal"
              value={listMap}
              onChange={(e) => setListMap(e.target.value)}
              placeholder={providerInfo.placeholder}
            />
            <span className="text-xs font-normal text-neutral-400">
              Não sabe montar isso ainda? Pode deixar em branco e ajustar depois.
            </span>
          </label>
          <div className="mt-2 flex gap-3">
            <button
              onClick={() => setStep(1)}
              className="rounded-full border px-6 py-3 font-medium transition hover:bg-neutral-50"
            >
              Voltar
            </button>
            <button
              onClick={handleProviderSubmit}
              disabled={saving || (provider !== "google_tasks" && !token.trim())}
              className="flex-1 rounded-full bg-black px-6 py-3 font-medium text-white transition hover:bg-neutral-800 disabled:opacity-60"
            >
              {saving ? "Salvando…" : "Concluir"}
            </button>
          </div>
        </section>
      )}

      {step === 3 && finished && (
        <section className="flex flex-col items-center gap-4 text-center">
          <h1 className="text-2xl font-semibold">Tudo pronto, {nome.split(" ")[0] || ""}! 🎉</h1>
          <p className="max-w-md text-neutral-500">
            Sua secretária já está configurada
            {props.googleConnected ? " com Google conectado" : ""}. O próximo
            passo é conectar seu WhatsApp ou Telegram — isso ainda é feito
            manualmente por quem administra a plataforma; você vai receber
            uma mensagem com as instruções.
          </p>
          <p className="text-xs text-neutral-400">Seu identificador: {props.slug}</p>
        </section>
      )}
    </main>
  );
}

function StepIndicator({ step }: { step: Step }) {
  const labels = ["Você", "Tarefas", "Pronto"];
  return (
    <div className="flex items-center gap-2 text-xs text-neutral-400">
      {labels.map((label, i) => {
        const n = (i + 1) as Step;
        return (
          <span key={label} className={`flex items-center gap-2 ${n === step ? "font-semibold text-black" : ""}`}>
            {i > 0 && <span>—</span>}
            {n}. {label}
          </span>
        );
      })}
    </div>
  );
}
