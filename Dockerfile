FROM node:20-alpine

WORKDIR /app
COPY package.json ./
COPY index.html styles.css app.js server.js ./

ENV NODE_ENV=production
EXPOSE 8000

CMD ["npm", "start"]
