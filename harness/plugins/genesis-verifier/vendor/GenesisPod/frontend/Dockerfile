FROM node:20-alpine AS builder

# 设置 UTF-8 编码环境
ENV LANG=C.UTF-8
ENV LC_ALL=C.UTF-8

# 接收构建时参数 - Railway 会自动传递同名环境变量作为 build args
ARG NEXT_PUBLIC_API_URL
ARG NEXT_PUBLIC_AI_URL

# 设置为环境变量供 npm run build 使用
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_AI_URL=$NEXT_PUBLIC_AI_URL

RUN apk add --no-cache git

WORKDIR /app

COPY package.json package-lock.json .npmrc ./
RUN npm install

COPY . .
RUN npm run build

# ── Runtime stage (standalone mode) ──────────────────────────────
FROM node:20-alpine

ENV NODE_ENV=production
ENV LANG=C.UTF-8
ENV LC_ALL=C.UTF-8

WORKDIR /app

RUN apk add --no-cache dumb-init

# standalone 模式只需复制三个目录，无需 npm install
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public

RUN addgroup -g 1001 -S nodejs && adduser -S nextjs -u 1001
RUN chown -R nextjs:nodejs /app
USER nextjs

# Railway 会动态设置 PORT，不硬编码
EXPOSE 3000

# ★ 2026-05-27 onprem 部署: API 路由通过 frontend/middleware.ts 在 *runtime* 读
#   API_INTERNAL_URL 实时 rewrite, 不再依赖 next.config.js rewrites() build-time bake。
#   middleware 在 Next.js standalone 也保留 process.env 运行时访问能力 - 这是
#   framework 唯一干净的 "动态改 rewrite 目标" 方案。
ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "--insecure-http-parser", "server.js"]
