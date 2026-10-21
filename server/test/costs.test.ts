import "./setup.js";
import assert from "node:assert/strict";
import { test } from "node:test";
import { setSetting } from "../src/db.js";
import { checkBudget, recordUsage } from "../src/lib/costs.js";

test("bloquea operaciones que superarían los límites o tienen coste desconocido", () => {
  setSetting("limits", { perVideoUsd: 0.2, monthlyUsd: 1, allowUnknownCost: false });
  assert.equal(checkBudget(0.05, 0), null);
  assert.match(checkBudget(0.05, 0.18)!, /límite por vídeo/);
  assert.match(checkBudget(null, 0)!, /desconocido/);
  recordUsage({ provider: "anthropic", operation: "prueba", units: 1, unitType: "tokens", costUsd: 0.98 });
  assert.match(checkBudget(0.05, 0)!, /límite mensual/);
});
