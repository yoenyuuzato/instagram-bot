"use client";

import { useActionState, useState } from "react";
import { simulateAction } from "./actions";
import { kindLabels, StatusBadge } from "../ui";

export function SimulateForm({ accounts }: { accounts: { id: number; username: string }[] }) {
  const [state, action, pending] = useActionState(simulateAction, undefined);
  const [type, setType] = useState<"comment" | "dm">("comment");

  if (accounts.length === 0) return <p className="card text-sm text-neutral-600">Nejdřív přidejte účet v sekci Účty.</p>;

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <form action={action} className="card space-y-4 self-start">
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="accountId">
              Účet
            </label>
            <select id="accountId" name="accountId" className="input">
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  @{a.username}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="type">
              Typ události
            </label>
            <select id="type" name="type" className="input" value={type} onChange={(e) => setType(e.target.value as "comment" | "dm")}>
              <option value="comment">Komentář</option>
              <option value="dm">Přímá zpráva (DM)</option>
            </select>
          </div>
        </div>
        <div>
          <label className="label" htmlFor="text">
            Text
          </label>
          <textarea id="text" name="text" rows={3} className="input" required placeholder="Chci ebook!" />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="username">
              Username odesílatele
            </label>
            <input id="username" name="username" className="input" defaultValue="testuser" />
          </div>
          <div>
            <label className="label" htmlFor="senderId">
              IG scoped ID odesílatele
            </label>
            <input id="senderId" name="senderId" className="input font-mono" defaultValue="9000000000000001" />
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          {type === "comment" && (
            <div>
              <label className="label" htmlFor="postId">
                ID příspěvku
              </label>
              <input id="postId" name="postId" className="input font-mono" placeholder="sim_media_1" />
            </div>
          )}
          <div>
            <label className="label" htmlFor="objectId">
              ID {type === "comment" ? "komentáře" : "zprávy"}
            </label>
            <input id="objectId" name="objectId" className="input font-mono" placeholder="náhodné" />
            <p className="hint">Stejné ID 2× = test dedupu.</p>
          </div>
          <div>
            <label className="label" htmlFor="ageHours">
              Stáří (hodiny)
            </label>
            <input id="ageHours" name="ageHours" type="number" min={0} className="input" defaultValue={0} />
            <p className="hint">Test 24h / 7d okna.</p>
          </div>
        </div>
        {state?.error && <p className="text-sm text-red-600">{state.error}</p>}
        <button className="btn" disabled={pending}>
          {pending ? "Zpracovávám…" : "Odeslat simulovaný webhook"}
        </button>
      </form>

      <div className="space-y-4">
        {state?.results?.map((r, i) => (
          <div key={i} className="card space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div className="text-sm font-medium">
                {r.kind === "comment" ? "Komentář" : "DM"} „{r.text}“
              </div>
              <StatusBadge status={r.status} />
            </div>
            {r.reason && <p className="text-sm text-neutral-600">{r.reason}</p>}
            {r.ruleId && (
              <p className="text-sm">
                Pravidlo: <span className="font-medium">{r.ruleName || `#${r.ruleId}`}</span>
              </p>
            )}
            {r.actions.length === 0 && r.status === "processed" && <p className="text-sm text-neutral-500">Pravidlo nemá žádnou akci.</p>}
            {r.actions.map((a, j) => (
              <div key={j} className="rounded-md border border-neutral-200 p-3">
                <div className="mb-1 flex items-center justify-between">
                  <span className="text-sm font-medium">{kindLabels[a.kind]}</span>
                  <StatusBadge status={a.status} />
                </div>
                <p className="text-sm whitespace-pre-wrap">{a.text}</p>
                {a.detail && <p className="hint">{a.detail}</p>}
                {a.request && (
                  <pre className="mt-2 overflow-x-auto rounded bg-neutral-50 p-2 font-mono text-xs">
                    {a.request.method} {a.request.path}
                    {"\n"}
                    {JSON.stringify(a.request.body, null, 2)}
                  </pre>
                )}
              </div>
            ))}
          </div>
        ))}
        {state?.payload && (
          <details className="card">
            <summary className="cursor-pointer text-sm font-medium">Webhook payload</summary>
            {state.signature !== undefined && (
              <p className="hint mt-2 font-mono break-all">
                X-Hub-Signature-256: {state.signature ?? "(META_APP_SECRET není nastaven)"}
                {state.signatureValid !== null && ` — ověření ${state.signatureValid ? "OK" : "SELHALO"}`}
              </p>
            )}
            <pre className="mt-2 overflow-x-auto font-mono text-xs">{JSON.stringify(state.payload, null, 2)}</pre>
          </details>
        )}
      </div>
    </div>
  );
}
