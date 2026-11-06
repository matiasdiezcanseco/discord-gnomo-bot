FROM node:24-bullseye AS builder
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY nest-cli.json tsconfig*.json ./
COPY src ./src
RUN npm run build

FROM node:24-bullseye
LABEL fly_launch_runtime="nodejs"
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts
COPY --from=builder /app/dist ./dist
# Explicit SQL and operator sources remain available; startup never runs migrations.
COPY prisma ./prisma
COPY scripts ./scripts
COPY src ./src
COPY tsconfig*.json ./
CMD ["node", "dist/main.js"]
