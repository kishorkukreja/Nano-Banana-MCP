FROM node:20-slim AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json vite.config.ts ./
COPY src/ src/
RUN npm run build

FROM node:20-slim
WORKDIR /app
ENV NODE_ENV=production
ENV IMAGE_OUTPUT_DIR=/tmp/images
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=builder /app/dist/ dist/
EXPOSE 3000
CMD ["node", "dist/remote.js"]
