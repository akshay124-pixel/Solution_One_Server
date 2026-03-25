# 📚 Solution One Server - Complete Deployment Documentation

## 🎯 Quick Navigation

This documentation provides everything you need to deploy your application to production. Read the guides in this order:

### For Fresh Setup (20-30 Minutes)
1. **[QUICKSTART.md](./QUICKSTART.md)** ⚡ START HERE
   - 5-minute VPS setup
   - Clone repository
   - Start Docker containers
   - Configure NGINX
   - 9 easy steps

2. **[GITHUB_SECRETS_SETUP.md](./GITHUB_SECRETS_SETUP.md)** 🔐
   - How to add GitHub Secrets
   - Generate SSH keys
   - MongoDB connection strings
   - Email configuration
   - Step-by-step with examples

3. **[FRONTEND_INTEGRATION.md](./FRONTEND_INTEGRATION.md)** 🌍
   - Connect Vercel frontend to backend
   - API client setup
   - Socket.IO configuration
   - Authentication hooks
   - Real-time notifications

### For Complete Understanding (1-2 Hours)
4. **[DEPLOYMENT_GUIDE_HINGLISH.md](./DEPLOYMENT_GUIDE_HINGLISH.md)** 📖
   - Complete Hinglish guide
   - Project architecture overview
   - Docker deep-dive
   - GitHub Actions CI/CD setup
   - VPS deployment
   - Socket.IO configuration
   - Monitoring & troubleshooting

---

## 📦 What's in This Repository

```
Solution_One_Server/
├── crm/              → CRM Module
├── dms/              → DMS/Smartflo Module
├── furni/            → Furniture Module
├── so/               → Sales Order Module
├── models/           → Unified User Models
├── routes/           → Authentication Routes
├── middleware/       → Global Middleware
├── utils/            → Database & Validation
├── index.js          → Express Server (Port 5050)
├── Dockerfile        → Container Definition
├── docker-compose.yml→ Docker Orchestration
└── .env              → Environment Variables (CREATE THIS)
```

---

## 🚀 Technology Stack

| Component | Technology | Version |
|-----------|-----------|---------|
| Runtime | Node.js | 18-alpine |
| Framework | Express | 4.21.2 |
| Database | MongoDB | (Atlas/Local) |
| Real-time | Socket.IO | 4.8.1 |
| Authentication | JWT | jsonwebtoken 9.0.2 |
| Container | Docker | Latest |
| CI/CD | GitHub Actions | Built-in |
| Frontend Hosting | Vercel | Latest |
| Reverse Proxy | NGINX | (VPS) |

---

## 📋 Pre-requisites

Before starting, you need:

- ✅ **VPS Access**: SSH key for `root@31.97.239.93`
- ✅ **GitHub Account**: repo at https://github.com/akshay124-pixel/Solution_One_Server
- ✅ **MongoDB**: Connection strings for 3 databases (CRM, SO, Auth)
- ✅ **Docker Hub Account**: For image storage
- ✅ **Email Account**: Gmail or other SMTP (for notifications)
- ✅ **Vercel Frontend**: Already hosted or ready to deploy
- ✅ **Domain Name**: srv988392.hstgr.cloud (Already configured)
- ✅ **SSL Certificates**: Let's Encrypt certificates (Already set up)

---

## 🔄 Deployment Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    Your Users                           │
│                     (Browser)                           │
└─────────────────┬───────────────────────────────────────┘
                  │
          ┌───────▼────────┐
          │   VERCEL CDN   │
          │   (Frontend)   │
          └───────┬────────┘
                  │ HTTPS
    ┌─────────────▼──────────────┐
    │   NGINX Reverse Proxy      │
    │  srv988392.hstgr.cloud     │
    │  (VPS)                     │
    │                            │
    │  ┌────────────────┐        │
    │  │ /api/crm/*     │        │
    │  │ /crm/socket.io │        │
    │  │ /api/dms/*     │        │
    │  │ /api/so/*      │        │
    │  │ /api/furni/*   │        │
    │  └───────┬────────┘        │
    └──────────┼─────────────────┘
               │
        ┌──────▼─────────┐
        │    Docker      │
        │  Container     │
        │                │
        │ Node.js 18     │
        │ Express 4.21   │
        │ Port: 5050     │
        │                │
        └──────┬─────────┘
               │
      ┌────────┴────────┐
      │                 │
      │                 │
  ┌───▼────┐      ┌─────▼──┐
  │ MongoDB │      │ SMTP   │
  │ Cluster │      │ Server │
  │  (Auth) │      │(Emails)│
  └────┬────┘      └────────┘
       │
  ┌────┴────────┐
  │   Other DB  │
  │  (CRM, SO)  │
  └─────────────┘
```

---

## ⏱️ Estimated Timeline

| Task | Time | Status |
|------|------|--------|
| VPS Setup | 5 min | 🔷 Do First |
| Repository Clone | 2 min | 🔷 Do Second |
| Environment Config | 5 min | 🔷 Do Third |
| Docker Setup | 3 min | 🔷 Do Fourth |
| NGINX Config | 5 min | 🔷 Do Fifth |
| GitHub Secrets | 10 min | 🔷 Do Sixth |
| GitHub Actions | 5 min | 🔷 Do Seventh |
| Frontend Integration | 15 min | 🔷 Do Eighth |
| Testing & Verification | 10 min | 🔷 Final |
| **Total** | **~60 min** | ⭐ |

---

## 🎯 Step-by-Step Quick Reference

### Day 1: Initial Setup (30 min)
```bash
# 1. SSH into VPS
ssh root@31.97.239.93

# 2. Install Docker (5 min)
curl -fsSL https://get.docker.com | sh

# 3. Clone repo (2 min)
cd /www/wwwroot/Solution_One_Server
git clone https://github.com/akshay124-pixel/Solution_One_Server.git .

# 4. Create .env (5 min)
cat > .env << 'EOF'
NODE_ENV=production
UNIFIED_SERVER_PORT=5050
# ... (Add all variables from QUICKSTART.md)
EOF

# 5. Start containers (3 min)
docker-compose up -d

# 6. Verify health (1 min)
curl http://localhost:5050/health
```

### Day 2: CI/CD & Automation (20 min)
```bash
# 1. Add GitHub Secrets (10 min)
# Via GitHub Web UI: Settings → Secrets and variables → Actions

# 2. Configure GitHub SSH Key (5 min)
# For auto-pull on deployment (see GITHUB_SECRETS_SETUP.md)

# 3. Deploy!
git push origin main
# GitHub Actions will automatically build, test, and deploy
```

### Day 3: Frontend Integration (15 min)
```bash
# 1. Update Vercel environment variables
# Via Vercel Dashboard: Project → Settings → Environment Variables

# 2. Add API client to your React app
# Copy from FRONTEND_INTEGRATION.md

# 3. Redeploy Vercel app
git push  # Vercel auto-redeploys
```

---

## 📊 Service Endpoints

### API Endpoints

| Module | Endpoint | Purpose |
|--------|----------|---------|
| **Auth** | `/api/auth/*` | Login, Signup, JWT verification |
| **CRM** | `/api/crm/api/*` | CRM data operations |
| **DMS** | `/api/dms/api/*` | Dialer & call management |
| **SO** | `/api/so/api/*` | Sales orders |
| **Furni** | `/api/furni/api/*` | Furniture inventory |
| **Health** | `/health` | Server health check |

### Socket.IO Events

| Event | Direction | Data | Purpose |
|-------|-----------|------|---------|
| `connect` | ← | - | Socket connected |
| `disconnect` | ← | - | Socket disconnected |
| `notification` | ← | `{message, type}` | Real-time notifications |
| `attendance_update` | ← | `{data}` | Employee attendance |
| `user_status_changed` | ← | `{status}` | User online/offline |
| `meeting_scheduled` | ← | `{meeting}` | Meeting notifications |

---

## 🔒 Security Checklist

- [ ] SSH key protected with passphrase
- [ ] GitHub secrets never logged
- [ ] Database passwords changed from defaults
- [ ] JWT secrets are 64-character random strings
- [ ] HTTPS only (HTTP redirects to HTTPS)
- [ ] CORS properly configured
- [ ] Database backups enabled
- [ ] Rate limiting active
- [ ] Input sanitization in place
- [ ] Helmet.js headers configured

---

## 📈 Monitoring & Maintenance

### Daily Tasks
```bash
# Check service health
curl https://srv988392.hstgr.cloud/health

# View logs
docker-compose logs -f backend --tail=50

# Check container status
docker ps -a
```

### Weekly Tasks
```bash
# Backup uploads
tar -czf /backup/uploads_$(date +%Y%m%d).tar.gz uploads/

# Check logs for errors
docker-compose logs backend | grep ERROR
```

### Monthly Tasks
```bash
# Update packages
npm update

# Update Docker image
docker-compose pull
docker-compose up -d

# Review security patches
docker scan unified-portal-backend
```

---

## 🆘 Troubleshooting Guide

### Container not starting?
```bash
docker-compose logs backend
# Check if port 5050 is in use
lsof -i :5050
```

### NGINX 502 error?
```bash
# Ensure backend is running
docker ps | grep unified-portal-backend

# Check NGINX config
nginx -t

# View NGINX logs
tail -f /var/log/nginx/error.log
```

### Database connection failed?
```bash
# Verify environment variables
docker-compose config | grep MONGO

# Test connection from container
docker exec unified-portal-backend mongosh "$MONGO_CRM_URL"
```

### Socket.IO not connecting?
```bash
# Check NGINX configuration has proper settings
cat /etc/nginx/sites-available/srv988392.hstgr.cloud

# Verify Socket.IO path
curl -I https://srv988392.hstgr.cloud/crm/socket.io/
```

---

## 📞 Support Resources

### Documentation
- [QUICKSTART.md](./QUICKSTART.md) - Fast setup
- [DEPLOYMENT_GUIDE_HINGLISH.md](./DEPLOYMENT_GUIDE_HINGLISH.md) - Complete guide
- [GITHUB_SECRETS_SETUP.md](./GITHUB_SECRETS_SETUP.md) - Secrets configuration
- [FRONTEND_INTEGRATION.md](./FRONTEND_INTEGRATION.md) - React integration

### External Resources
- [Express.js Docs](https://expressjs.com/)
- [Socket.IO Documentation](https://socket.io/docs/)
- [MongoDB Atlas Guide](https://docs.mongodb.com/atlas/)
- [Docker Documentation](https://docs.docker.com/)
- [GitHub Actions Docs](https://docs.github.com/en/actions)
- [NGINX Reverse Proxy](https://nginx.org/en/docs/http/ngx_http_proxy_module.html)

### Community Help
- GitHub Issues: [Your Repo](https://github.com/akshay124-pixel/Solution_One_Server/issues)
- Stack Overflow: Tag with `node.js`, `express`, `socket.io`

---

## 🎉 You're All Set!

Follow the guides in order:
1. **[QUICKSTART.md](./QUICKSTART.md)** (5 min)
2. **[GITHUB_SECRETS_SETUP.md](./GITHUB_SECRETS_SETUP.md)** (10 min)  
3. **[FRONTEND_INTEGRATION.md](./FRONTEND_INTEGRATION.md)** (15 min)

Then deploy:
```bash
git push origin main
# GitHub Actions handles the rest!
```

---

**Last Updated:** March 2026  
**Status:** ✅ Production Ready  
**Backend:** Node.js + Express + MongoDB  
**Deployment:** Docker + GitHub Actions + NGINX  
**Frontend:** Vercel + React/Next.js  

🚀 **Happy Deploying!**
