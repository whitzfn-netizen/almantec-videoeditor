#!/usr/bin/env bash
# Descarga los modelos locales y gratuitos (se ejecutan en tu servidor, sin enviar audio a terceros):
#  - Silero VAD: detección de voz.
#  - Whisper small/base int8 (sherpa-onnx): transcripción en español.
#  - Piper es_ES sharvard (femenina/masculina) y davefx (masculina): voz en off. Licencias en cada MODEL_CARD.
# Uso: npm run models            (VAD + whisper small + voces)
#      WHISPER=base npm run models  (modelo más ligero y rápido, algo menos preciso)
set -euo pipefail
DIR="${MODELS_DIR:-$(cd "$(dirname "$0")/.." && pwd)/models}"
BASE="https://github.com/k2-fsa/sherpa-onnx/releases/download"
WHISPER="${WHISPER:-small}"
mkdir -p "$DIR"
cd "$DIR"

fetch() { curl -fL --retry 4 --retry-delay 2 -o "$2" "$1"; }

if [ ! -f silero_vad.onnx ]; then
  echo "→ Silero VAD"
  fetch "$BASE/asr-models/silero_vad.onnx" silero_vad.onnx
fi

untar() {
  local url="$1" name="$2"
  if [ -d "$name" ]; then echo "✓ $name ya existe"; return; fi
  echo "→ $name"
  fetch "$url" "$name.tar.bz2"
  tar xjf "$name.tar.bz2"
  rm -f "$name.tar.bz2"
}

untar "$BASE/asr-models/sherpa-onnx-whisper-$WHISPER.tar.bz2" "sherpa-onnx-whisper-$WHISPER"
# Solo se usan las versiones int8: se borran las de precisión completa para ahorrar disco.
rm -f "sherpa-onnx-whisper-$WHISPER/$WHISPER-encoder.onnx" "sherpa-onnx-whisper-$WHISPER/$WHISPER-decoder.onnx"
rm -rf "sherpa-onnx-whisper-$WHISPER/test_wavs"

untar "$BASE/tts-models/vits-piper-es_ES-sharvard-medium.tar.bz2" vits-piper-es_ES-sharvard-medium
untar "$BASE/tts-models/vits-piper-es_ES-davefx-medium.tar.bz2" vits-piper-es_ES-davefx-medium

echo "Modelos listos en $DIR"
du -sh "$DIR"/* 2>/dev/null || true
