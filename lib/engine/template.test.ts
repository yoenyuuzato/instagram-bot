import { test } from "node:test";
import assert from "node:assert/strict";
import { fillTemplate } from "./template";

test("{username} – dosazení", () => {
  assert.equal(fillTemplate("Ahoj {username}! 👋", { username: "jana" }), "Ahoj jana! 👋");
  assert.equal(fillTemplate("Ahoj @{username}!", { username: "jana" }), "Ahoj @jana!");
  assert.equal(fillTemplate("Ahoj {jmeno}", { username: "x" }), "Ahoj {jmeno}");
});

test("{username} prázdné – úklid mezer před interpunkcí", () => {
  assert.equal(fillTemplate("Ahoj {username}! 👋", { username: "" }), "Ahoj! 👋");
  assert.equal(fillTemplate("Ahoj @{username} , díky!", { username: " " }), "Ahoj, díky!");
  assert.equal(fillTemplate("{username}, posílám odkaz.\nMěj se {username} :)", { username: "" }), "posílám odkaz.\nMěj se:)");
  assert.equal(fillTemplate("Díky  {username}  za zprávu .", { username: "" }), "Díky za zprávu.");
});

test("bez prázdné proměnné text neupravujeme", () => {
  assert.equal(fillTemplate("Cena : dle nabídky", {}), "Cena : dle nabídky");
});
