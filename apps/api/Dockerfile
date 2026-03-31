FROM node:20-alpine AS base
WORKDIR /repo

FROM base AS deps
COPY package*.json ./
COPY apps/api/package.json apps/api/package.json
RUN npm install --workspace @apps/api --include-workspace-root=false

FROM deps AS build
COPY apps/api ./apps/api
RUN npm run build --workspace @apps/api

FROM base AS runtime
WORKDIR /repo
COPY --from=build /repo/apps/api/dist ./apps/api/dist
COPY --from=build /repo/apps/api/package.json ./apps/api/package.json
COPY --from=deps /repo/node_modules ./node_modules

ENV NODE_ENV=production
EXPOSE 3000
CMD ["node", "apps/api/dist/main.js"]
