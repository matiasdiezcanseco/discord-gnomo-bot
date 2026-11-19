FROM node:24-bookworm AS builder
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY nest-cli.json tsconfig*.json ./
COPY src ./src
RUN npm run build

FROM node:24-bookworm AS runtime
LABEL fly_launch_runtime="nodejs"
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
# Database/Redis endpoints are supplied at runtime: Compose locally, secrets on Fly.
# Never bake local or Supabase connection strings into this image.
EXPOSE 3000
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts
COPY --from=builder /app/dist ./dist
# Startup applies pending Drizzle migrations before Discord; operator CLI remains available.
COPY drizzle ./drizzle
COPY scripts ./scripts
COPY src ./src
COPY tsconfig*.json ./
CMD ["node", "dist/main.js"]
