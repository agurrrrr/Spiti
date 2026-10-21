# Spiti — 정적 Vite 번들을 nginx로 서빙하는 이미지
#
# 1) build: node로 TypeScript 검사 + vite build(web/dist)를 만듭니다.
# 2) runtime: nginx:alpine이 web/nginx.conf로 dist를 서빙합니다.

# ---- 1. build ---------------------------------------------------------------
FROM node:22-alpine AS build
WORKDIR /app
# 의존성 층을 캐시하기 위해 매니페스트를 먼저 복사합니다.
COPY web/package.json web/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY web/ ./
RUN npm run build

# ---- 2. runtime -------------------------------------------------------------
FROM nginx:alpine
COPY web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
