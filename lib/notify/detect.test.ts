import { test } from "node:test";
import assert from "node:assert/strict";
import { detectContacts, formatPhone } from "./detect";

const values = (t: string) => detectContacts(t).map((h) => h.value);

test("e-mail", () => {
  assert.deepEqual(values("Napiš mi na Jan.Novak+web@Firma.cz."), ["jan.novak+web@firma.cz"]);
  assert.deepEqual(values("pepa@seznam.cz, nebo info@topprofit-design.com"), ["pepa@seznam.cz", "info@topprofit-design.com"]);
  assert.deepEqual(values("@topprofitdesign nebo mail@localhost"), []);
});

test("telefon CZ/SK – formáty", () => {
  assert.deepEqual(values("volej 777 123 456"), ["+420777123456"]);
  assert.deepEqual(values("+420 777 123 456"), ["+420777123456"]);
  assert.deepEqual(values("+420777123456"), ["+420777123456"]);
  assert.deepEqual(values("00420 777-123-456"), ["+420777123456"]);
  assert.deepEqual(values("tel: 777-12-34-56"), ["+420777123456"]);
  assert.deepEqual(values("SK: +421 905 123 456"), ["+421905123456"]);
  assert.deepEqual(values("0905 123 456"), ["+421905123456"]);
  assert.deepEqual(values("00421905123456"), ["+421905123456"]);
});

test("telefon – co se chytit nemá", () => {
  assert.deepEqual(values("web od 25 000 Kč"), []);
  assert.deepEqual(values("IČO 12345678"), []);
  assert.deepEqual(values("číslo účtu 1234567890123"), []);
  assert.deepEqual(values("+44 7700 900123"), []);
  assert.deepEqual(values("2026-10-15"), []);
});

test("e-mail i telefon v jedné zprávě, bez duplicit", () => {
  const hits = detectContacts("Jsem jana@email.cz, tel. 602 111 222 – nebo +420602111222");
  assert.deepEqual(
    hits.map((h) => [h.type, h.value]),
    [
      ["email", "jana@email.cz"],
      ["phone", "+420602111222"],
    ],
  );
  assert.equal(formatPhone("+420602111222"), "+420 602 111 222");
});
