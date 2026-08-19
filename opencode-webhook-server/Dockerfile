FROM node:20-alpine

WORKDIR /app

COPY package.json ./
RUN npm install --production

COPY src/ ./src/

ENV OPENCODE_URL=http://opencode:4096
ENV WEBHOOK_PORT=8080
ENV POLL_INTERVAL_MS=2000
ENV MAX_POLL_TIMEOUT=600000

EXPOSE 8080

CMD ["node", "src/server.js"]
