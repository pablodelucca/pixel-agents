FROM oven/bun:1
WORKDIR /app

COPY package.json ./
COPY server/package.json server/bun.lock server/
COPY webview-ui/package.json webview-ui/package-lock.json webview-ui/

RUN bun install && cd server && bun install && cd ../webview-ui && bun install

COPY . .
RUN cd webview-ui && bun run build

EXPOSE 3000

CMD ["bun", "server/index.ts"]
