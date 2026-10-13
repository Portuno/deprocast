# Mastropiero en un contenedor (NaN cloud u otro): Node 24 corre el TypeScript tal cual, sin compilar.
# La base y los archivos viven en /data: montá ahí un volumen persistente, o se pierden en cada deploy.
FROM node:24-slim

# ffmpeg: partir audios largos para Whisper, unir tramos y montar videos del Taller.
RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY . .

# Expuesto en la red, siempre con clave (MASTRO_CLAVE va en las variables del servicio, no acá).
ENV MASTRO_HOST=0.0.0.0 \
    MASTRO_PUERTO=3000 \
    MASTRO_NUBE=1 \
    MASTRO_DB=/data/mastro.db
EXPOSE 3000
CMD ["node", "--disable-warning=ExperimentalWarning", "src/servidor.ts"]
