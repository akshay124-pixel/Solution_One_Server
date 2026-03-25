# 🚀 Quick Start Deployment Guide (5 Minutes)

## Step 1: VPS Initial Setup (First Time Only)

```bash
# SSH into your VPS
ssh root@31.97.239.93

# Update system
apt update && apt upgrade -y

# Install Docker
curl -fsSL https://get.docker.com | sh

# Install Docker Compose
curl -L "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose && chmod +x /usr/local/bin/docker-compose

# Verify installation
docker --version
docker-compose --version
```

## Step 2: Clone Repository

```bash
# Create deployment directory
mkdir -p /www/wwwroot/Solution_One_Server
cd /www/wwwroot/Solution_One_Server

# Clone from GitHub
git clone https://github.com/akshay124-pixel/Solution_One_Server.git .

# Verify structure
ls -la
```

## Step 3: Add GitHub SSH Key for Auto-Pull

```bash
# Generate SSH key on VPS
ssh-keygen -t ed25519 -N "" -f ~/.ssh/github_deploy_key

# Display and copy public key
cat ~/.ssh/github_deploy_key.pub

# ➕ Add to GitHub:
# Repo → Settings → Deploy keys → Add deploy key
# Paste the public key content
# ✅ Check "Allow write access"

# Make git use this key
git config --global core.sshCommand "ssh -i ~/.ssh/github_deploy_key"
```

## Step 4: Create Environment File

```bash
cd /www/wwwroot/Solution_One_Server

# Create .env file with your actual values
cat > .env << 'EOF'
NODE_ENV=production
UNIFIED_SERVER_PORT=5050

# MongoDB URLs (from MongoDB Atlas)
UNIFIED_CRM_DB_URL=mongodb+srv://username:password@cluster.mongodb.net/crm_db
UNIFIED_SO_DB_URL=mongodb+srv://username:password@cluster.mongodb.net/so_db
UNIFIED_AUTH_DB_URL=mongodb+srv://username:password@cluster.mongodb.net/auth_db

# Frontend URL
UNIFIED_CLIENT_URL=https://yourfrontend.vercel.app

# JWT Secrets (generate: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
UNIFIED_JWT_SECRET=your_64_char_hex_secret_here
UNIFIED_JWT_EXPIRY=7d
UNIFIED_REFRESH_TOKEN_SECRET=another_64_char_hex_secret_here
UNIFIED_REFRESH_TOKEN_EXPIRY=30d

# Email (Gmail example)
MAIL_HOST=smtp.gmail.com
MAIL_PORT=587
MAIL_USER=your_email@gmail.com
MAIL_PASS=your_16_char_app_password
MAIL_FROM=noreply@yourapp.com
EOF

# Secure the file
chmod 600 .env
cat .env  # Verify content is correct
```

## Step 5: Start Services

```bash
cd /www/wwwroot/Solution_One_Server

# Start Docker containers
docker-compose up -d

# Wait 10 seconds for startup
sleep 10

# Check container status
docker ps -a

# View logs (should see "Server listening on port 5050")
docker-compose logs backend

# Test health endpoint
curl http://localhost:5050/health
```

## Step 6: Configure NGINX (Reverse Proxy)

```bash
# Backup existing config (if any)
cp /etc/nginx/sites-available/srv988392.hstgr.cloud /etc/nginx/sites-available/srv988392.hstgr.cloud.backup 2>/dev/null || true

# Create new config
cat > /etc/nginx/sites-available/srv988392.hstgr.cloud << 'NGINX_CONFIG'
# === REDIRECT HTTP TO HTTPS ===
server {
    listen 80;
    server_name srv988392.hstgr.cloud;
    return 301 https://$host$request_uri;
}

# === HTTPS SERVER ===
server {
    listen 443 ssl http2;
    server_name srv988392.hstgr.cloud;
    client_max_body_size 20M;
    
    # SSL Certificates
    ssl_certificate /etc/letsencrypt/live/srv988392.hstgr.cloud/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/srv988392.hstgr.cloud/privkey.pem;
    include /etc/letsencrypt/options-ssl-nginx.conf;
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;

    # === HEALTH CHECK ===
    location /health {
        proxy_pass http://localhost:5050/health;
        access_log off;
    }

    # === CRM API ===
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

    # === SOCKET.IO ===
    location /crm/socket.io/ {
        proxy_pass http://localhost:5050/crm/socket.io/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "Upgrade";
        proxy_set_header Host $host;
        proxy_read_timeout 86400;
        proxy_send_timeout 86400;
        proxy_buffering off;
    }

    # === DMS API ===
    location /api/dms/ {
        proxy_pass http://localhost:5050/api/dms/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }

    # === SO API ===
    location /api/so/ {
        proxy_pass http://localhost:5050/api/so/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }

    # === FURNI API ===
    location /api/furni/ {
        proxy_pass http://localhost:5050/api/furni/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
NGINX_CONFIG

# Test NGINX config
nginx -t

# Reload NGINX
systemctl reload nginx

# Verify
systemctl status nginx
```

## Step 7: Test Everything

```bash
# Test health endpoint
curl https://srv988392.hstgr.cloud/health

# Test login endpoint (should show API response)
curl -X POST https://srv988392.hstgr.cloud/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com"}'

# Test Socket.IO
curl -I https://srv988392.hstgr.cloud/crm/socket.io/
```

## Step 8: Setup GitHub Secrets & CI/CD

**In GitHub repository:**

1. Go to: **Settings → Secrets and variables → Actions**
2. Add these 17 secrets:

```
VPS_HOST = 31.97.239.93
VPS_USER = root
VPS_SSH_PRIVATE_KEY = (your private key)
VPS_DEPLOYMENT_PATH = /www/wwwroot/Solution_One_Server
DOCKER_REGISTRY_USERNAME = (your docker hub username)
DOCKER_REGISTRY_PASSWORD = (your docker hub access token)
MONGO_CRM_URL = (your mongodb url)
MONGO_SO_URL = (your mongodb url)
MONGO_AUTH_URL = (your mongodb url)
JWT_SECRET = (64-char random hex)
REFRESH_TOKEN_SECRET = (64-char random hex)
MAIL_HOST = smtp.gmail.com
MAIL_PORT = 587
MAIL_USER = your_email@gmail.com
MAIL_PASS = (gmail app password)
MAIL_FROM = noreply@yourdomain.com
FRONTEND_URL = https://yourfrontend.vercel.app
```

3. Push code to GitHub:
```bash
cd /www/wwwroot/Solution_One_Server
git add .
git commit -m "Initial deployment setup"
git push origin main
```

## Step 9: Monitor Deployment

```bash
# Check GitHub Actions progress: https://github.com/akshay124-pixel/Solution_One_Server/actions

# On VPS, watch logs:
docker-compose logs -f backend

# Check if container is healthy:
docker healthcheck unified-portal-backend
```

## ✅ Verification Checklist

- [ ] Docker containers running: `docker ps`
- [ ] Health endpoint works: `curl https://srv988392.hstgr.cloud/health`
- [ ] NGINX configured correctly: `nginx -t`
- [ ] Environment variables loaded: `docker-compose config | grep UNIFIED`
- [ ] MongoDB connected: Check logs for "connected"
- [ ] Socket.IO path correct: `/crm/socket.io/`
- [ ] CORS allows frontend: Check for CORS headers in response

## 🆘 Quick Troubleshooting

| Problem | Solution |
|---------|----------|
| Container won't start | `docker-compose logs backend` see error |
| NGINX 502 Bad Gateway | Ensure `localhost:5050` is running |
| Database connection error | Verify `UNIFIED_CRM_DB_URL` in `.env` |
| Socket.IO not connecting | Check NGINX `proxy_buffering off` |
| Deployment not running | Check GitHub Actions logs |

## 📝 Daily Commands

```bash
# Restart services
docker-compose restart backend

# View logs
docker-compose logs -f backend --tail=50

# Update code and redeploy
cd /www/wwwroot/Solution_One_Server
git pull origin main
docker-compose up -d --build

# Check health
curl https://srv988392.hstgr.cloud/health

# Backup data
tar -czf /backup/uploads_$(date +%Y%m%d).tar.gz /www/wwwroot/Solution_One_Server/uploads/
```

---

**🎉 That's it! Your application is now deployed!**

Next: Configure your Vercel frontend to use these endpoints.

See [DEPLOYMENT_GUIDE_HINGLISH.md](./DEPLOYMENT_GUIDE_HINGLISH.md) for complete details.
