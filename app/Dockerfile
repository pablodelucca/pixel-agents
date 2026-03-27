# Clawmpany - App (Frontend)
FROM node:22-alpine AS builder

# Install build dependencies for native modules (bufferutil, etc)
RUN apk add --no-cache python3 make g++

WORKDIR /app

# Build-time arguments for environment variables
ARG VITE_PRIVY_APP_ID
ARG VITE_API_URL=http://localhost:5173

# Create .env file for Vite to read during build
RUN echo "VITE_PRIVY_APP_ID=$VITE_PRIVY_APP_ID" > .env && \
    echo "VITE_API_URL=$VITE_API_URL" >> .env

# Debug: Show .env file
RUN cat .env

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy source code
COPY . .

# Build the application
RUN npm run build

FROM nginx:alpine AS runner

COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 5173

CMD ["nginx", "-g", "daemon off;"]
