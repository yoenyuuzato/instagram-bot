"use client";

import { useActionState } from "react";
import { saveNotifyEmailAction } from "../../actions";

export function NotifyForm({ id, notifyEmail }: { id: number; notifyEmail: string }) {
  const [state, action, pending] = useActionState(saveNotifyEmailAction, undefined);
  return (
    <form action={action} className="space-y-3 border-t border-neutral-200 pt-5">
      <input type="hidden" name="id" value={id} />
      <div>
        <label className="text-sm font-medium" htmlFor={`notifyEmail-${id}`}>
          E-mail pro upozornění
        </label>
        <p className="hint">
          Když někdo v DM pošle e-mail nebo telefon (CZ/SK), přijde sem upozornění s celou zprávou a posledními 6 zprávami
          konverzace. Na stejný kontakt a údaj max. 1×. Prázdné = vypnuto.
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        <input
          id={`notifyEmail-${id}`}
          name="notifyEmail"
          type="email"
          className="input min-w-0 flex-1"
          defaultValue={notifyEmail}
          placeholder="obchod@topprofitdesign.cz"
        />
        <button className="btn whitespace-nowrap" name="intent" value="save" disabled={pending}>
          Uložit
        </button>
        <button className="btn-secondary whitespace-nowrap" name="intent" value="test" disabled={pending}>
          {pending ? "Pracuji…" : "Poslat testovací e-mail"}
        </button>
      </div>
      {state?.error && <p className="text-sm text-red-600">{state.error}</p>}
      {state?.ok && <p className="text-sm text-green-700">{state.ok}</p>}
    </form>
  );
}
