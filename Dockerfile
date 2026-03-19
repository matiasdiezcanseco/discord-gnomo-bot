FROM debian:bullseye as builder

ARG NODE_VERSION=23.7.0

RUN apt-get update; apt install -y curl python-is-python3 pkg-config build-essential
RUN curl https://get.volta.sh | bash
ENV VOLTA_HOME /root/.volta
ENV PATH /root/.volta/bin:$PATH
RUN volta install node@${NODE_VERSION}
RUN npm install -g pnpm

#######################################################################

RUN mkdir /app
WORKDIR /app

# Copy package files first for better layer caching
COPY package.json pnpm-lock.yaml ./

# Install ALL dependencies (including devDependencies) for building
RUN pnpm install --frozen-lockfile

# Copy prisma schema and generate client
COPY prisma ./prisma
RUN pnpm run db:generate

# Copy source code
COPY . .

# Build the application
RUN pnpm run build

#######################################################################

FROM debian:bullseye

LABEL fly_launch_runtime="nodejs"

COPY --from=builder /root/.volta /root/.volta
COPY --from=builder /app/dist /app/dist
COPY --from=builder /app/package.json /app/package.json
COPY --from=builder /app/pnpm-lock.yaml /app/pnpm-lock.yaml
COPY --from=builder /app/prisma /app/prisma

WORKDIR /app
ENV NODE_ENV production
ENV PATH /root/.volta/bin:$PATH

# Install pnpm and production dependencies only
RUN npm install -g pnpm && pnpm install --prod --frozen-lockfile

# Generate Prisma client for production
RUN npx prisma generate

# Run the compiled application directly in production
CMD [ "node", "dist/main.js" ]