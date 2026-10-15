"use client";

import { useActionState } from "react";
import { saveIceBreakersAction } from "../../actions";

const SLOTS = 4;
const SUGGESTIONS = ["Kolik stojí web na míru?", "Jak dlouho trvá tvorba webu?", "Můžu vidět vaše reference?", "Chci mluvit s člověkem"];

export function IceBreakersForm({ id, questions }: { id: number; questions: string[] }) {
  const [state, action, pending] = useActionState(saveIceBreakersAction, undefined);
  return (
    <form action={action} className="space-y-3 border-t border-neutral-200 pt-5">
      <input type="hidden" name="id" value={id} />
      <div>
        <h4 className="text-sm font-medium">Ice breakers (úvodní otázky)</h4>
        <p className="hint">
          Až 4 otázky, které Instagram nabídne v prázdné konverzaci. Klik se zpracuje jako zpráva s textem otázky – zachytí ji
          pravidla, případně AI. Vyžaduje odběr webhooku <code>messaging_postbacks</code>.
        </p>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        {Array.from({ length: SLOTS }, (_, i) => (
          <input
            key={i}
            name="iceBreaker"
            aria-label={`Otázka ${i + 1}`}
            className="input"
            maxLength={80}
            defaultValue={questions[i] ?? ""}
            placeholder={SUGGESTIONS[i]}
          />
        ))}
      </div>
      <div className="flex flex-wrap gap-2">
        <button className="btn-secondary" name="intent" value="save" disabled={pending}>
          Uložit
        </button>
        <button className="btn" name="intent" value="apply" disabled={pending}>
          {pending ? "Pracuji…" : "Uložit a nastavit na Instagramu"}
        </button>
      </div>
      {state?.error && <p className="text-sm text-red-600">{state.error}</p>}
      {state?.ok && <p className="text-sm text-green-700">{state.ok}</p>}
    </form>
  );
}
