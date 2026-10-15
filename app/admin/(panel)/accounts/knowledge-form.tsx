"use client";

import { useActionState } from "react";
import { crawlKnowledgeAction } from "../../actions";

type Props = { id: number; url: string; updatedAt: string | null; chars: number; preview: string };

export function KnowledgeForm({ id, url, updatedAt, chars, preview }: Props) {
  const [state, action, pending] = useActionState(crawlKnowledgeAction, undefined);
  return (
    <form action={action} className="space-y-3 border-t border-neutral-200 pt-5">
      <input type="hidden" name="id" value={id} />
      <div>
        <h4 className="text-sm font-medium">Znalostní báze z webu</h4>
        <p className="hint">
          Stáhne až 30 stránek (sitemap.xml, jinak odkazy z homepage, respektuje robots.txt), max. ~60 000 znaků. AI pak odpovídá
          jen z těchto znalostí a promptu.
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        <input
          name="knowledgeUrl"
          type="url"
          aria-label="URL webu"
          className="input min-w-0 flex-1"
          defaultValue={url}
          required
          placeholder="https://topprofitdesign.cz"
        />
        <button className="btn whitespace-nowrap" disabled={pending}>
          {pending ? "Načítám web… (až 1 min)" : updatedAt ? "Obnovit web" : "Načíst web"}
        </button>
      </div>
      {state?.error && <p className="text-sm text-red-600">{state.error}</p>}
      {state?.ok && <p className="text-sm text-green-700">{state.ok}</p>}
      {updatedAt ? (
        <div className="space-y-2">
          <p className="text-sm text-neutral-600">
            Aktualizováno {updatedAt} · {chars.toLocaleString("cs-CZ")} znaků
          </p>
          <pre className="max-h-48 overflow-y-auto rounded bg-neutral-50 p-2 font-mono text-xs whitespace-pre-wrap">
            {preview}
            {chars > preview.length && "…"}
          </pre>
        </div>
      ) : (
        <p className="text-sm text-neutral-500">Zatím nenačteno.</p>
      )}
    </form>
  );
}
