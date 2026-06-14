# Stage 1: build TypeScript -> dist (allowJs compiles the not-yet-converted .js too)
FROM --platform=linux/arm64 public.ecr.aws/docker/library/node:22.22-alpine AS builder

WORKDIR /app

# Install all deps (incl. devDeps like typescript) for the build
COPY package*.json tsconfig*.json ./
RUN npm ci

# Compile (transpile-only via `npm run build` = tsc --noCheck): emits runnable JS
# even while the strict type backlog is being burned down.
COPY . .
RUN npm run build

# Stage 2: production runtime — only compiled output + prod deps
FROM --platform=linux/arm64 public.ecr.aws/docker/library/node:22.22-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev

# Compiled application (self-contained: prod runs plain HTTP, no cert/ assets)
COPY --from=builder /app/dist ./dist

# Expose the port the app is listening on (default for Express is 3000)
EXPOSE 3000

USER node
CMD [ "node", "dist/index.js" ]
