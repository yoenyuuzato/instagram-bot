"use client";

import { useActionState, useState } from "react";
import type { Rule } from "@/lib/db/schema";
import { saveRuleAction } from "../../actions";

type AccountOption = { id: number; username: string };

export function RuleForm({ rule, accounts }: { rule?: Rule; accounts: AccountOption[] }) {
  const [state, action, pending] = useActionState(saveRuleAction, undefined);
  const [trigger, setTrigger] = useState<"comment" | "dm">(rule?.triggerType ?? "comment");
  const [buttonUrl, setButtonUrl] = useState(rule?.dmButtonUrl ?? "");
  const [shortOnly, setShortOnly] = useState(rule?.maxWords != null);

  if (accounts.length === 0) {
    return <p className="card text-sm text-neutral-600">Nejdřív přidejte účet v sekci Účty.</p>;
  }

  return (
    <form action={action} className="card max-w-2xl space-y-5">
      {rule && <input type="hidden" name="id" value={rule.id} />}

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="name">
            Název
          </label>
          <input id="name" name="name" className="input" defaultValue={rule?.name} placeholder="např. Ebook zdarma" />
        </div>
        <div>
          <label className="label" htmlFor="accountId">
            Účet
          </label>
          <select id="accountId" name="accountId" className="input" defaultValue={rule?.accountId ?? accounts[0].id}>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                @{a.username}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="triggerType">
            Spouštěč
          </label>
          <select
            id="triggerType"
            name="triggerType"
            className="input"
            value={trigger}
            onChange={(e) => setTrigger(e.target.value as "comment" | "dm")}
          >
            <option value="comment">Komentář pod příspěvkem</option>
            <option value="dm">Přímá zpráva (DM)</option>
          </select>
        </div>
        <div>
          <label className="label" htmlFor="matchMode">
            Shoda
          </label>
          <select id="matchMode" name="matchMode" className="input" defaultValue={rule?.matchMode ?? "contains"}>
            <option value="contains">Text obsahuje klíčové slovo</option>
            <option value="exact">Text je přesně klíčové slovo</option>
          </select>
        </div>
      </div>

      <div>
        <label className="label" htmlFor="keywords">
          Klíčová slova
        </label>
        <input id="keywords" name="keywords" className="input" defaultValue={rule?.keywords.join(", ")} placeholder="chci, info, cena" />
        <p className="hint">Oddělte čárkou. Velikost písmen a diakritika se ignorují. Prázdné = reaguje na cokoliv.</p>
      </div>

      <div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="shortOnly" checked={shortOnly} onChange={(e) => setShortOnly(e.target.checked)} />
            Jen krátká zpráva – max.
          </label>
          <input
            name="maxWords"
            type="number"
            min={1}
            max={50}
            aria-label="Maximální počet slov"
            className="input w-20"
            defaultValue={rule?.maxWords ?? 3}
            disabled={!shortOnly}
          />
          <span className="text-sm">slov</span>
        </div>
        <p className="hint">
          Delší text pravidlo přeskočí – např. „cena“ zachytí, ale „kolik by stál e-shop s napojením na sklad?“ nechá
          {trigger === "dm" ? " na AI odpověď (pokud je u účtu zapnutá)." : " bez odpovědi."}
        </p>
      </div>

      {trigger === "comment" && (
        <>
          <div>
            <label className="label" htmlFor="postId">
              ID příspěvku (volitelné)
            </label>
            <input id="postId" name="postId" className="input font-mono" defaultValue={rule?.postId ?? ""} />
            <p className="hint">Pokud vyplníte, pravidlo platí jen pro komentáře pod tímto příspěvkem (media id).</p>
          </div>
          <div>
            <label className="label" htmlFor="publicReply">
              Veřejná odpověď pod komentář
            </label>
            <textarea id="publicReply" name="publicReply" rows={2} className="input" defaultValue={rule?.publicReply ?? ""} placeholder="Poslali jsme ti to do zpráv 📩" />
          </div>
        </>
      )}

      <div>
        <label className="label" htmlFor="dmText">
          {trigger === "comment" ? "Soukromá zpráva (private reply)" : "Odpověď do DM"}
        </label>
        <textarea id="dmText" name="dmText" rows={4} className="input" defaultValue={rule?.dmText ?? ""} placeholder="Ahoj {username}, tady je slíbený odkaz…" />
        <p className="hint">
          Proměnná <code>{"{username}"}</code> se nahradí jménem uživatele.{" "}
          {trigger === "comment" ? "Private reply jde poslat 1× na komentář do 7 dní." : "DM se odešle jen v 24h okně od zprávy uživatele."}
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-[2fr_1fr]">
        <div>
          <label className="label" htmlFor="dmButtonUrl">
            URL tlačítka v DM (volitelné)
          </label>
          <input id="dmButtonUrl" name="dmButtonUrl" type="url" className="input" value={buttonUrl} onChange={(e) => setButtonUrl(e.target.value)} placeholder="https://…" />
        </div>
        <div>
          <label className="label" htmlFor="dmButtonTitle">
            Text tlačítka
          </label>
          <input id="dmButtonTitle" name="dmButtonTitle" maxLength={20} className="input" defaultValue={rule?.dmButtonTitle ?? ""} placeholder="Otevřít" disabled={!buttonUrl} />
        </div>
      </div>

      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="active" defaultChecked={rule?.active ?? true} />
        Pravidlo je aktivní
      </label>

      {state?.error && <p className="text-sm text-red-600">{state.error}</p>}

      <div className="flex gap-2">
        <button className="btn" disabled={pending}>
          {pending ? "Ukládám…" : "Uložit"}
        </button>
      </div>
    </form>
  );
}
