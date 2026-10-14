FROM node:22-alpine
WORKDIR /app
COPY package.json server.js ./
COPY public ./public
ENV PORT=8787 HOST=0.0.0.0 TRUST_PROXY=1
USER node
EXPOSE 8787
CMD ["node", "server.js"]
