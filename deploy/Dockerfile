# syntax=docker/dockerfile:1
# The legal research site: the API is a Vite plugin, so production is
# `vite preview`, not a static file server.
FROM node:24-bookworm-slim

ENV CI=1
RUN npm install -g pnpm@10.32.1

WORKDIR /app
COPY package.json pnpm-lock.yaml* pnpm-workspace.yaml* ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build

EXPOSE 80
CMD ["pnpm", "exec", "vite", "preview", "--host", "0.0.0.0", "--port", "80", "--strictPort"]
