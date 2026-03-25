# GitHub Secrets Configuration Guide

## 📋 Required Secrets for CI/CD Deployment

Your GitHub repository requires these secrets to be configured for automated deployment. Follow the steps below to add each secret.

### 🔗 How to Add Secrets

1. Go to: **GitHub Repo → Settings → Secrets and variables → Actions**
2. Click **New repository secret**
3. Add each secret with the exact names below
4. Never commit secrets to the repository

---

## 📱 VPS Configuration Secrets

### 1. `VPS_HOST`
**Value:** `31.97.239.93`
**Description:** Your VPS IP address
```
31.97.239.93
```

### 2. `VPS_USER`
**Value:** `root`
**Description:** SSH user for VPS access
```
root
```

### 3. `VPS_PORT` (Optional)
**Value:** `22`
**Description:** SSH port (default is 22)
```
22
```

### 4. `VPS_SSH_PRIVATE_KEY`
**Description:** Your SSH private key for VPS authentication
**Steps to generate:**

```bash
# On your local machine, generate SSH key (if you don't have one)
ssh-keygen -t ed25519 -f ~/.ssh/vps_deploy_key -N ""

# Display the private key
cat ~/.ssh/vps_deploy_key

# Copy the entire output (including -----BEGIN... and -----END...)
# Paste it as the secret value
```

**Add public key to VPS:**
```bash
# Copy public key
cat ~/.ssh/vps_deploy_key.pub

# SSH into VPS
ssh root@31.97.239.93

# Add public key to authorized_keys
echo "your_public_key_here" >> ~/.ssh/authorized_keys
chmod 600 ~/.ssh/authorized_keys
chmod 700 ~/.ssh

# Test connection
ssh -i ~/.ssh/vps_deploy_key root@31.97.239.93
```

### 5. `VPS_DEPLOYMENT_PATH`
**Value:** `/www/wwwroot/Solution_One_Server`
**Description:** Deployment directory path on VPS
```
/www/wwwroot/Solution_One_Server
```

---

## 🐳 Docker Hub Secrets

### 6. `DOCKER_REGISTRY_USERNAME`
**Description:** Your Docker Hub username
```
your_dockerhub_username
```

**Steps to get/create:**
1. Go to https://hub.docker.com
2. Sign up or login
3. Go to Account Settings → Security
4. Create access token: https://hub.docker.com/settings/security

### 7. `DOCKER_REGISTRY_PASSWORD`
**Description:** Docker Hub access token/password
```
dckr_pat_xxxxxxxxxxxxxxxxxxxxx
```

**Generate access token:**
1. https://hub.docker.com/settings/security
2. Click "New Access Token"
3. Name it: `solution-one-server-github-actions`
4. Select permissions: `Read & Write`
5. Copy the token and use as secret value

---

## 🗄️ Database Secrets

### 8. `MONGO_CRM_URL`
**Description:** MongoDB connection string for CRM database
```
mongodb+srv://username:password@cluster.mongodb.net/crm_db?retryWrites=true&w=majority
```

**Steps to get from MongoDB Atlas:**
1. Go to https://cloud.mongodb.com
2. Create or select project
3. Click "Connect"
4. Choose "Connect your application"
5. Copy the connection string
6. Replace `<username>`, `<password>`, `<dbname>`

Replace with your actual values:
- `username` → Your MongoDB user
- `password` → Your MongoDB password
- `cluster` → Your cluster name
- `crm_db` → Database name

### 9. `MONGO_SO_URL`
**Description:** MongoDB connection string for Sales Order database
```
mongodb+srv://username:password@cluster.mongodb.net/so_db?retryWrites=true&w=majority
```

Same as above but for `so_db` database.

### 10. `MONGO_AUTH_URL`
**Description:** MongoDB connection string for Authentication database
```
mongodb+srv://username:password@cluster.mongodb.net/auth_db?retryWrites=true&w=majority
```

Same as above but for `auth_db` database.

---

## 🔐 JWT Secrets

### 11. `JWT_SECRET`
**Description:** Secret key for JWT token signing
**Steps to generate:**

```bash
# Use one of these methods:

# Method 1: Node.js
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# Method 2: OpenSSL
openssl rand -hex 32

# Method 3: Online (LESS SECURE - use local only)
# https://www.random.org/bytes/ (copy 32 bytes)
```

**Value format:** 64-character hex string
```
a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6r7s8t9u0v1w2x3y4z5a6b7c8d9e0f1g2h3
```

### 12. `REFRESH_TOKEN_SECRET`
**Description:** Secret key for refresh token signing
**Generate same way as JWT_SECRET:**

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Value format: Another 64-character hex string
```
f1e2d3c4b5a6g7h8i9j0k1l2m3n4o5p6r7s8t9u0v1w2x3y4z5a6b7c8d9e0f1g2h3
```

---

## 📧 Email Configuration Secrets

### 13. `MAIL_HOST`
**Description:** SMTP server address
```
smtp.gmail.com
```

Also supports:
- `smtp.office365.com` (Microsoft 365)
- `smtp.mail.yahoo.com` (Yahoo)
- Your custom mail server

### 14. `MAIL_PORT`
**Description:** SMTP port
```
587
```

Common ports:
- `587` - TLS (Recommended)
- `465` - SSL
- `25` - Unencrypted (Avoid)

### 15. `MAIL_USER`
**Description:** Email address for sending
```
your_email@gmail.com
```

### 16. `MAIL_PASS`
**Description:** Email password or app password

**For Gmail:**
1. Enable 2-Factor Authentication
2. Go to https://myaccount.google.com/apppasswords
3. Select Mail → Windows Computer (or other)
4. Copy the 16-character app password
```
abcd efgh ijkl mnop
```

**For Microsoft 365:**
- Use your Microsoft account password or generate app-specific password

### 17. `MAIL_FROM`
**Description:** "From" address for emails
```
noreply@yourdomain.com
```

---

## 🌍 Frontend Configuration

### 18. `FRONTEND_URL`
**Description:** Your Vercel frontend URL
```
https://yourfrontend.vercel.app
```

Or if using Vercel preview:
```
https://solution-one-seven.vercel.app
```

---

## ✅ Complete Secrets Checklist

Create all 12-18 secrets in your GitHub repository:

| # | Secret Name | Value | Priority |
|---|---|---|---|
| 1 | `VPS_HOST` | 31.97.239.93 | ⭐⭐⭐ |
| 2 | `VPS_USER` | root | ⭐⭐⭐ |
| 3 | `VPS_SSH_PRIVATE_KEY` | (private key content) | ⭐⭐⭐ |
| 4 | `VPS_DEPLOYMENT_PATH` | /www/wwwroot/Solution_One_Server | ⭐⭐⭐ |
| 5 | `DOCKER_REGISTRY_USERNAME` | docker_username | ⭐⭐ |
| 6 | `DOCKER_REGISTRY_PASSWORD` | dckr_pat_... | ⭐⭐ |
| 7 | `MONGO_CRM_URL` | mongodb+srv://... | ⭐⭐⭐ |
| 8 | `MONGO_SO_URL` | mongodb+srv://... | ⭐⭐⭐ |
| 9 | `MONGO_AUTH_URL` | mongodb+srv://... | ⭐⭐⭐ |
| 10 | `JWT_SECRET` | (64-char hex) | ⭐⭐⭐ |
| 11 | `REFRESH_TOKEN_SECRET` | (64-char hex) | ⭐⭐⭐ |
| 12 | `MAIL_HOST` | smtp.gmail.com | ⭐⭐ |
| 13 | `MAIL_PORT` | 587 | ⭐⭐ |
| 14 | `MAIL_USER` | your_email@gmail.com | ⭐⭐ |
| 15 | `MAIL_PASS` | app_password | ⭐⭐ |
| 16 | `MAIL_FROM` | noreply@yourdomain.com | ⭐⭐ |
| 17 | `FRONTEND_URL` | https://yourfrontend.vercel.app | ⭐⭐⭐ |

---

## 🔍 Testing Secrets

### Verify Database Connection
```bash
# SSH into VPS
ssh root@31.97.239.93

# Test MongoDB connection
cd /www/wwwroot/Solution_One_Server

docker exec unified-portal-backend node -e "
  const mongoose = require('mongoose');
  
  async function test() {
    try {
      await mongoose.connect(process.env.MONGO_CRM_URL);
      console.log('✅ CRM DB Connected');
      process.exit(0);
    } catch (err) {
      console.log('❌ Error:', err.message);
      process.exit(1);
    }
  }
  
  test();
"
```

### Verify Email Configuration
```bash
# Test email sending
docker exec unified-portal-backend node -e "
  const nodemailer = require('nodemailer');
  
  const transporter = nodemailer.createTransport({
    host: process.env.MAIL_HOST,
    port: process.env.MAIL_PORT,
    secure: true,
    auth: {
      user: process.env.MAIL_USER,
      pass: process.env.MAIL_PASS
    }
  });
  
  transporter.verify((error, success) => {
    if (error) {
      console.log('❌ Email Config Error:', error);
    } else {
      console.log('✅ Email Config OK');
    }
    process.exit(0);
  });
"
```

---

## 🚀 After Adding All Secrets

1. Push code to GitHub:
```bash
git add .
git commit -m "Add deployment configuration"
git push origin main
```

2. GitHub Actions will automatically:
   - Build and test the application
   - Build Docker image
   - Push to Docker Hub
   - Deploy to your VPS
   - Run health checks

3. Monitor deployment:
   - Go to **Actions** tab in GitHub
   - Click on latest workflow run
   - Watch real-time deployment progress

---

## 🆘 Troubleshooting

### "Authentication failed" error
- Check SSH private key format (starts with `-----BEGIN`)
- Ensure public key is in VPS `~/.ssh/authorized_keys`

### "Could not resolve hostname"
- Verify `VPS_HOST` IP is correct
- Check firewall rules on VPS

### "Docker pull failed"
- Verify Docker Hub credentials are correct
- Check repository exists: `docker.io/username/solution-one-server`

### "Database connection timeout"
- Verify MongoDB URL format is correct
- Check MongoDB cluster allows IP 31.97.239.93
- Test connection from VPS manually

### "JWT secret not found"
- Ensure secrets are added before deploying
- Secrets are not visible in logs for security

---

## 🔒 Security Best Practices

✅ **DO:**
- Rotate secrets periodically
- Use strong random values
- Never commit `.env` files
- Use environment-specific secrets

❌ **DON'T:**
- Share secrets with anyone
- Commit secrets to GitHub
- Use simple passwords
- Reuse same secrets across projects

---

For more help, see [DEPLOYMENT_GUIDE_HINGLISH.md](./DEPLOYMENT_GUIDE_HINGLISH.md)
