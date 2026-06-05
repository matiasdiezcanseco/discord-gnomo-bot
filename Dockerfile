FROM node:23-bullseye as builder

RUN mkdir /app
WORKDIR /app

# Copy package files first for better layer caching
COPY package.json package-lock.json ./

# Install ALL dependencies (including devDependencies) for building
RUN npm ci

# Copy prisma schema and generate client
COPY prisma ./prisma
RUN npm run db:generate

# Copy source code
COPY . .

# Build the application
RUN npm run build

#######################################################################

FROM node:23-bullseye

LABEL fly_launch_runtime="nodejs"

COPY --from=builder /app/dist /app/dist
COPY --from=builder /app/package.json /app/package.json
COPY --from=builder /app/package-lock.json /app/package-lock.json
COPY --from=builder /app/prisma /app/prisma

WORKDIR /app
ENV NODE_ENV production

# Install production dependencies only
RUN npm ci --omit=dev

# Generate Prisma client
RUN npx prisma generate

# Run the compiled application directly in production
CMD [ "node", "dist/main.js" ]
