"use client";

import { useActionState } from "react";
import { loginAction } from "../actions";

export function LoginForm({ next }: { next: string }) {
  const [state, action, pending] = useActionState(loginAction, undefined);
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="next" value={next} />
      <div>
        <label className="label" htmlFor="password">
          Heslo
        </label>
        <input id="password" name="password" type="password" className="input" autoFocus required />
      </div>
      {state?.error && <p className="text-sm text-red-600">{state.error}</p>}
      <button className="btn w-full" disabled={pending}>
        {pending ? "Přihlašuji…" : "Přihlásit"}
      </button>
    </form>
  );
}
