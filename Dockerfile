FROM node:20-alpine

WORKDIR /app
ENV NODE_ENV=production

COPY package*.json ./
RUN npm ci --omit=dev

COPY src ./src
COPY sql ./sql
COPY docs ./docs

EXPOSE 3000
CMD ["sh", "-c", "npm run migrate && npm start"]
