# 用于 Fly.io / Railway / 任何支持 Docker 的平台
FROM node:22-alpine

WORKDIR /app

# 先只拷依赖清单，这样改代码时不用重装依赖
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev 2>/dev/null || npm install --omit=dev

COPY cardLogic.js server.js game.js sfx.js index.html style.css ./

ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

# 平台会定期请求 /healthz 确认服务还活着
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD wget -qO- http://127.0.0.1:${PORT}/healthz || exit 1

CMD ["node", "server.js"]
