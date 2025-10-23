# Railway Deployment Guide 🚂

## 🔧 Backend Configuration

### Railway Settings

1. **Root Directory**: 
   ```
   flask-react-supabase-app/backend
   ```
   OR if your repo root is `flask-react-supabase-app`:
   ```
   backend
   ```

2. **Start Command**:
   ```bash
   gunicorn app:app --bind 0.0.0.0:$PORT --workers 2 --timeout 120
   ```

3. **Build Command** (if needed):
   ```bash
   pip install -r requirements.txt
   ```

4. **Environment Variables** (Add these in Railway):
   ```
   SUPABASE_URL=https://ltjatsyhpmvewancqdjw.supabase.co
   SUPABASE_KEY=your_anon_key_here
   SUPABASE_JWT_SECRET=your_jwt_secret_here
   SUPABASE_SERVICE_ROLE_KEY=your_service_role_key_here
   FLASK_SECRET_KEY=your_random_secret_key_here
   FLASK_ENV=production
   PORT=8000
   ```

### Alternative Start Commands

**Option 1: Using wsgi.py** (Recommended)
```bash
gunicorn wsgi:app --bind 0.0.0.0:$PORT --workers 2 --timeout 120
```

**Option 2: Direct app.py**
```bash
gunicorn app:app --bind 0.0.0.0:$PORT --workers 2 --timeout 120
```

**Option 3: With more workers for production**
```bash
gunicorn app:app --bind 0.0.0.0:$PORT --workers 4 --threads 2 --timeout 120 --access-logfile - --error-logfile -
```

---

## 🎨 Frontend Configuration

### Railway Settings

1. **Root Directory**:
   ```
   flask-react-supabase-app/frontend
   ```
   OR:
   ```
   frontend
   ```

2. **Build Command**:
   ```bash
   npm install && npm run build
   ```

3. **Start Command**:
   ```bash
   npm start
   ```
   OR for production with serve:
   ```bash
   npx serve -s build -l $PORT
   ```

4. **Environment Variables**:
   ```
   REACT_APP_API_URL=https://your-backend-url.railway.app
   REACT_APP_SUPABASE_URL=https://ltjatsyhpmvewancqdjw.supabase.co
   REACT_APP_SUPABASE_KEY=your_anon_key_here
   NODE_ENV=production
   ```

---

## 🐛 Troubleshooting

### Error: "ModuleNotFoundError: No module named 'main'"

**Cause**: Gunicorn is looking for `main:app` but your file is `app.py`

**Fix**: Change start command to:
```bash
gunicorn app:app --bind 0.0.0.0:$PORT
```

### Error: "Worker failed to boot"

**Causes**:
1. Wrong root directory
2. Missing dependencies
3. Wrong module path

**Fixes**:
1. Set Root Directory to `backend` or `flask-react-supabase-app/backend`
2. Ensure `requirements.txt` is in the root directory
3. Use `gunicorn app:app` not `gunicorn main:app`

### Error: "Address already in use"

**Fix**: Railway automatically sets `$PORT`, don't hardcode it:
```bash
gunicorn app:app --bind 0.0.0.0:$PORT
```

### Error: "pkg_resources is deprecated"

**Fix**: This is just a warning, not an error. Update setuptools:
```bash
pip install --upgrade setuptools
```
Add to `requirements.txt`:
```
setuptools>=65.0.0
```

---

## 📦 Required Files

### Backend Files Checklist
- ✅ `app.py` - Main Flask application
- ✅ `wsgi.py` - WSGI entry point (optional but recommended)
- ✅ `requirements.txt` - Python dependencies
- ✅ `Procfile` - Process file (optional, Railway can use start command)
- ✅ `runtime.txt` - Python version (optional)
- ✅ `.gitignore` - Exclude venv, .env, etc.

### Frontend Files Checklist
- ✅ `package.json` - Node dependencies
- ✅ `build/` folder - Production build (generated)
- ✅ `.gitignore` - Exclude node_modules, .env, etc.

---

## 🚀 Deployment Steps

### 1. Remove venv from Git (IMPORTANT!)

```bash
# Navigate to your repo root
cd flask-react-supabase-app

# Remove venv from git tracking
git rm -r --cached backend/venv

# Commit the change
git commit -m "Remove venv from repository"

# Push to GitHub
git push origin main
```

### 2. Deploy Backend to Railway

1. Go to [Railway.app](https://railway.app)
2. Click "New Project" → "Deploy from GitHub repo"
3. Select your repository
4. Click "Add variables" and add all environment variables
5. Go to "Settings":
   - Set **Root Directory**: `backend` (or `flask-react-supabase-app/backend`)
   - Set **Start Command**: `gunicorn app:app --bind 0.0.0.0:$PORT --workers 2 --timeout 120`
6. Click "Deploy"

### 3. Deploy Frontend to Railway

1. In Railway, click "New" → "GitHub Repo" (same repo)
2. This creates a second service
3. Go to "Settings":
   - Set **Root Directory**: `frontend` (or `flask-react-supabase-app/frontend`)
   - Set **Build Command**: `npm install && npm run build`
   - Set **Start Command**: `npx serve -s build -l $PORT`
4. Add environment variables (especially `REACT_APP_API_URL` with your backend URL)
5. Click "Deploy"

### 4. Update Frontend API URL

After backend is deployed, get its URL (e.g., `https://your-app.railway.app`)

Update frontend environment variable:
```
REACT_APP_API_URL=https://your-backend.railway.app
```

Redeploy frontend.

---

## 🔍 Verify Deployment

### Backend Health Check
```bash
curl https://your-backend.railway.app/
```

Should return:
```json
{
  "message": "Welcome to the Car Classifieds API",
  "status": "online",
  "version": "1.0.0"
}
```

### Frontend Check
Visit: `https://your-frontend.railway.app`

Should load the homepage.

---

## 📊 Railway Logs

### View Backend Logs
1. Go to Railway dashboard
2. Click on backend service
3. Click "Deployments" → Latest deployment
4. View logs in real-time

### Common Log Messages

**Good**:
```
[INFO] Starting gunicorn 20.1.0
[INFO] Listening at: http://0.0.0.0:8000
[INFO] Using worker: sync
[INFO] Booting worker with pid: 123
```

**Bad**:
```
ModuleNotFoundError: No module named 'main'
Worker failed to boot
```

---

## 💡 Pro Tips

1. **Use Railway CLI** for faster debugging:
   ```bash
   npm i -g @railway/cli
   railway login
   railway logs
   ```

2. **Test locally first**:
   ```bash
   # Backend
   cd backend
   gunicorn app:app --bind 0.0.0.0:8000
   
   # Frontend
   cd frontend
   npm run build
   npx serve -s build -l 3000
   ```

3. **Monitor resource usage** in Railway dashboard

4. **Set up custom domain** in Railway settings

5. **Enable auto-deploy** from GitHub main branch

---

## 🆘 Still Having Issues?

### Check These:

1. ✅ Root Directory is correct
2. ✅ Start Command uses `app:app` not `main:app`
3. ✅ All environment variables are set
4. ✅ `requirements.txt` includes `gunicorn`
5. ✅ `venv/` is in `.gitignore` and removed from git
6. ✅ `.env` is in `.gitignore` (never commit secrets!)

### Get Help:

1. Check Railway logs for specific errors
2. Test the exact command locally
3. Verify your `app.py` has `app = Flask(__name__)`
4. Ensure `requirements.txt` is up to date

---

## 📝 Quick Reference

### Backend Start Command
```bash
gunicorn app:app --bind 0.0.0.0:$PORT --workers 2 --timeout 120
```

### Frontend Start Command
```bash
npx serve -s build -l $PORT
```

### Root Directories
- Backend: `backend` or `flask-react-supabase-app/backend`
- Frontend: `frontend` or `flask-react-supabase-app/frontend`

---

**Your deployment should now work! 🎉**
