# AlmanTec Viral Studio AI

Plataforma web privada que convierte varios clips en bruto en un vídeo vertical 9:16 listo para TikTok, Reels y Shorts, con su pack de publicación. Subes los clips, pulsas **Generar vídeo viral** y el servidor analiza, corta, ordena, subtitula, añade voz y música si procede, exporta y comprueba la calidad.

Todo funciona **sin claves de pago**: la transcripción (Whisper), la detección de voz (Silero) y la voz en off (Piper) se ejecutan en tu propio servidor. Claude (Anthropic) y ElevenLabs son mejoras opcionales que se activan añadiendo su clave al `.env`.

> Estado real de cada función, lo verificado y lo pendiente: [docs/ESTADO.md](docs/ESTADO.md).

## Requisitos

- Node.js 22.13 o superior.
- FFmpeg 5.1 o superior con libx264, libass y libfreetype (`ffmpeg -filters` debe listar `ass`, `loudnorm`, `silencedetect`, `blurdetect`, `sidechaincompress`).
- ~2 GB de disco para los modelos locales y espacio para tus vídeos.
- Recomendado: 4 núcleos y 4 GB de RAM. Un vídeo de ~1 minuto de material tarda ~1 minuto la primera vez.

## Puesta en marcha en local

```bash
npm install
npm run models          # descarga VAD, Whisper small y voces Piper (gratis, ~1,5 GB)
cp .env.example .env    # pon APP_PASSWORD y SESSION_SECRET (openssl rand -hex 32)
npm run build
npm start               # http://localhost:8080
```

Desarrollo con recarga automática: `npm run dev` (API en :8080 y web en :5173).

Probar sin grabar nada: `npm run test-clips` genera tres clips sintéticos con voz en `test-clips/`, y `npm test` ejecuta las pruebas automáticas (incluye un flujo completo de subida → vídeo final → revisión → reexportación → reanudación tras fallo).

También hay una línea de comandos: `cd server && npx tsx src/cli.ts generar clip1.mp4 clip2.mp4 --perfil almantec-viral`.

## Claves y seguridad

- Las claves van **solo** en el `.env` del servidor (o en los secretos de tu proveedor de hosting). Nunca en el frontend ni en GitHub: `.env` está en `.gitignore`.
- El panel de Configuración muestra qué proveedor está activo, pero nunca devuelve el valor de una clave.
- En producción el servidor se niega a arrancar sin `APP_PASSWORD` (≥10 caracteres) y `SESSION_SECRET`.
- Acceso con contraseña, cookie firmada `HttpOnly`/`SameSite`, límite de intentos de acceso, validación de tipo y tamaño de archivos, cabeceras de seguridad, errores sin detalles internos.
- Qué sale de tu servidor y a quién:
  - **Nada**, si no configuras claves.
  - **Claude (Anthropic)**, si pones `ANTHROPIC_API_KEY`: recibe la transcripción y 8–20 fotogramas sueltos por vídeo (no el vídeo). Se puede desactivar en Configuración o usando el modo Económico.
  - **ElevenLabs**, si pones su clave: recibe solo el texto del guion de la voz en off.
- La plataforma **no publica** en ninguna red social. Tú descargas el vídeo y lo subes.

## Costes

| Servicio | Coste | Cuándo se usa |
|---|---|---|
| Whisper, Silero, Piper, FFmpeg | 0 € (CPU de tu servidor) | Siempre |
| Claude Opus 5.5 | 4 $ / 20 $ por millón de tokens (entrada/salida), según la tabla editable en Configuración | Modos Equilibrado (si está activado) y Premium; una sola llamada por vídeo |
| ElevenLabs | Según tu plan, por caracteres | Solo si configuras su clave |

Antes de cada llamada de pago se estima el coste y se compara con tus límites (por vídeo y mensual, en Configuración › Costes). Si el coste no se puede estimar, no se llama salvo que lo permitas expresamente. Los precios de la tabla son editables: compruébalos en la web del proveedor, porque cambian.

## Despliegue

GitHub Pages **no sirve**: solo aloja archivos estáticos y aquí hace falta un servidor con FFmpeg, almacenamiento y una cola de trabajos. Opciones recomendadas:

1. **VPS con Docker** (Hetzner, OVH, DigitalOcean…; 4 vCPU/8 GB desde ~8–15 €/mes, consulta precios actuales):
   ```bash
   cp .env.example .env    # rellena APP_PASSWORD y SESSION_SECRET
   docker compose run --rm models
   docker compose up -d --build
   ```
   El contenedor escucha en `127.0.0.1:8080`. Pon delante un proxy con HTTPS, por ejemplo Caddy: `tu-dominio.com { reverse_proxy 127.0.0.1:8080 }`.
2. **Un ordenador propio** siempre encendido con `npm start` y un túnel HTTPS (Cloudflare Tunnel o Tailscale).

Copias de seguridad: guarda el volumen de datos (`/data`: base de datos `studio.db` y proyectos).

### ¿Por qué no FFmpeg.wasm en el navegador?

Se evaluó: limita la memoria a ~2 GB, es entre 10 y 20 veces más lento que FFmpeg nativo, no permite Whisper/VAD con la misma calidad y obliga a mantener la pestaña abierta durante el render. Para clips de varios minutos en 1080p no es fiable, así que todo el procesado se hace en el servidor.

## Arquitectura

- `server/`: Fastify + TypeScript, SQLite (`node:sqlite`), cola persistente con etapas (preparación → audio → transcripción → visual → plan → voz → subtítulos → render → control de calidad → entrega). Si algo falla, se reintenta desde la última etapa completada. Los análisis y los tramos renderizados se guardan en caché por huella del archivo, así que las correcciones y variaciones no repiten trabajo.
- `server/src/providers/`: proveedores intercambiables (transcripción, voz, IA de lenguaje) detrás de interfaces.
- `web/`: React + Vite, interfaz en español, tema oscuro, adaptada a móvil.
- Para separar el procesador del servidor web: `INLINE_WORKER=0` y `npm run worker` en otro proceso.

## Licencias de los modelos

- Whisper (OpenAI, MIT), exportado por sherpa-onnx (Apache-2.0).
- Silero VAD (MIT).
- Voces Piper `es_ES-sharvard-medium` y `es_ES-davefx-medium`: consulta el `MODEL_CARD` de cada carpeta en `models/` antes de un uso comercial.
- Música: la plataforma solo usa pistas que subas tú a la biblioteca. Usa música con licencia.
