# 1) Firma paneli (Vite + React) derlemesi: her dağıtımda yeniden üretilir, eski derleme canlıya çıkmaz
FROM node:26-slim AS panel
WORKDIR /build
COPY panel/package.json panel/package-lock.json panel/
RUN cd panel && npm ci
COPY panel panel
COPY web/tokens.css web/tokens.css
RUN cd panel && npm run build

# 2) Sunucu. Node 26: Temporal, node:sqlite ve TypeScript'i derlemeden çalıştırma yerleşik
FROM node:26-slim
WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Çalışma için gerekenler: kod, web sitesi, sektör şablonları, firma ayarları (tohum), kullanıcı açma komutu
COPY src ./src
COPY web ./web
COPY --from=panel /build/web/panel ./web/panel
COPY agent ./agent
COPY tenants ./tenants
COPY scripts ./scripts

# Veritabanı kalıcı diskte (fly.toml [mounts])
ENV DB_PATH=/data/app.db
EXPOSE 8080
CMD ["node", "src/server.ts"]
