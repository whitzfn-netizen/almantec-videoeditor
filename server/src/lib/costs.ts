import { db, getSetting, newId, now, setSetting } from "../db.js";

/**
 * Tarifas en USD. Anthropic: precios públicos por millón de tokens (consultados en octubre de 2026).
 * El resto queda como desconocido hasta que el usuario lo introduzca en Configuración.
 */
export interface PriceTable {
  anthropic: Record<string, { input: number; output: number }>;
  elevenlabs: { perThousandChars: number | null };
  updatedAt: string;
}

const DEFAULT_PRICES: PriceTable = {
  anthropic: {
    "claude-opus-5-5": { input: 4, output: 20 },
    "claude-sonnet-5-5": { input: 2, output: 10 },
    "claude-haiku-5-5": { input: 0.1, output: 0.5 },
  },
  elevenlabs: { perThousandChars: null },
  updatedAt: "2026-10-06",
};

export function getPrices(): PriceTable {
  return getSetting<PriceTable>("prices", DEFAULT_PRICES);
}
export function setPrices(p: PriceTable) {
  setSetting("prices", { ...p, updatedAt: now().slice(0, 10) });
}

export function priceFor(provider: "anthropic", model: string): { input: number; output: number } | null {
  return getPrices().anthropic[model] ?? null;
}

export interface Limits {
  /** Gasto máximo estimado por vídeo en USD (0 = sin IA de pago). */
  perVideoUsd: number;
  /** Gasto máximo mensual en USD. */
  monthlyUsd: number;
  /** Si el coste es desconocido, ¿se permite la llamada? */
  allowUnknownCost: boolean;
}

export const getLimits = () => getSetting<Limits>("limits", { perVideoUsd: 0.5, monthlyUsd: 10, allowUnknownCost: false });

export function recordUsage(u: { provider: string; operation: string; units: number; unitType: string; costUsd: number | null; projectId?: string }) {
  db.prepare("INSERT INTO usage (id, at, provider, operation, units, unit_type, cost_usd, project_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(
    newId("use"), now(), u.provider, u.operation, u.units, u.unitType, u.costUsd, u.projectId ?? null,
  );
}

export function monthSpend(): { known: number; unknownCalls: number } {
  const since = new Date();
  since.setUTCDate(1);
  since.setUTCHours(0, 0, 0, 0);
  const r = db.prepare("SELECT COALESCE(SUM(cost_usd),0) AS known, SUM(CASE WHEN cost_usd IS NULL THEN 1 ELSE 0 END) AS unknown FROM usage WHERE at >= ?").get(since.toISOString()) as { known: number; unknown: number | null };
  return { known: r.known, unknownCalls: r.unknown ?? 0 };
}

/** Comprueba los límites antes de una operación de pago. Devuelve el motivo si no se permite. */
export function checkBudget(estimateUsd: number | null, spentThisVideoUsd: number): string | null {
  const l = getLimits();
  if (estimateUsd === null) return l.allowUnknownCost ? null : "El coste de esta operación es desconocido y la configuración no permite operaciones con coste desconocido";
  if (spentThisVideoUsd + estimateUsd > l.perVideoUsd) return `Superaría el límite por vídeo (${l.perVideoUsd.toFixed(2)} USD)`;
  if (monthSpend().known + estimateUsd > l.monthlyUsd) return `Superaría el límite mensual (${l.monthlyUsd.toFixed(2)} USD)`;
  return null;
}
