FROM node:20-alpine AS base
WORKDIR /repo

FROM base AS deps
COPY package*.json ./
COPY apps/web/package.json apps/web/package.json
RUN npm install

FROM deps AS build
COPY . .
RUN npm run build --workspace @apps/web

FROM nginx:1.27-alpine AS runtime
COPY --from=build /repo/apps/web/dist /usr/share/nginx/html
COPY apps/web/nginx/default.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
