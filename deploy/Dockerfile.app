ARG LEXUE_RUNTIME_IMAGE
FROM ${LEXUE_RUNTIME_IMAGE}
WORKDIR /app
COPY package.json ./package.json
COPY server ./server
COPY dist ./dist
