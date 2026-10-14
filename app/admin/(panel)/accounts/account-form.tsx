"use client";

import { useActionState } from "react";
import { createAccountAction } from "../../actions";

export function AccountForm() {
  const [state, action, pending] = useActionState(createAccountAction, undefined);
  return (
    <form action={action} className="card max-w-2xl space-y-4">
      <div>
        <h2 className="font-medium">Přidat účet ručně</h2>
        <p className="hint">Ve fázi 2 se účty budou připojovat přes Instagram Login (OAuth). Teď stačí ID a username pro testování.</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="igUserId">
            IG user ID
          </label>
          <input id="igUserId" name="igUserId" className="input font-mono" required placeholder="17841400000000000" />
        </div>
        <div>
          <label className="label" htmlFor="username">
            Username
          </label>
          <input id="username" name="username" className="input" required placeholder="mujucet" />
        </div>
      </div>
      <div className="grid gap-4 sm:grid-cols-[2fr_1fr]">
        <div>
          <label className="label" htmlFor="accessToken">
            Access token (volitelné)
          </label>
          <input id="accessToken" name="accessToken" type="password" className="input font-mono" autoComplete="off" />
          <p className="hint">Uloží se šifrovaně (AES-256-GCM, klíč TOKEN_ENCRYPTION_KEY).</p>
        </div>
        <div>
          <label className="label" htmlFor="tokenExpiresAt">
            Platnost do
          </label>
          <input id="tokenExpiresAt" name="tokenExpiresAt" type="date" className="input" />
        </div>
      </div>
      {state?.error && <p className="text-sm text-red-600">{state.error}</p>}
      {state?.ok && <p className="text-sm text-green-700">{state.ok}</p>}
      <button className="btn" disabled={pending}>
        {pending ? "Ukládám…" : "Přidat účet"}
      </button>
    </form>
  );
}
