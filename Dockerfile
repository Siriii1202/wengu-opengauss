FROM node:22.23.1-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci --no-audit --no-fund
COPY app ./app
COPY lib ./lib
COPY public ./public
COPY index.html main.tsx ./
RUN npm run build && npm prune --omit=dev --no-audit --no-fund

FROM node:22.23.1-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=8788
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY db ./db
COPY lib ./lib
COPY server.mjs ./
USER node
EXPOSE 8788
CMD ["node", "server.mjs"]
