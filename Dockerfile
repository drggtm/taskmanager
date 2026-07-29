#Build stage
FROM node:18-alpine AS builder

WORKDIR /usr/src/app

COPY package*.json .

RUN npm install --production

FROM node:18-alpine AS production

ENV NODE_ENV=production

RUN addgroup -g 1001 -S nodejs && \
    adduser -S -u 1001 -G nodejs nodeuser

WORKDIR /usr/src/app

COPY --from=builder /usr/src/app/node_modules ./node_modules

COPY --chown=nodeuser:nodejs . .

USER nodeuser

EXPOSE 3000

CMD ["node", "server.js"]
