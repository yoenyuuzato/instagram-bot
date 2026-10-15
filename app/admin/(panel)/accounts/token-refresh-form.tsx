"use client";

import { useActionState } from "react";
import { refreshTokenAction } from "../../actions";

export function TokenRefreshForm({ id }: { id: number }) {
  const [state, action, pending] = useActionState(refreshTokenAction, undefined);
  return (
    <form action={action} className="mt-1">
      <input type="hidden" name="id" value={id} />
      <button className="btn-secondary whitespace-nowrap" disabled={pending}>
        {pending ? "Obnovuji…" : "Obnovit teď"}
      </button>
      {state?.error && <p className="mt-1 max-w-56 text-xs text-red-600">{state.error}</p>}
      {state?.ok && <p className="mt-1 max-w-56 text-xs text-green-700">{state.ok}</p>}
    </form>
  );
}
