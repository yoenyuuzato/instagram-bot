"use client";

import { useActionState } from "react";
import { saveHumanPauseAction } from "../../actions";

export function HumanPauseForm({ id, minutes }: { id: number; minutes: number }) {
  const [state, action, pending] = useActionState(saveHumanPauseAction, undefined);
  return (
    <form action={action} className="space-y-3 border-t border-neutral-200 pt-5">
      <input type="hidden" name="id" value={id} />
      <div>
        <label className="text-sm font-medium" htmlFor={`humanPauseMinutes-${id}`}>
          Ruční převzetí konverzace
        </label>
        <p className="hint">
          Když v DM odpovíte ručně (z aplikace Instagram nebo Meta Business Suite), bot u tohoto kontaktu na zadanou dobu
          přestane odpovídat. Ve zprávě můžete napsat <code>#bot</code> (bot hned znovu odpovídá) nebo <code>#stop</code>{" "}
          (pauza natrvalo). Upozornění na leady chodí dál. 0 = ruční odpověď bota nepozastaví.
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <input
          id={`humanPauseMinutes-${id}`}
          name="humanPauseMinutes"
          type="number"
          min={0}
          step={1}
          className="input w-28"
          defaultValue={minutes}
        />
        <span className="text-sm text-neutral-500">minut</span>
        <button className="btn whitespace-nowrap" disabled={pending}>
          {pending ? "Ukládám…" : "Uložit"}
        </button>
      </div>
      {state?.error && <p className="text-sm text-red-600">{state.error}</p>}
      {state?.ok && <p className="text-sm text-green-700">{state.ok}</p>}
    </form>
  );
}
