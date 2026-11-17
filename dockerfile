# Stage 1: Base e dependências
FROM node:22-bookworm-slim AS base
WORKDIR /app
COPY package*.json ./
RUN npm install

# Stage 2: Runner de Desenvolvimento / Testes
FROM base AS dev
COPY tsconfig.json vitest.config.ts ./
COPY src ./src
COPY tests ./tests
CMD ["npm", "run", "start"]

# Stage 3: Build de Produção
FROM base AS builder
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# Stage 4: Imagem Final Enxuta de Produção
FROM node:22-bookworm-slim AS prod
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm install --omit=dev
COPY --from=builder /app/dist ./dist
CMD ["node", "dist/index.js"]