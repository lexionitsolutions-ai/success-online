FROM node:24-bookworm-slim
WORKDIR /app
COPY package.json package-lock.json server.js database.js storage.js service-catalog.js archive.js operations-schema.js ./
RUN npm ci --omit=dev
COPY public ./public
COPY supabase ./supabase
RUN mkdir -p /app/storage && chown -R node:node /app
USER node
ENV NODE_ENV=production PORT=3000 DATABASE_PATH=/app/storage/success-online.sqlite STORAGE_PATH=/app/storage/documents
EXPOSE 3000
CMD ["node", "server.js"]
