FROM node:20-alpine AS builder

WORKDIR /app

RUN corepack enable && corepack prepare pnpm@10.33.0 --activate

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

COPY . .

# VITE_API_URL vacío = el frontend usa el mismo origen (nginx hace el proxy)
ARG VITE_API_URL=""
ENV VITE_API_URL=$VITE_API_URL

RUN pnpm build

# ── Serve with nginx ──────────────────────────────────────────
FROM nginx:alpine

COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80
