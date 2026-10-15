"use client";

import { useActionState } from "react";
import { saveAccountAiAction } from "../../actions";

type Props = {
  id: number;
  username: string;
  aiEnabled: boolean;
  aiSystemPrompt: string;
  aiFallbackText: string;
};

export function AiSettingsForm({ id, username, aiEnabled, aiSystemPrompt, aiFallbackText }: Props) {
  const [state, action, pending] = useActionState(saveAccountAiAction, undefined);
  return (
    <form action={action} className="card max-w-3xl space-y-4">
      <input type="hidden" name="id" value={id} />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="font-medium">@{username}</h3>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="aiEnabled" defaultChecked={aiEnabled} />
          AI zapnuto
        </label>
      </div>
      <div>
        <label className="label" htmlFor={`aiSystemPrompt-${id}`}>
          System prompt
        </label>
        <textarea id={`aiSystemPrompt-${id}`} name="aiSystemPrompt" rows={14} className="input font-mono text-xs" defaultValue={aiSystemPrompt} />
        <p className="hint">Kdo jsi, co nabízíš, jak odpovídat. Češtinu, čistý text bez markdownu a max. ~600 znaků bot doplní sám.</p>
      </div>
      <div>
        <label className="label" htmlFor={`aiFallbackText-${id}`}>
          Fallback text
        </label>
        <textarea
          id={`aiFallbackText-${id}`}
          name="aiFallbackText"
          rows={2}
          className="input"
          defaultValue={aiFallbackText}
          placeholder="Díky za zprávu! Ozveme se ti co nejdřív. Mezitím mrkni na topprofitdesign.cz"
        />
        <p className="hint">Pošle se, když AI selže (timeout, kvóta, chyba). Prázdné = při chybě se neodpoví nic. Lze použít {"{username}"}.</p>
      </div>
      {state?.error && <p className="text-sm text-red-600">{state.error}</p>}
      {state?.ok && <p className="text-sm text-green-700">{state.ok}</p>}
      <button className="btn" disabled={pending}>
        {pending ? "Ukládám…" : "Uložit AI nastavení"}
      </button>
    </form>
  );
}
