# AlmanTec Viral Studio AI · imagen de producción (servidor web + procesador de vídeo)
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY web/package.json web/
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev

FROM node:22-bookworm-slim
RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg fonts-inter fonts-dejavu-core curl ca-certificates bzip2 tini \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NODE_ENV=production DATA_DIR=/data MODELS_DIR=/models PORT=8080 FONTS_DIR=/usr/share/fonts/opentype/inter
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules node_modules
COPY --from=build /app/server/package.json server/
COPY --from=build /app/server/dist server/dist
COPY --from=build /app/web/dist web/dist
COPY scripts scripts
RUN useradd -r -u 10001 studio && mkdir -p /data /models && chown studio /data /models
USER studio
EXPOSE 8080
VOLUME ["/data", "/models"]
HEALTHCHECK --interval=30s --timeout=5s CMD curl -fs http://localhost:8080/api/health || exit 1
ENTRYPOINT ["tini", "--"]
CMD ["node", "--disable-warning=ExperimentalWarning", "server/dist/index.js"]
