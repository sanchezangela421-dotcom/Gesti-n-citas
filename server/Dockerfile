FROM node:20-alpine

WORKDIR /app

# Enable pnpm via corepack
RUN corepack enable && corepack prepare pnpm@10.33.0 --activate

# Install dependencies
COPY package.json pnpm-lock.yaml ./
COPY prisma ./prisma/
RUN pnpm install --frozen-lockfile

# Build TypeScript (prisma generate + tsc)
COPY tsconfig.json ./
COPY src ./src/
RUN pnpm build

# Persistent uploads directory
RUN mkdir -p uploads

COPY docker-entrypoint.sh ./
RUN chmod +x docker-entrypoint.sh

EXPOSE 3000

CMD ["./docker-entrypoint.sh"]
