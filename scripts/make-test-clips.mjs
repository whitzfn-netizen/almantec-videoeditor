// Genera clips de prueba sintéticos con voz real en español (Piper local) para verificar el flujo completo.
// No sustituyen a grabaciones reales: sirven para comprobar silencios, repeticiones, negro, fps mixtos y formatos.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(path.resolve("server/package.json"));
const sherpa = require("sherpa-onnx-node");
const M = process.env.MODELS_DIR ?? path.resolve("models");
const OUT = path.resolve(process.argv[2] ?? "test-clips");
fs.mkdirSync(OUT, { recursive: true });
const tmp = fs.mkdtempSync(path.join(OUT, ".tmp-"));

const tts = new sherpa.OfflineTts({
  model: { vits: { model: `${M}/vits-piper-es_ES-davefx-medium/es_ES-davefx-medium.onnx`, tokens: `${M}/vits-piper-es_ES-davefx-medium/tokens.txt`, dataDir: `${M}/vits-piper-es_ES-davefx-medium/espeak-ng-data` }, numThreads: 2 },
  maxNumSentences: 1,
});
const ff = (args) => execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args], { stdio: "inherit" });

/** Construye una pista de audio: [segundos de silencio | frase]. */
function track(name, parts) {
  const files = [];
  parts.forEach((p, i) => {
    const f = path.join(tmp, `${name}_${i}.wav`);
    if (typeof p === "number") ff(["-f", "lavfi", "-t", String(p), "-i", "anullsrc=r=22050:cl=mono", f]);
    else {
      const a = tts.generate({ text: p, sid: 0, speed: 1.0 });
      sherpa.writeWave(f, { samples: a.samples, sampleRate: a.sampleRate });
    }
    files.push(f);
  });
  const list = path.join(tmp, `${name}.txt`);
  fs.writeFileSync(list, files.map((f) => `file '${f}'`).join("\n"));
  const out = path.join(tmp, `${name}.wav`);
  ff(["-f", "concat", "-safe", "0", "-i", list, "-ar", "48000", out]);
  return out;
}
const dur = (f) => Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", f]).toString());

// 1) Explicación en horizontal 1920×1080 a 30 fps con silencios largos y una toma repetida.
const a1 = track("c1", [
  2.0,
  "Hoy vamos a cambiar la pantalla de este iPhone 12, que llegó con el cristal roto.",
  2.5,
  "Primero quitamos los tornillos y separamos la pantalla con mucho cuidado.",
  1.2,
  "Primero quitamos los tornillos y separamos la pantalla con mucho cuidado, sin forzar el flex.",
  3.0,
]);
ff(["-f", "lavfi", "-i", `testsrc2=s=1920x1080:r=30:d=${dur(a1)}`, "-i", a1, "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", path.join(OUT, "01_explicacion_horizontal.mp4")]);

// 2) Proceso en vertical 1080×1920 sin voz: espera estática, sonidos de herramienta, tramo en negro.
ff([
  "-f", "lavfi", "-i", "color=c=0x303840:s=1080x1920:r=30:d=4",
  "-f", "lavfi", "-i", "mandelbrot=s=1080x1920:r=30,trim=duration=7,setpts=PTS-STARTPTS",
  "-f", "lavfi", "-i", "color=c=black:s=1080x1920:r=30:d=2",
  "-f", "lavfi", "-i", "anoisesrc=d=13:c=pink:a=0.02:r=48000",
  "-f", "lavfi", "-i", "aevalsrc='0.35*sin(2*PI*900*t)*(lt(mod(t,1.3),0.35))*gt(t,4)*lt(t,11)':d=13:s=48000",
  "-filter_complex", "[0:v][1:v][2:v]concat=n=3:v=1:a=0,format=yuv420p[v];[3:a][4:a]amix=inputs=2:normalize=0[a]",
  "-map", "[v]", "-map", "[a]", "-c:v", "libx264", "-c:a", "aac", path.join(OUT, "02_proceso_vertical.mp4"),
]);

// 3) Resultado en vertical a 60 fps con frase final.
const a3 = track("c3", [0.8, "Y aquí está el resultado: la pantalla funciona perfectamente, como nueva.", 1.0]);
ff(["-f", "lavfi", "-i", `testsrc=s=1080x1920:r=60:d=${dur(a3)}`, "-i", a3, "-vf", "hue=H=t*2,eq=brightness=0.05", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", path.join(OUT, "03_resultado_vertical_60fps.mp4")]);

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`Clips de prueba en ${OUT}:`);
for (const f of fs.readdirSync(OUT).filter((f) => f.endsWith(".mp4"))) console.log(" -", f, dur(path.join(OUT, f)).toFixed(1), "s");
