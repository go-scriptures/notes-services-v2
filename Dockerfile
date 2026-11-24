# Notes service image: production dependencies only, running as the unprivileged node user.
FROM node:20-alpine

WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json .npmrc ./
RUN npm ci --omit=dev

COPY . .

USER node
EXPOSE 3000

# Healthy when /health answers 200, which needs the database too.
HEALTHCHECK --interval=5s --timeout=3s --retries=5 \
  CMD node -e "fetch('http://localhost:3000/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "server.js"]
