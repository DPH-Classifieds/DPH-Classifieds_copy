# Fix: ENOSPC - No Space Left on Device

## Problem
Your Mac's temporary directory (`/var/folders/`) is full, preventing webpack from compiling.

## Quick Fixes (Try in order)

### 1. Clear Node Cache and Temp Files
```bash
# Navigate to frontend
cd flask-react-supabase-app/frontend

# Clear node cache
rm -rf node_modules/.cache

# Clear webpack cache
rm -rf .cache

# Clear temp build files
rm -rf build
```

### 2. Clear System Temp Files (macOS)
```bash
# Clear user temp directory
rm -rf ~/Library/Caches/Homebrew
rm -rf ~/Library/Caches/pip
rm -rf ~/Library/Caches/yarn
rm -rf ~/Library/Caches/npm

# Clear system temp (requires sudo)
sudo rm -rf /private/var/folders/*
```

### 3. Increase File Watchers (if needed)
```bash
# Check current limit
sysctl kern.maxfiles
sysctl kern.maxfilesperproc

# Increase if needed (temporary)
sudo sysctl -w kern.maxfiles=65536
sudo sysctl -w kern.maxfilesperproc=65536
```

### 4. Free Up Disk Space
```bash
# Check disk usage
df -h

# Find large files
du -sh ~/Downloads/* | sort -hr | head -20
du -sh ~/Library/Caches/* | sort -hr | head -20

# Clean Docker (if installed)
docker system prune -a

# Clean Xcode (if installed)
rm -rf ~/Library/Developer/Xcode/DerivedData
```

### 5. Restart Development Server
```bash
# Kill any running node processes
pkill -f node

# Clear and restart
cd flask-react-supabase-app/frontend
rm -rf node_modules/.cache
npm start
```

## Alternative: Use Production Build
If development server keeps failing, use production build:

```bash
cd flask-react-supabase-app/frontend
npm run build
npx serve -s build -p 3000
```

## Permanent Solution

### Option 1: Increase inotify watches (Linux-style, may not work on macOS)
Create `~/.watchmanconfig`:
```json
{
  "ignore_dirs": ["node_modules", ".git"]
}
```

### Option 2: Reduce webpack watchers
Create `.env` in frontend directory:
```
CHOKIDAR_USEPOLLING=true
WATCHPACK_POLLING=true
```

### Option 3: Clean up regularly
Add to `package.json` scripts:
```json
{
  "scripts": {
    "clean": "rm -rf node_modules/.cache build .cache",
    "fresh-start": "npm run clean && npm start"
  }
}
```

## What Caused This?

1. **Webpack cache buildup** - Development server creates many temp files
2. **Node modules cache** - Babel/ESLint cache files accumulate
3. **System temp directory full** - macOS `/var/folders/` fills up
4. **Too many file watchers** - React dev server watches many files

## Prevention

1. **Regular cleanup**: Run `rm -rf node_modules/.cache` weekly
2. **Use production builds**: For testing, use `npm run build` instead of `npm start`
3. **Monitor disk space**: Keep at least 10GB free
4. **Restart dev server**: Don't leave it running for days

## Quick Command to Run Now

```bash
# One-liner to fix and restart
cd flask-react-supabase-app/frontend && \
rm -rf node_modules/.cache build .cache && \
pkill -f node && \
npm start
```

## If Still Failing

1. **Restart your Mac** - Clears all temp files
2. **Free up disk space** - Delete large unused files
3. **Use production build** - `npm run build && npx serve -s build`
4. **Deploy to Vercel** - Test on production instead

## Vercel Deployment (Recommended)

Since local development is having issues, push to GitHub and let Vercel build:

```bash
git add .
git commit -m "fix: updates for loading spinner and filters"
git push origin main
```

Vercel will build automatically with no space issues!
