# ⚡ Quick Reference Card

## 🎯 Start Here (Choose Your Path)

### I want to deploy right now! (5 min)
→ Read **[QUICKSTART.md](./QUICKSTART.md)**

### I want to understand everything (1 hour)
→ Read **[DEPLOYMENT_GUIDE_HINGLISH.md](./DEPLOYMENT_GUIDE_HINGLISH.md)**

### I want to setup CI/CD automation
→ Read **[GITHUB_SECRETS_SETUP.md](./GITHUB_SECRETS_SETUP.md)** + **[deploy.yml](./.github/workflows/deploy.yml)**

### I want to connect my frontend
→ Read **[FRONTEND_INTEGRATION.md](./FRONTEND_INTEGRATION.md)**

---

## 📱 Essential Commands

### SSH into VPS
```bash
ssh root@31.97.239.93
```

### Navigate to project
```bash
cd /www/wwwroot/Solution_One_Server
```

### Check container status
```bash
docker ps -a
docker-compose ps
```

### View logs in real-time
```bash
docker-compose logs -f backend
docker-compose logs backend --tail=50
```

### Restart services
```bash
docker-compose restart backend
docker-compose down && docker-compose up -d
```

### Test health endpoint
```bash
curl http://localhost:5050/health
curl https://srv988392.hstgr.cloud/health
```

### Test API
```bash
curl https://srv988392.hstgr.cloud/api/auth/verify
```

### Test Socket.IO
```bash
curl -I https://srv988392.hstgr.cloud/crm/socket.io/
```

### Update code and redeploy
```bash
cd /www/wwwroot/Solution_One_Server
git pull origin main
docker-compose up -d --build
```

### View container stats
```bash
docker stats unified-portal-backend
```

### Enter container shell
```bash
docker exec -it unified-portal-backend /bin/sh
```

### Stop everything
```bash
docker-compose down
```

---

## 🔐 Environment Variables (Required)

```bash
# Server
NODE_ENV=production
UNIFIED_SERVER_PORT=5050

# Databases (3 separate)
UNIFIED_CRM_DB_URL=mongodb+srv://user:pass@cluster/crm_db
UNIFIED_SO_DB_URL=mongodb+srv://user:pass@cluster/so_db
UNIFIED_AUTH_DB_URL=mongodb+srv://user:pass@cluster/auth_db

# Frontend
UNIFIED_CLIENT_URL=https://yourfrontend.vercel.app

# JWT
UNIFIED_JWT_SECRET=64_char_random_hex
UNIFIED_JWT_EXPIRY=7d
UNIFIED_REFRESH_TOKEN_SECRET=64_char_random_hex
UNIFIED_REFRESH_TOKEN_EXPIRY=30d

# Email
MAIL_HOST=smtp.gmail.com
MAIL_PORT=587
MAIL_USER=your_email@gmail.com
MAIL_PASS=app_password
MAIL_FROM=noreply@yourdomain.com
```

---

## 🐳 Docker Quick Reference

| Command | Purpose |
|---------|---------|
| `docker ps` | List running containers |
| `docker ps -a` | List all containers |
| `docker logs ID` | View logs |
| `docker exec -it ID /bin/sh` | Enter container |
| `docker build .` | Build image |
| `docker-compose up -d` | Start all services |
| `docker-compose down` | Stop all services |
| `docker-compose restart` | Restart services |
| `docker images` | List images |
| `docker rm ID` | Remove container |
| `docker rmi ID` | Remove image |

---

## 🔗 Important URLs

| Purpose | URL |
|---------|-----|
| **Backend Health** | https://srv988392.hstgr.cloud/health |
| **CRM API** | https://srv988392.hstgr.cloud/api/crm/ |
| **DMS API** | https://srv988392.hstgr.cloud/api/dms/ |
| **SO API** | https://srv988392.hstgr.cloud/api/so/ |
| **Furni API** | https://srv988392.hstgr.cloud/api/furni/ |
| **Auth API** | https://srv988392.hstgr.cloud/api/auth/ |
| **Socket.IO** | https://srv988392.hstgr.cloud/crm/socket.io |
| **GitHub Repo** | https://github.com/akshay124-pixel/Solution_One_Server |
| **GitHub Actions** | https://github.com/akshay124-pixel/Solution_One_Server/actions |
| **Docker Hub** | https://hub.docker.com/r/username/solution-one-server |

---

## 📊 Service Architecture

```
Frontend (Vercel)
    ↓ HTTPS
NGINX Reverse Proxy (VPS)
    ↓ HTTP
Docker Container (Node.js)
    ├→ CRM Module (/api/crm)
    ├→ DMS Module (/api/dms)
    ├→ SO Module (/api/so)
    ├→ Furni Module (/api/furni)
    └→ Socket.IO (/crm/socket.io)
    ↓
MongoDB (3 Databases)
    ├→ crm_db
    ├→ so_db
    └→ auth_db
```

---

## 🔒 GitHub Secrets (17 Total)

**VPS Access (4):**
- `VPS_HOST` = 31.97.239.93
- `VPS_USER` = root
- `VPS_SSH_PRIVATE_KEY` = (private key)
- `VPS_DEPLOYMENT_PATH` = /www/wwwroot/Solution_One_Server

**Docker Hub (2):**
- `DOCKER_REGISTRY_USERNAME` = your_username
- `DOCKER_REGISTRY_PASSWORD` = dckr_pat_xxx

**Databases (3):**
- `MONGO_CRM_URL` = mongodb+srv://...
- `MONGO_SO_URL` = mongodb+srv://...
- `MONGO_AUTH_URL` = mongodb+srv://...

**JWT (2):**
- `JWT_SECRET` = 64-char hex
- `REFRESH_TOKEN_SECRET` = 64-char hex

**Email (4):**
- `MAIL_HOST` = smtp.gmail.com
- `MAIL_PORT` = 587
- `MAIL_USER` = your_email@gmail.com
- `MAIL_PASS` = app_password
- `MAIL_FROM` = noreply@domain.com

**Frontend (1):**
- `FRONTEND_URL` = https://yourfrontend.vercel.app

---

## ⚠️ Common Issues & Fixes

### 502 Bad Gateway
```bash
# Check if backend is running
docker ps | grep unified-portal-backend

# Restart backend
docker-compose restart backend

# Check NGINX config
nginx -t
systemctl reload nginx
```

### 401 Unauthorized
```bash
# Token might be expired
# Frontend should refresh token automatically
# Or user needs to login again
```

### Connection Refused
```bash
# Port might be in use
lsof -i :5050

# Or container not started
docker-compose up -d
sleep 10
docker ps
```

### Database Connection Error
```bash
# Check .env variables
cat .env | grep MONGO

# Test from container
docker exec unified-portal-backend \
  node -e "console.log(process.env.UNIFIED_CRM_DB_URL)"
```

### Socket.IO Not Connecting
```bash
# Check NGINX has WebSocket headers
grep "proxy_buffering off" /etc/nginx/sites-available/srv988392.hstgr.cloud

# Reload NGINX
systemctl reload nginx
```

---

## 📈 Performance Monitoring

### Check Resource Usage
```bash
# CPU & Memory
docker stats unified-portal-backend

# Disk usage
df -h
du -sh /www/wwwroot/Solution_One_Server
```

### View Error Logs
```bash
# Application errors
docker-compose logs backend | grep ERROR

# NGINX errors
tail -f /var/log/nginx/error.log

# MongoDB connection issues
docker-compose logs backend | grep mongodb
```

### Test API Response Time
```bash
# Time API response
time curl https://srv988392.hstgr.cloud/health

# Load test (basic)
for i in {1..100}; do curl https://srv988392.hstgr.cloud/health; done
```

---

## 🔄 Deployment Pipeline

```
┌──────────────────┐
│  Push to GitHub  │
└────────┬─────────┘
         ↓
┌──────────────────┐     ┌──────────────────┐
│  GitHub Actions  │────→│  Build & Test    │
└────────┬─────────┘     └──────────────────┘
         ↓
┌──────────────────┐     ┌──────────────────┐
│  Build Docker    │────→│  Push to Hub     │
└────────┬─────────┘     └──────────────────┘
         ↓
┌──────────────────┐
│  SSH to VPS      │
└────────┬─────────┘
         ↓
┌──────────────────┐
│  Pull Latest     │
│  Code & Image    │
└────────┬─────────┘
         ↓
┌──────────────────┐
│  Start Containers│
└────────┬─────────┘
         ↓
┌──────────────────┐
│  Health Check    │
└──────────────────┘
```

---

## 📝 File Locations

| File | Location | Purpose |
|------|----------|---------|
| `.env` | `/www/wwwroot/Solution_One_Server/.env` | Environment variables |
| `docker-compose.yml` | `/www/wwwroot/Solution_One_Server/` | Container config |
| NGINX config | `/etc/nginx/sites-available/srv988392.hstgr.cloud` | Reverse proxy |
| Logs | `/www/wwwroot/Solution_One_Server/logs/` | Application logs |
| Uploads | `/www/wwwroot/Solution_One_Server/uploads/` | User uploads |
| GitHub Actions | `.github/workflows/deploy.yml` | CI/CD pipeline |

---

## 🎯 Deployment Checklist

**Before Deployment:**
- [ ] All environment variables set
- [ ] GitHub secrets configured
- [ ] MongoDB databases created
- [ ] Email account setup
- [ ] Frontend URL correct

**During Deployment:**
- [ ] Git push to main branch
- [ ] GitHub Actions running
- [ ] Docker image building
- [ ] VPS receiving code

**After Deployment:**
- [ ] Health endpoint returning 200
- [ ] Docker containers running
- [ ] NGINX proxying correctly
- [ ] Socket.IO connecting
- [ ] API endpoints responding

---

## 🔗 Quick Links

- **[QUICKSTART.md](./QUICKSTART.md)** - Fast 5-minute setup
- **[DEPLOYMENT_GUIDE_HINGLISH.md](./DEPLOYMENT_GUIDE_HINGLISH.md)** - Complete guide in Hinglish
- **[GITHUB_SECRETS_SETUP.md](./GITHUB_SECRETS_SETUP.md)** - All 17 secrets explained
- **[FRONTEND_INTEGRATION.md](./FRONTEND_INTEGRATION.md)** - Connect React/Next.js
- **[README_DEPLOYMENT.md](./README_DEPLOYMENT.md)** - Overview & navigation

---

## 📞 Need Help?

1. **Check logs**: `docker-compose logs backend`
2. **Read guide**: [DEPLOYMENT_GUIDE_HINGLISH.md](./DEPLOYMENT_GUIDE_HINGLISH.md)
3. **GitHub Issues**: [Report problem](https://github.com/akshay124-pixel/Solution_One_Server/issues)
4. **Test health**: `curl https://srv988392.hstgr.cloud/health`

---

**Always backup before major changes!**

```bash
tar -czf /backup/before_$(date +%Y%m%d_%H%M%S).tar.gz /www/wwwroot/Solution_One_Server
```

---

**Happy Deploying! 🚀**
