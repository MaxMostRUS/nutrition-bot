FROM node:20-alpine

WORKDIR /app
ENV NODE_ENV=production

RUN apk add --no-cache python3 py3-pip \
  && pip3 install --no-cache-dir --break-system-packages pdfplumber

COPY package*.json ./
RUN npm install --omit=dev

COPY src ./src
COPY sql ./sql
COPY docs ./docs

EXPOSE 3000
CMD ["sh", "-c", "npm run migrate && npm start"]
