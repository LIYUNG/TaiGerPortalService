# FROM node:18-alpine

# Test aws ecr
FROM --platform=linux/arm64 public.ecr.aws/docker/library/node:18.20.5-alpine

# Update package list and install necessary tools
RUN apk add --no-cache bash curl

WORKDIR /app

# Install dependencies before copying source so Docker can reuse this layer
# unless package.json or package-lock.json changes.
COPY package*.json ./
RUN npm ci --omit=dev --no-audit

# Copy the rest of the application
COPY . .

# Expose the port the app is listening on (default for Express is 3000)
EXPOSE 3000

USER node
CMD [ "npm", "run", "prod" ]
