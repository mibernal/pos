FROM node:22-alpine AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable

FROM base AS build
WORKDIR /usr/src/app

# Copy the entire workspace
COPY . .

# Install dependencies using cache
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile

# Build everything in the monorepo
RUN pnpm run build

# Deploy only the api package and its production dependencies to a separate folder
RUN pnpm deploy --filter=@pos-dian/api --prod /prod/api

FROM base AS api
# Add non-root user for security
RUN adduser --system --uid 1001 nodejs

WORKDIR /app
COPY --from=build --chown=nodejs:nodejs /prod/api .

USER nodejs
EXPOSE 3000

ENV NODE_ENV=production
CMD [ "node", "dist/index.js" ]
