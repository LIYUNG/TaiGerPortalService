# FROM node:18-alpine

# Test aws ecr
FROM --platform=linux/arm64 public.ecr.aws/docker/library/node:18.20.5-alpine

# Update package list and install necessary tools
RUN apk add --no-cache bash curl

WORKDIR /app

# Copy the rest of the application
COPY . .

RUN npm install --production 

# Expose the port the app is listening on (default for Express is 3000)
EXPOSE 3000

USER node
CMD [ "npm", "run", "prod" ]