import { db, now } from "./db.js";
import { runJob } from "./pipeline/runner.js";

let running = false;
let stopped = false;

/** Toma el siguiente trabajo en cola de forma atómica (válido con varios procesos sobre la misma base de datos). */
function claimNext(): string | null {
  db.exec("BEGIN IMMEDIATE");
  try {
    const row = db.prepare("SELECT id FROM jobs WHERE status = 'queued' ORDER BY created_at LIMIT 1").get() as { id: string } | undefined;
    if (row) db.prepare("UPDATE jobs SET status = 'running', started_at = COALESCE(started_at, ?) WHERE id = ?").run(now(), row.id);
    db.exec("COMMIT");
    return row?.id ?? null;
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}

/** Tras un reinicio, los trabajos que estaban en marcha vuelven a la cola y se reanudan desde su última etapa completada. */
export function recoverInterrupted() {
  const r = db.prepare("UPDATE jobs SET status = 'queued' WHERE status = 'running'").run();
  db.prepare("UPDATE job_stages SET status = 'pending' WHERE status = 'running'").run();
  return Number(r.changes);
}

export async function tick() {
  if (running || stopped) return;
  running = true;
  try {
    for (let id = claimNext(); id && !stopped; id = claimNext()) await runJob(id);
  } finally {
    running = false;
  }
}

export function startWorker(intervalMs = 1500) {
  const n = recoverInterrupted();
  if (n) console.log(`Reanudando ${n} trabajo(s) interrumpido(s)`);
  const t = setInterval(() => void tick(), intervalMs);
  void tick();
  return () => {
    stopped = true;
    clearInterval(t);
  };
}
