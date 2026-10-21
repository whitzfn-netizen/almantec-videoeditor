# Estado real del proyecto (21/10/2026)

Leyenda: ✅ implementado y verificado · 🟡 implementado, pendiente de verificar con datos o claves reales · ⏳ pendiente de desarrollo · ⚠️ limitación conocida

Todo lo marcado ✅ se ha probado con clips sintéticos generados por `npm run test-clips` (vídeo horizontal 1920×1080 a 30 fps, vertical a 30 fps y vertical a 60 fps, con voz real en español, silencios, una toma repetida, ruido de herramienta y 2 s en negro). **Aún no se ha probado con grabaciones reales del taller.**

## 1. Implementado y verificado

| Función | Cómo se verificó |
|---|---|
| Subida de varios clips (MP4, MOV, M4V, WEBM, MKV, AVI, 3GP; audio y guion opcionales), validación con ffprobe, aviso de duplicados, miniaturas, orden manual | Navegador (Playwright) y prueba automática |
| Botón «Generar vídeo viral» con un clic y perfil por defecto | Navegador |
| Progreso por etapas reales (sin porcentajes inventados), cola persistente, reintento que continúa desde la última etapa completada | Navegador + prueba que simula un fallo a mitad |
| Eliminación de silencios, pausas y esperas con 3 intensidades, sin cortar frases, con fundidos de 20–30 ms | Pruebas unitarias + escucha del resultado |
| Registro de segmentos eliminados con motivo (silencio, pausa, espera, repetición, muletilla, mala calidad, negro, duración, manual) | Interfaz de revisión |
| Detección de tomas repetidas (se conserva la última); «Paso 1» y «Paso 2» no se confunden | Pruebas unitarias |
| Descarte de tramos en negro | Prueba unitaria + control de calidad |
| Gancho: 3 candidatos puntuados, se elige el mejor; si el mejor es el resultado final se abre con él en vez de repetirlo | Pruebas + tabla «Ganchos evaluados» |
| Orden de la historia: gancho → proceso → resultado → cierre, y duración objetivo | Pruebas unitarias |
| Transcripción local en español (Whisper small, gratis) | E2E |
| Subtítulos quemados con 4 estilos (Limpio, Dinámico, AlmanTec, Discreto) o ninguno, palabras clave resaltadas, zona segura comprobada, editables | E2E + revisión de fotogramas |
| Encuadre 9:16: los vídeos horizontales se colocan sobre fondo desenfocado (no se recortan manos ni dispositivo); los verticales se recortan al centro | Fotogramas revisados |
| Zoom suave alterno en los cortes | Fotogramas |
| Voz en off local (Piper, femenina o masculina, es-ES) solo cuando el perfil lo pide o hay guion; guion antes de sintetizar; se acelera hasta 1,25× o se recorta si no cabe | CLI con guion |
| Música de tu biblioteca con atenuación automática bajo la voz | CLI con pista de prueba |
| Normalización de volumen a ≈ −14 LUFS, picos < −1 dBTP | Control de calidad (−14,2 LUFS medido) |
| Exportación MP4 H.264 High + AAC 192 kbps, 1080×1920, 30 fps (o 60 si todo el material es de 60), `faststart` | Control de calidad |
| Control de calidad automático (11 comprobaciones: formato, resolución, color, duración, sincronía, decodificación completa, negros, silencios, volumen, zona segura) | Cada render |
| Pack de publicación sin IA: 3 títulos, descripción, hashtags con motivo, llamada a la acción, frase de portada, resumen del gancho, cambios realizados y avisos. Solo usa lo que se dice en el audio y los datos de la marca; nunca inventa averías ni precios | E2E |
| Portada JPG, subtítulos .srt, paquete .zip con todo | Prueba automática (descarga por rangos y zip) |
| Revisión rápida: editar textos de subtítulos y del gancho, cambiar estilo, voz, quitar fragmentos y volver a exportar reutilizando análisis y tramos en caché | Navegador (v1 → v2) |
| Variaciones «otro gancho» y «otro ritmo» | Prueba automática («otro ritmo»); «otro gancho» usa el mismo mecanismo, sin prueba específica |
| Historial de proyectos: duplicar, regenerar, aceptar, borrar versiones y proyectos | Navegador + prueba |
| 10 perfiles predefinidos editables y perfil por defecto | Interfaz |
| Marca: nombre, servicios, ubicación, redes, CTA, color, logo PNG, diccionario de correcciones («ifon» → «iPhone») | Interfaz |
| Costes: modos Económico / Equilibrado / Premium, tabla de precios editable, límite por vídeo y mensual, coste desconocido bloqueado por defecto, registro de gasto | Pruebas unitarias |
| Inteligencia: referencias (con análisis local del vídeo que subas), biblioteca de ganchos, ideas, métricas con aviso de «correlación no implica causa» | Interfaz |
| Acceso con contraseña, cookie firmada, límites de intentos, cabeceras de seguridad, errores sin secretos, claves solo en el servidor | Prueba automática + revisión |
| Interfaz en español, tema oscuro, adaptada a móvil (sin desplazamiento horizontal a 390 px) | Capturas en escritorio y móvil |
| Caché por huella del archivo: la segunda generación de los mismos clips pasa de ~55 s a ~20 s | CLI |
| 17 pruebas automáticas (`npm test`), todas superadas | `npm test` |

## 2. Implementado, pendiente de configurar o verificar

| Función | Qué falta |
|---|---|
| 🟡 Claude (Anthropic) para elegir escenas, ordenar, redactar el gancho y el pack (modos Equilibrado y Premium) | `ANTHROPIC_API_KEY` en el `.env`. Implementado con el SDK oficial y salida estructurada, **no probado con una clave real** |
| 🟡 Análisis de referencias con IA | La misma clave |
| 🟡 Voces ElevenLabs | `ELEVENLABS_API_KEY` y los ID de voz. Adaptador según su API pública, **sin probar** |
| 🟡 Imagen Docker | La fase de compilación (`npm ci` + build) se probó; la imagen final no pudo construirse aquí porque el entorno bloquea los repositorios de Debian. Hay que construirla una vez en el servidor |
| 🟡 Retención automática (`RETENTION_DAYS`) | Implementada, sin prueba larga |
| 🟡 Calidad con material real (ruido del taller, voz lejana, móviles con HDR o rotación) | Necesito 3–5 clips reales tuyos |

## 3. Servicios externos (todos opcionales)

| Servicio | Para qué | Qué recibe | Coste |
|---|---|---|---|
| Anthropic (Claude) | Mejor selección, orden y textos | Transcripción + 8–20 fotogramas por vídeo | Opus 5.5: 4 $ / 20 $ por millón de tokens; se estima antes y se respeta tu límite |
| ElevenLabs | Voz más natural | Solo el texto del guion | Según tu plan |
| Servidor (VPS) | Alojar la plataforma | Tus vídeos se quedan en él | Un VPS de 4 vCPU/8 GB suele costar 8–15 €/mes; consulta el precio actual del proveedor |

## 4. Pendiente de desarrollo

- ⏳ Publicación directa en TikTok/Instagram/YouTube: no se ha hecho a propósito (no se publica nada sin tu autorización). Se puede añadir más adelante con aprobación manual por vídeo.
- ⏳ Importar métricas automáticamente desde las plataformas (ahora se introducen a mano).
- ⏳ Editor de línea de tiempo con arrastrar y soltar (ahora hay revisión por fragmentos y textos).
- ⏳ Seguimiento de objetos para reencuadrar planos horizontales con recorte inteligente.
- ⏳ Usuarios múltiples con permisos (ahora hay una única contraseña de acceso).
- ⏳ Almacenamiento en la nube (S3/R2); ahora es disco local del servidor.

## 5. Limitaciones conocidas

- ⚠️ Whisper local no da tiempos exactos por palabra: se estiman dentro de cada frase detectada. Los subtítulos están bien sincronizados por frase, pero el resaltado palabra a palabra puede adelantarse o retrasarse unas décimas.
- ⚠️ Whisper puede equivocarse con palabras técnicas (en la prueba oyó «como un MOVA» en lugar de «como nueva»). Se corrige en la revisión o con el diccionario de la marca.
- ⚠️ Sin clave de Claude, el gancho y el pack salen de reglas y plantillas: son correctos pero menos creativos.
- ⚠️ Chromium de pruebas no reproduce H.264 (falta de códecs propietarios); Chrome, Safari, Edge y Firefox normales sí.
- ⚠️ El control de calidad comprueba el archivo; no garantiza las especificaciones vigentes de cada plataforma, que cambian.

## 6. Siguiente paso recomendado

1. Crear el repositorio privado y subir este código.
2. Probar con 3–5 clips reales de una reparación y ajustar umbrales de corte y gancho.
3. Añadir la clave de Anthropic con un límite bajo (por ejemplo 0,50 $ por vídeo) y comparar el modo Equilibrado con el Económico.
4. Contratar un VPS y desplegar con Docker detrás de HTTPS.
