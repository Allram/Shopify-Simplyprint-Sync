FROM node:20-bookworm-slim AS build
WORKDIR /app

RUN apt-get update \
	&& apt-get install -y --no-install-recommends openssl ca-certificates \
	&& rm -rf /var/lib/apt/lists/*

COPY server/package*.json server/
COPY web/package*.json web/

RUN npm --prefix server install
RUN npm --prefix web install

COPY server server
COPY web web

RUN npm --prefix server run prisma:generate
RUN npm --prefix web run build
RUN npm --prefix server run build

FROM node:20-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production

RUN apt-get update \
	&& apt-get install -y --no-install-recommends openssl ca-certificates \
	&& rm -rf /var/lib/apt/lists/*

COPY --from=build /app/server/dist /app/server/dist
COPY --from=build /app/server/package.json /app/server/package.json
COPY --from=build /app/server/node_modules /app/server/node_modules
COPY --from=build /app/server/prisma /app/server/prisma
COPY --from=build /app/server/entrypoint.sh /app/server/entrypoint.sh
COPY --from=build /app/web/dist /app/web/dist

EXPOSE 4000
WORKDIR /app/server
STOPSIGNAL SIGTERM
RUN chmod +x /app/server/entrypoint.sh
CMD ["/bin/sh", "/app/server/entrypoint.sh"]
