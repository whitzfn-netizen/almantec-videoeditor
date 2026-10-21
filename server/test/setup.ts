// Base de datos y almacenamiento aislados para las pruebas.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "avs-test-"));
process.env.DATA_DIR = dir;
process.env.APP_PASSWORD = process.env.APP_PASSWORD ?? "";
export const TEST_DATA_DIR = dir;
export const ROOT = path.resolve(import.meta.dirname, "..", "..");
export const CLIPS = path.join(ROOT, "test-clips");
