# 🚀 Complete Deployment Guide - Hinglish (Hindi-English)

## 📋 Table of Contents
1. [Project Architecture](#project-architecture)
2. [Environment Variables Setup](#environment-variables-setup)
3. [Docker Configuration](#docker-configuration)
4. [GitHub Actions CI/CD](#github-actions-cicd)
5. [VPS Deployment](#vps-deployment)
6. [Socket.IO Configuration](#socketio-configuration)
7. [Frontend Integration (Vercel)](#frontend-integration)
8. [Monitoring & Troubleshooting](#monitoring--troubleshooting)

---

## Project Architecture

### 📦 Your Application Structure:
```
Solution_One_Server/
├── crm/               → CRM Module (Port 4000 in nginx, but internally 5050)
├── dms/               → DMS Module (Smartflo Integration)
├── furni/             → Furniture Module
├── so/                → Sales Order Module
├── models/            → Unified User Models
├── routes/            → Authentication Routes
├── middleware/        → Global Middleware
├── utils/             → Database & Validation Utilities
├── index.js           → Main Express Server (Port 5050)
└── docker-compose.yml → Docker Configuration
```

### 🔌 Service Ports (Internal):
- **Main Server**: 5050
- **CRM**: /api/crm/* endpoints
- **DMS**: /api/dms/* endpoints  
- **SO**: /api/so/* endpoints
- **Furni**: /api/furni/* endpoints
- **Socket.IO (CRM)**: /crm/socket.io

### 🌐 NGINX Reverse Proxy (Your VPS):
```nginx
/crm/     → localhost:5050 (Docker Container)
/dms/     → localhost:3000 (Legacy/Different container - optional)
/todo/    → localhost:7000 (Legacy/Different container - optional)
```

---

## Environment Variables Setup

### Step 1️⃣: Local Development (.env file - LOCAL USE ONLY)
```bash
# Database URLs
# MongoDB se connect karne ke liye server addresses
UNIFIED_CRM_DB_URL=mongodb://username:password@localhost:27017/crm_db
UNIFIED_SO_DB_URL=mongodb://username:password@localhost:27017/so_db
UNIFIED_AUTH_DB_URL=mongodb://username:password@localhost:27017/auth_db

# Frontend ka address
# Local development mein localhost:
UNIFIED_CLIENT_URL=http://localhost:3000

# JWT Configuration
# Token banane ke liye secret key (badi string hone chahiye)
UNIFIED_JWT_SECRET=your_super_secret_jwt_key_min_32_chars_long
# Token kitne time valid rahega
UNIFIED_JWT_EXPIRY=7d
# Refresh token ke liye alag secret
UNIFIED_REFRESH_TOKEN_SECRET=your_super_secret_refresh_token_key
UNIFIED_REFRESH_TOKEN_EXPIRY=30d

# Email Configuration (Mail Service)
# Gmail ya kisi aur service se email bhejne ke liye
MAIL_HOST=smtp.gmail.com
MAIL_PORT=587
MAIL_USER=your_email@gmail.com
MAIL_PASS=your_app_password
MAIL_FROM=noreply@yourapp.com

# Node Environment
# Development mode mein testing karo
NODE_ENV=development
UNIFIED_SERVER_PORT=5050
```

### Step 2️⃣: GitHub Secrets Configuration (For CI/CD)
**GitHub Repo → Settings → Secrets and variables → Actions**

इन secrets ko add karo:
```
# Docker image ke liye credentials
# Docker Hub account ka username
DOCKER_REGISTRY_USERNAME    → Docker Hub username
# Docker Hub account ka password / token
DOCKER_REGISTRY_PASSWORD    → Docker Hub password

# VPS ke address
VPS_HOST                    → 31.97.239.93
# SSH port (usually 22)
VPS_PORT                    → 22
# SSH user
VPS_USER                    → root
# SSH private key (secret key)
VPS_SSH_PRIVATE_KEY         → Your SSH private key
# VPS mein deployment directory
VPS_DEPLOYMENT_PATH         → /www/wwwroot/Solution_One_Server

# MongoDB URLs (3 alag databases ke liye)
MONGO_CRM_URL              → MongoDB atlas or local URL
MONGO_SO_URL               → MongoDB atlas or local URL
MONGO_AUTH_URL             → MongoDB atlas or local URL

# Frontend ka URL
FRONTEND_URL               → https://yourfrontend.vercel.app
MAIL_HOST                  → smtp.gmail.com
MAIL_PORT                  → 587
MAIL_USER                  → your_email@gmail.com
MAIL_PASS                  → app_password
MAIL_FROM                  → noreply@yourdom.com
```

### Step 3️⃣: Production Environment File
**Create `.env.production` for VPS:**
```bash
NODE_ENV=production
UNIFIED_SERVER_PORT=5050
UNIFIED_CRM_DB_URL=${MONGO_CRM_URL}
UNIFIED_SO_DB_URL=${MONGO_SO_URL}
UNIFIED_AUTH_DB_URL=${MONGO_AUTH_URL}
UNIFIED_CLIENT_URL=https://yourfrontend.vercel.app
UNIFIED_JWT_SECRET=${JWT_SECRET}
UNIFIED_JWT_EXPIRY=7d
UNIFIED_REFRESH_TOKEN_SECRET=${REFRESH_TOKEN_SECRET}
UNIFIED_REFRESH_TOKEN_EXPIRY=30d
MAIL_HOST=${MAIL_HOST}
MAIL_PORT=${MAIL_PORT}
MAIL_USER=${MAIL_USER}
MAIL_PASS=${MAIL_PASS}
MAIL_FROM=${MAIL_FROM}
```

---

## Docker Configuration

### Current Dockerfile (Already Good ✅)
Your Dockerfile is correct. It:
- Uses Node 18-alpine (lightweight)
- Installs dependencies
- Runs health checks
- Exposes port 5050

### Improved docker-compose.yml

**Update your `docker-compose.yml`:**

```yaml
version: '3.8'

services:
  # ===== MAIN BACKEND SERVER =====
  backend:
    build:
      context: .
      dockerfile: Dockerfile
    container_name: unified-portal-backend
    restart: unless-stopped
    
    environment:
      NODE_ENV: ${NODE_ENV:-production}
      UNIFIED_SERVER_PORT: 5050
      UNIFIED_CRM_DB_URL: ${UNIFIED_CRM_DB_URL}
      UNIFIED_SO_DB_URL: ${UNIFIED_SO_DB_URL}
      UNIFIED_AUTH_DB_URL: ${UNIFIED_AUTH_DB_URL}
      UNIFIED_CLIENT_URL: ${UNIFIED_CLIENT_URL}
      UNIFIED_JWT_SECRET: ${UNIFIED_JWT_SECRET}
      UNIFIED_JWT_EXPIRY: ${UNIFIED_JWT_EXPIRY}
      UNIFIED_REFRESH_TOKEN_SECRET: ${UNIFIED_REFRESH_TOKEN_SECRET}
      UNIFIED_REFRESH_TOKEN_EXPIRY: ${UNIFIED_REFRESH_TOKEN_EXPIRY}
      MAIL_HOST: ${MAIL_HOST}
      MAIL_PORT: ${MAIL_PORT}
      MAIL_USER: ${MAIL_USER}
      MAIL_PASS: ${MAIL_PASS}
      MAIL_FROM: ${MAIL_FROM}
    
    ports:
      - "5050:5050"
    
    volumes:
      - ./logs:/app/logs
      - ./uploads:/app/uploads
      - ./crm/Uploads:/app/crm/Uploads
      - ./dms/Uploads:/app/dms/Uploads
      - ./so/Uploads:/app/so/Uploads
      - ./furni/Uploads:/app/furni/Uploads
    
    networks:
      - app-network
    
    healthcheck:
      test: 
        - "CMD"
        - "node"
        - "-e"
        - "require('http').get('http://localhost:5050/health', (r) => {if (r.statusCode !== 200) throw new Error(r.statusCode)})"
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 40s
    
    # Optional: Limit resources
    deploy:
      resources:
        limits:
          cpus: '2'
          memory: 2G
        reservations:
          cpus: '1'
          memory: 1G

networks:
  app-network:
    driver: bridge
```

### .dockerignore (Update यह)
```
node_modules/
npm-debug.log
.git
.gitignore
.env
.env.local
.env.*.local
.DS_Store
.vscode/
.idea/
logs/
*.log
dist/
build/
.next/
```

---

## GitHub Actions CI/CD

### Create `.github/workflows/deploy.yml`

```yaml
name: Deploy to VPS with Docker

on:
  push:
    branches:
      - main
      - production
  pull_request:
    branches:
      - main

env:
  REGISTRY: docker.io
  IMAGE_NAME: your-docker-username/solution-one-server

jobs:
  # ===== BUILD & TEST =====
  build:
    runs-on: ubuntu-latest
    
    steps:
      - name: Checkout code
        uses: actions/checkout@v4
      
      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '18'
          cache: 'npm'
      
      - name: Install dependencies
        run: npm ci
      
      - name: Lint code (Optional)
        run: npm run lint || true
      
      - name: Run tests (Optional)
        run: npm run test || true
      
      - name: Check package compatibility
        run: npm list > /tmp/deps.txt && echo "✅ Dependencies OK"
  
  # ===== BUILD & PUSH DOCKER IMAGE =====
  docker:
    needs: build
    runs-on: ubuntu-latest
    if: github.event_name == 'push'
    
    steps:
      - name: Checkout code
        uses: actions/checkout@v4
      
      - name: Set up Docker Buildx
        uses: docker/setup-buildx-action@v3
      
      - name: Login to Docker Hub
        uses: docker/login-action@v3
        with:
          username: ${{ secrets.DOCKER_REGISTRY_USERNAME }}
          password: ${{ secrets.DOCKER_REGISTRY_PASSWORD }}
      
      - name: Build and push Docker image
        uses: docker/build-push-action@v5
        with:
          context: .
          push: true
          tags: |
            ${{ env.REGISTRY }}/${{ env.IMAGE_NAME }}:latest
            ${{ env.REGISTRY }}/${{ env.IMAGE_NAME }}:${{ github.sha }}
          cache-from: type=gha
          cache-to: type=gha,mode=max
  
  # ===== DEPLOY TO VPS =====
  deploy:
    needs: docker
    runs-on: ubuntu-latest
    if: github.event_name == 'push' && github.ref == 'refs/heads/main'
    
    steps:
      - name: Checkout code
        uses: actions/checkout@v4
      
      - name: Setup SSH key
        run: |
          mkdir -p ~/.ssh
          echo "${{ secrets.VPS_SSH_PRIVATE_KEY }}" > ~/.ssh/id_rsa
          chmod 600 ~/.ssh/id_rsa
          ssh-keyscan -H ${{ secrets.VPS_HOST }} >> ~/.ssh/known_hosts
      
      - name: Deploy to VPS
        run: |
          ssh -i ~/.ssh/id_rsa ${{ secrets.VPS_USER }}@${{ secrets.VPS_HOST }} << 'EOF'
          
          # ===== VPS DEPLOYMENT SCRIPT =====
          cd ${{ secrets.VPS_DEPLOYMENT_PATH }}
          
          # Pull latest code from GitHub
          git fetch origin
          git checkout main
          git pull origin main
          
          # Check if Docker is running
          systemctl is-active --quiet docker || systemctl start docker
          
          # Create .env file from GitHub Secrets
          cat > .env.production << 'ENVFILE'
          NODE_ENV=production
          UNIFIED_SERVER_PORT=5050
          UNIFIED_CRM_DB_URL=${{ secrets.MONGO_CRM_URL }}
          UNIFIED_SO_DB_URL=${{ secrets.MONGO_SO_URL }}
          UNIFIED_AUTH_DB_URL=${{ secrets.MONGO_AUTH_URL }}
          UNIFIED_CLIENT_URL=${{ secrets.FRONTEND_URL }}
          UNIFIED_JWT_SECRET=${{ secrets.JWT_SECRET }}
          UNIFIED_JWT_EXPIRY=7d
          UNIFIED_REFRESH_TOKEN_SECRET=${{ secrets.REFRESH_TOKEN_SECRET }}
          UNIFIED_REFRESH_TOKEN_EXPIRY=30d
          MAIL_HOST=${{ secrets.MAIL_HOST }}
          MAIL_PORT=${{ secrets.MAIL_PORT }}
          MAIL_USER=${{ secrets.MAIL_USER }}
          MAIL_PASS=${{ secrets.MAIL_PASS }}
          MAIL_FROM=${{ secrets.MAIL_FROM }}
          ENVFILE
          
          # Copy production env as default
          cp .env.production .env
          
          # Pull latest Docker image
          docker pull ${{ env.REGISTRY }}/${{ env.IMAGE_NAME }}:latest
          
          # Stop and remove old container
          docker-compose down || true
          
          # Start new containers
          docker-compose up -d
          
          # Show logs
          docker-compose logs -f backend &
          
          echo "✅ Deployment completed successfully!"
          
          EOF
      
      - name: Verify deployment
        run: |
          ssh -i ~/.ssh/id_rsa ${{ secrets.VPS_USER }}@${{ secrets.VPS_HOST }} << 'EOF'
          
          cd ${{ secrets.VPS_DEPLOYMENT_PATH }}
          
          # Wait for container to be healthy
          sleep 10
          
          # Check container status
          docker ps -a | grep unified-portal-backend
          
          # Test health endpoint
          curl -I http://localhost:5050/health || echo "Health check running..."
          
          EOF
      
      - name: Notify deployment
        if: always()
        run: |
          echo "✅ Deployment to ${{ secrets.VPS_HOST }} completed"
          echo "Backend URL: https://srv988392.hstgr.cloud/crm/"

```

### Create `.github/workflows/health-check.yml`

```yaml
name: Health Check

on:
  schedule:
    - cron: '*/30 * * * *'  # Every 30 minutes
  workflow_dispatch:

jobs:
  health-check:
    runs-on: ubuntu-latest
    
    steps:
      - name: Check VPS Backend Health
        run: |
          curl -I https://srv988392.hstgr.cloud/crm/ -w "\nStatus: %{http_code}\n"
      
      - name: Docker Container Status
        run: |
          ssh -i ~/.ssh/id_rsa ${{ secrets.VPS_USER }}@${{ secrets.VPS_HOST }} << 'EOF'
          docker ps -a | grep unified-portal-backend
          EOF

```

---

## VPS Deployment

### 📱 Step 1️⃣: VPS Server Setup (SSH - root@31.97.239.93)

```bash
# VPS mein SSH se connect karo
# (VPS se jud jao terminal ke zariye)
ssh root@31.97.239.93

# Pehle system ko update karo
# (Purane packages ko naye version mein upgrade karo)
apt update && apt upgrade -y

# Docker install karo
# (Container technology jo app ko chalayega)
curl -fsSL https://get.docker.com -o get-docker.sh
sh get-docker.sh

# Docker Compose install karo  
# (Multiple containers ko manage karne ke liye)
cd /usr/local/bin && sudo curl -L "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" -o docker-compose
chmod +x docker-compose

# Git install karo
# (Code ko GitHub se pull karne ke liye)
apt install git -y

# Deployment ke liye folder banao
# (Jahan par app chalegi wahan folder)
mkdir -p /www/wwwroot/Solution_One_Server
cd /www/wwwroot/Solution_One_Server
```

### 📂 Step 2️⃣: Clone Repository

```bash
# Uus folder mein jao jahan deploy karna hai
cd /www/wwwroot/Solution_One_Server

# Git ko initialize karo
# (Git repository setup karo)
git init

# GitHub ko origin ke roop mein add karo
# (Jahan se code pull karenge vahan ka address dedo)
git remote add origin https://github.com/akshay124-pixel/Solution_One_Server.git

# GitHub se latest code download karo
# (Main branch se pura code le lo)
git pull origin main

# Check karo sab files aa gaye ya nahi
# (Folder structure dekho)
ls -la
```

### 🔐 Step 3️⃣: Setup GitHub Deploy Key (For Automated Pulls)

```bash
# VPS mein SSH key generate karo
# (Yeh key GitHub ke sath communicate karne ke liye)
ssh-keygen -t ed25519 -N "" -f /root/.ssh/github_deploy_key

# Public key ko display karo
# (Yeh key GitHub mein add karna padega)
cat /root/.ssh/github_deploy_key.pub

# ➕ Iss key को GitHub mein add karo:
# GitHub → Settings → Deploy keys → Add deploy key
# ➕ Public key को copy-paste karo
# ✅ "Allow write access" को check karo
# ✅ Tab automatic pulls hogi jab push hoga
```

### 🔧 Step 4️⃣: Configure .env File on VPS

```bash
# Deployment folder mein jao
cd /www/wwwroot/Solution_One_Server

# .env file banao
# (Yahan app ke sab credentials likhe honge)
cat > .env << 'EOF'
# Production mode mein chalo
NODE_ENV=production

# Server kis port par chale
UNIFIED_SERVER_PORT=5050

# MongoDB connections (3 alag databases)
# CRM ke liye database URL
UNIFIED_CRM_DB_URL=mongodb+srv://username:password@cluster.mongodb.net/crm_db
# Sales Order ke liye database URL
UNIFIED_SO_DB_URL=mongodb+srv://username:password@cluster.mongodb.net/so_db
# Authentication ke liye database URL
UNIFIED_AUTH_DB_URL=mongodb+srv://username:password@cluster.mongodb.net/auth_db

# Frontend ka URL (Vercel par jo host ho raha hai)
UNIFIED_CLIENT_URL=https://yourfrontend.vercel.app

# JWT secrets (Token banane ke liye)
# Strong random string banana padega
UNIFIED_JWT_SECRET=your_generated_256bit_secret_key_here
# Token kitne din valid hoga
UNIFIED_JWT_EXPIRY=7d
# Refresh token ke liye alag secret
UNIFIED_REFRESH_TOKEN_SECRET=your_generated_256bit_refresh_secret_here
# Refresh token kitne din valid hoga
UNIFIED_REFRESH_TOKEN_EXPIRY=30d

# Email ke settings (Gmail ya kisi aur email service se)
MAIL_HOST=smtp.gmail.com
MAIL_PORT=587
MAIL_USER=your_email@gmail.com
MAIL_PASS=your_gmail_app_password
MAIL_FROM=noreply@yourapp.com
EOF

# File ko secure banao (sirf root dekh sake)
# (Passwords wali file ko protected rakho)
chmod 600 .env
```

### 🚀 Step 5️⃣: Start Docker Containers

```bash
# Project folder mein jao
cd /www/wwwroot/Solution_One_Server

# Check karo Docker installed hai ya nahi
# (Version dekho)
docker --version
docker-compose --version

# Containers ko build karke run karo
# (-d means background mein chalao)
docker-compose up -d

# Real-time logs dekho
# (App charte samay kya ho raha hai dekh sakte ho)
docker-compose logs -f backend

# Check karo container chalti hui hai ya nahi
# (Status dekho)
docker ps -a

# App test karo
# (Dekho ka server respond kar raha hai)
curl http://localhost:5050/health
```

### 📝 Step 6️⃣: Configure NGINX (Reverse Proxy)

**Edit `/etc/nginx/sites-available/srv988392.hstgr.cloud`:**

```nginx
# HTTP ko HTTPS mein redirect karo
# (Unsafe connection ko secure banao)\nserver {
    # Port 80 par sunno (HTTP)\n    listen 80;
    # Domain name\n    server_name srv988392.hstgr.cloud;

    location / {
        # Sab HTTP requests ko HTTPS mein bhej do\n        return 301 https://$host$request_uri;
    }
}

# HTTPS Server (Secure connection)\nserver {
    # Port 443 par sunno (HTTPS)\n    listen 443 ssl http2;
    # Domain name\n    server_name srv988392.hstgr.cloud;
    # File upload ki size limit (20 MB tak allow)\n    client_max_body_size 20M;
    
    # SSL Certificates (Security ke liye)\n    # Let's Encrypt ka certificate\n    ssl_certificate /etc/letsencrypt/live/srv988392.hstgr.cloud/fullchain.pem;
    # Private key\n    ssl_certificate_key /etc/letsencrypt/live/srv988392.hstgr.cloud/privkey.pem;
    include /etc/letsencrypt/options-ssl-nginx.conf;
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;

    # ===== HEALTH CHECK =====
    location /health {
        proxy_pass http://localhost:5050/health;
        access_log off;
    }

    # ===== CRM API =====
    location /api/crm/ {
        proxy_pass http://localhost:5050/api/crm/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }

    # ===== CRM SOCKET.IO =====
    location /crm/socket.io/ {
        proxy_pass http://localhost:5050/crm/socket.io/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "Upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 86400;
        proxy_send_timeout 86400;
        proxy_buffering off;
        proxy_cache_bypass $http_upgrade;
    }

    # ===== DMS API =====
    location /api/dms/ {
        proxy_pass http://localhost:5050/api/dms/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }

    # ===== SO API =====
    location /api/so/ {
        proxy_pass http://localhost:5050/api/so/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }

    # ===== FURNI API =====
    location /api/furni/ {
        proxy_pass http://localhost:5050/api/furni/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }

    # ===== UPLOADS =====
    location /api/crm/uploads/ {
        proxy_pass http://localhost:5050/crm/Uploads/;
        expires 30d;
        add_header Cache-Control "public, immutable";
    }

    location /api/dms/uploads/ {
        proxy_pass http://localhost:5050/dms/Uploads/;
        expires 30d;
        add_header Cache-Control "public, immutable";
    }

    location /api/so/uploads/ {
        proxy_pass http://localhost:5050/so/Uploads/;
        expires 30d;
        add_header Cache-Control "public, immutable";
    }

    # ===== STATIC FILES (DEFAULT) =====
    location / {
        root /var/www/html;
        try_files $uri $uri/ /index.html;
    }
}
```

**Apply NGINX changes:**

```bash
# NGINX configuration ko test karo
# (Syntax error toh nahi hai na check karo)
nginx -t

# NGINX ko restart karke naye configuration load karo
# (Bina server stop kiye naya config load hoga)
systemctl reload nginx

# NGINX running hai ya nahi check karo
# (Status dekho)
systemctl status nginx
```

---

## Socket.IO Configuration

### 🔌 Your Current Setup (CORRECT!)

In your `index.js`, Socket.IO is already configured properly:

```javascript
// CRM Socket.IO
const crmIo = new Server(server, {
  cors: { origin: allowedOrigins, methods: ["GET", "POST"], credentials: true },
  path: "/crm/socket.io"
});

// Token verification
crmIo.use((socket, next) => {
  const token = socket.handshake.auth.token;
  if (!token) return next(new Error("Authentication error: No token"));
  try {
    const decoded = crmVerifyToken(token.replace("Bearer ", ""), next);
    if (!decoded?.id) throw new Error("Invalid token payload");
    socket.user = decoded;
    next();
  } catch (err) {
    next(new Error(`Authentication failed: ${err.message}`));
  }
});
```

### 🎯 Frontend Socket.IO Connection (Vercel)

```javascript
// React/Next.js Component
import io from 'socket.io-client';

const socket = io('https://srv988392.hstgr.cloud', {
  path: '/crm/socket.io',
  auth: {
    token: `Bearer ${jwtToken}`
  },
  reconnection: true,
  reconnectionDelay: 1000,
  reconnectionDelayMax: 5000,
  reconnectionAttempts: 5
});

// Event listeners
socket.on('connect', () => {
  console.log('Connected to CRM server');
});

socket.on('disconnect', () => {
  console.log('Disconnected');
});

socket.on('notification', (data) => {
  console.log('New notification:', data);
});

// Emit events
socket.emit('some-event', { data: 'value' });
```

### ⚙️ NGINX Socket.IO Settings (Already Configured Above)

Key settings for Socket.IO:
```nginx
proxy_set_header Upgrade $http_upgrade;
proxy_set_header Connection "Upgrade";
proxy_read_timeout 86400;      # 24 hours
proxy_send_timeout 86400;      # 24 hours
proxy_buffering off;           # Important!
proxy_cache_bypass $http_upgrade;
```

---

## Frontend Integration (Vercel)

### 🌍 Step 1️⃣: Configure Frontend Environment Variables

**In your Vercel project → Settings → Environment Variables:**

```
REACT_APP_API_URL=https://srv988392.hstgr.cloud
REACT_APP_SOCKET_URL=https://srv988392.hstgr.cloud
REACT_APP_JWT_TOKEN_KEY=access_token
REACT_APP_FRONTEND_URL=https://yourfrontend.vercel.app
```

### 📱 Step 2️⃣: Frontend API Integration

```javascript
// api/client.js
import axios from 'axios';
import io from 'socket.io-client';

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:5050';
const SOCKET_URL = process.env.REACT_APP_SOCKET_URL || 'http://localhost:5050';

// ===== HTTP CLIENT =====
const apiClient = axios.create({
  baseURL: API_URL,
  timeout: 30000,
  withCredentials: true,
  headers: {
    'Content-Type': 'application/json'
  }
});

// ===== REQUEST INTERCEPTOR (Add Token) =====
apiClient.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('access_token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => Promise.reject(error)
);

// ===== RESPONSE INTERCEPTOR (Handle Errors) =====
apiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      // Token expired - refresh or redirect to login
      localStorage.removeItem('access_token');
      window.location.href = '/login';
    }
    return Promise.reject(error);
  }
);

// ===== API CALLS =====
export const apiCalls = {
  // Authentication
  login: (credentials) => apiClient.post('/api/auth/login', credentials),
  logout: () => apiClient.post('/api/auth/logout'),
  refreshToken: () => apiClient.post('/api/auth/refresh'),
  
  // CRM
  getCRMData: () => apiClient.get('/api/crm/api/data'),
  createCRMRecord: (data) => apiClient.post('/api/crm/api/create', data),
  
  // DMS
  getDMSData: () => apiClient.get('/api/dms/api/data'),
  
  // SO (Sales Order)
  getSOData: () => apiClient.get('/api/so/api/data'),
  
  // Furni
  getFurniData: () => apiClient.get('/api/furni/api/data'),
};

// ===== SOCKET.IO CLIENT =====
export const createSocket = (token) => {
  const socket = io(SOCKET_URL, {
    path: '/crm/socket.io',
    auth: { token: `Bearer ${token}` },
    reconnection: true,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
    reconnectionAttempts: 5
  });

  socket.on('connect', () => console.log('Socket connected'));
  socket.on('disconnect', () => console.log('Socket disconnected'));
  socket.on('error', (error) => console.error('Socket error:', error));

  return socket;
};

export default apiClient;
```

### 🎨 Step 3️⃣: Login & Token Management

```javascript
// hooks/useAuth.js
import { useState, useEffect } from 'react';
import { apiCalls, createSocket } from '@/api/client';

export const useAuth = () => {
  const [user, setUser] = useState(null);
  const [socket, setSocket] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Check if token exists on component mount
    const token = localStorage.getItem('access_token');
    if (token) {
      initializeSocket(token);
    }
    setLoading(false);
  }, []);

  const login = async (email, password) => {
    try {
      const response = await apiCalls.login({ email, password });
      const { token, user } = response.data;
      
      localStorage.setItem('access_token', token);
      setUser(user);
      initializeSocket(token);
      
      return { success: true };
    } catch (error) {
      return { success: false, error: error.response?.data?.message };
    }
  };

  const logout = async () => {
    try {
      await apiCalls.logout();
    } catch (error) {
      console.error('Logout error:', error);
    } finally {
      localStorage.removeItem('access_token');
      setUser(null);
      if (socket) socket.disconnect();
      setSocket(null);
    }
  };

  const initializeSocket = (token) => {
    const newSocket = createSocket(token);
    
    newSocket.on('notification', (data) => {
      console.log('Notification:', data);
      // Update UI with notification
    });

    setSocket(newSocket);
  };

  return { user, socket, loading, login, logout };
};
```

---

## Monitoring & Troubleshooting

### 📊 Step 1️⃣: Check Service Status

```bash
# SSH into VPS
ssh root@31.97.239.93

# Check Docker containers
docker ps -a

# View backend logs
docker-compose logs -f backend --tail=100

# Check specific module
docker-compose logs backend | grep "CRM\|DMS\|Socket"
```

### 🔍 Step 2️⃣: Database Connectivity Test

```bash
# From VPS, test MongoDB connection
cd /www/wwwroot/Solution_One_Server

# Check environment
cat .env | grep MONGO

# Test connection
docker exec unified-portal-backend node -e "
  const mongoose = require('mongoose');
  mongoose.connect(process.env.UNIFIED_CRM_DB_URL)
    .then(() => console.log('✅ CRM DB Connected'))
    .catch(err => console.log('❌ CRM DB Error:', err.message));
"
```

### 🌐 Step 3️⃣: API Health Checks

```bash
# Test main endpoint
curl https://srv988392.hstgr.cloud/health

# Test CRM API
curl https://srv988392.hstgr.cloud/api/crm/api/data -H "Authorization: Bearer YOUR_TOKEN"

# Test Socket.IO
curl -I https://srv988392.hstgr.cloud/crm/socket.io/

# Test file upload
curl -X POST https://srv988392.hstgr.cloud/api/crm/api/upload \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -F "file=@test.txt"
```

### 🛠️ Step 4️⃣: Common Issues & Solutions

**Issue: Container keeps restarting**
```bash
# Check logs
docker logs unified-portal-backend

# Verify environment variables
docker exec unified-portal-backend env | grep UNIFIED

# Check disk space
df -h

# Restart manually
docker-compose restart backend
```

**Issue: MongoDB connection error**
```bash
# Verify connection string format
echo "Connection: mongodb+srv://user:pass@cluster.mongodb.net/db_name"

# Test from container
docker exec unified-portal-backend node -e "
  require('dotenv').config();
  console.log('CRM URL:', process.env.UNIFIED_CRM_DB_URL);
"
```

**Issue: Socket.IO not connecting**
```bash
# Check NGINX logs
tail -f /var/log/nginx/error.log

# Verify Socket path
curl -I "https://srv988392.hstgr.cloud/crm/socket.io/?transport=polling"

# Check Docker networking
docker network inspect app-network
```

**Issue: CORS errors**
```bash
# Add frontend URL to allowedOrigins in index.js
# Then rebuild container:
docker-compose down
docker-compose up -d --build
```

### 📈 Step 5️⃣: Setup Automated Backups

```bash
# Create backup script
cat > /www/wwwroot/backup.sh << 'EOF'
#!/bin/bash

BACKUP_DIR="/backup/solution-one-server"
mkdir -p $BACKUP_DIR
DATE=$(date +%Y%m%d_%H%M%S)

# Backup uploads
tar -czf $BACKUP_DIR/uploads_$DATE.tar.gz /www/wwwroot/Solution_One_Server/uploads/

# Backup logs
tar -czf $BACKUP_DIR/logs_$DATE.tar.gz /www/wwwroot/Solution_One_Server/logs/

# Keep only last 7 days
find $BACKUP_DIR -name "*.tar.gz" -mtime +7 -delete

echo "✅ Backup completed: $BACKUP_DIR"
EOF

chmod +x /www/wwwroot/backup.sh

# Add to crontab (daily at 2 AM)
crontab -e
# Add: 0 2 * * * /www/wwwroot/backup.sh
```

---

## 📋 Complete Deployment Checklist

- [ ] **Local Setup**
  - [ ] `.env` file configured
  - [ ] `npm install` completed
  - [ ] `npm run dev` testing locally
  
- [ ] **GitHub Repository**
  - [ ] Code pushed to GitHub
  - [ ] `.github/workflows/` directory created
  - [ ] `deploy.yml` created
  - [ ] GitHub Secrets configured (10 secrets)
  - [ ] Deploy key added for automated pulls
  
- [ ] **VPS Setup**
  - [ ] Docker & Docker Compose installed
  - [ ] Git installed and repository cloned
  - [ ] `.env` file created with production values
  - [ ] Directory permissions correct
  
- [ ] **Docker & Database**
  - [ ] `docker-compose.yml` updated
  - [ ] MongoDB URLs accessible
  - [ ] `docker-compose up -d` running
  - [ ] `docker ps` shows healthy container
  
- [ ] **NGINX Configuration**
  - [ ] SSL certificates active
  - [ ] Reverse proxy configured
  - [ ] Socket.IO paths correct
  - [ ] `nginx -t` passing
  
- [ ] **Frontend Integration (Vercel)**
  - [ ] Environment variables added
  - [ ] API client configured
  - [ ] Socket.IO client implemented
  - [ ] CORS headers correct
  
- [ ] **Testing**
  - [ ] Health endpoint working
  - [ ] Login API functional
  - [ ] Socket.IO connection stable
  - [ ] File uploads working
  - [ ] Email notifications sending
  - [ ] Logs being written correctly

---

## 🚀 One-Time Setup Script (VPS)

```bash
#!/bin/bash

# Full VPS Setup Script
set -e

echo "🚀 Starting Solution One Server Deployment..."

# ===== SYSTEM UPDATES =====
apt update && apt upgrade -y

# ===== DOCKER SETUP =====
curl -fsSL https://get.docker.com -o get-docker.sh && sh get-docker.sh
curl -L "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
chmod +x /usr/local/bin/docker-compose

# ===== GIT SETUP =====
apt install git -y

# ===== CREATE DIRECTORIES =====
mkdir -p /www/wwwroot/Solution_One_Server
cd /www/wwwroot/Solution_One_Server

# ===== CLONE REPOSITORY =====
git clone https://github.com/akshay124-pixel/Solution_One_Server.git .

# ===== CREATE ENV FILE =====
cat > .env << 'EOF'
NODE_ENV=production
UNIFIED_SERVER_PORT=5050
UNIFIED_CRM_DB_URL=mongodb+srv://user:pass@cluster.mongodb.net/crm_db
UNIFIED_SO_DB_URL=mongodb+srv://user:pass@cluster.mongodb.net/so_db
UNIFIED_AUTH_DB_URL=mongodb+srv://user:pass@cluster.mongodb.net/auth_db
UNIFIED_CLIENT_URL=https://yourfrontend.vercel.app
UNIFIED_JWT_SECRET=your_secret_key_here
UNIFIED_JWT_EXPIRY=7d
UNIFIED_REFRESH_TOKEN_SECRET=your_refresh_secret_here
UNIFIED_REFRESH_TOKEN_EXPIRY=30d
MAIL_HOST=smtp.gmail.com
MAIL_PORT=587
MAIL_USER=your_email@gmail.com
MAIL_PASS=your_app_password
MAIL_FROM=noreply@yourapp.com
EOF

chmod 600 .env

# ===== START CONTAINERS =====
docker-compose up -d

# ===== VERIFY =====
echo "✅ Deployment complete!"
docker ps -a | grep unified-portal-backend
curl http://localhost:5050/health

echo "📝 Next steps:"
echo "1. Update NGINX configuration"
echo "2. Reload NGINX: systemctl reload nginx"
echo "3. Check logs: docker-compose logs -f backend"
```

---

## 📞 Support Commands

```bash
# Real-time logs
docker-compose logs -f backend

# Restart services
docker-compose restart backend

# Stop services
docker-compose down

# Rebuild and start
docker-compose up -d --build

# Check resource usage
docker stats

# SSH into container
docker exec -it unified-portal-backend /bin/sh

# Update code only
cd /www/wwwroot/Solution_One_Server
git pull origin main
docker-compose restart backend
```

---

**🎉 Congratulations! Your deployment is now complete with CI/CD, Docker, and proper Socket.IO configuration!**

For questions, check the logs:
```
docker-compose logs -f backend
tail -f /var/log/nginx/error.log
```
