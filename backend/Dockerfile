FROM mcr.microsoft.com/playwright:v1.56.1-noble
ENV NODE_ENV=production PORT=8080
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund
COPY src ./src
USER pwuser
EXPOSE 8080
CMD ["npm", "start"]

