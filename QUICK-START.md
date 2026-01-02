# 🚀 Quick Start - Two Options

## Option 1: Simple (Netlify Only) - 2 Minutes ⚡

**Best for:** Personal use, getting started quickly

### Steps:
1. Download these files:
   - `index.html`
   - `fpl-players-analysis.html`
   - `fpl-teams-analysis.html`
   - `netlify.toml`
   - The entire `netlify/` folder

2. Go to: **[app.netlify.com/drop](https://app.netlify.com/drop)**

3. Drag all files into the page

4. **Done!** Your site is live ✅

**Performance:** 
- First visitor of the day: 2-3 seconds load
- Other visitors: Instant (cached for 24 hours)

---

## Option 2: Advanced (GitHub + Netlify) - 10 Minutes 🔥

**Best for:** High traffic, best performance

### Steps:

#### Part A: GitHub Setup
1. Create a new GitHub repository
2. Upload these files:
   - `index.html`
   - `fpl-players-analysis.html`
   - `fpl-teams-analysis.html`
   - `netlify.toml`
   - The `netlify/` folder
   - The `data/` folder

3. **Create the workflow file:**
   - Click "Add file" → "Create new file"
   - Name it: `.github/workflows/update-fpl-data.yml`
   - Copy content from `github-workflow-update-fpl-data.yml`
   - Paste and commit

4. **Enable Actions:**
   - Settings → Actions → General
   - Select "Read and write permissions"
   - Save

#### Part B: Netlify Setup
1. Go to **[netlify.com](https://netlify.com)**
2. "Add new site" → "Import from Git"
3. Connect your GitHub repo
4. Click "Deploy site"

#### Part C: Test
1. Go to Actions tab on GitHub
2. Click "Update FPL Data Daily"
3. Click "Run workflow"
4. Wait 30 seconds - should see new JSON files in `data/` folder

**Performance:**
- **ALL visitors: Instant load (0.1 seconds)** 🎯
- Data updates automatically every day

---

## 📋 Need Help?

See detailed instructions in:
- `README.md` - Complete guide
- `GITHUB-ACTIONS-SETUP.md` - Step-by-step GitHub setup

---

## ✅ What Files Do I Need?

### For Option 1 (Netlify only):
```
✓ index.html
✓ fpl-players-analysis.html
✓ fpl-teams-analysis.html
✓ netlify.toml
✓ netlify/ folder
  ✓ functions/
    ✓ fpl-proxy.js
```

### For Option 2 (GitHub + Netlify):
```
Everything from Option 1, plus:
✓ data/ folder (create on GitHub)
✓ .github/workflows/update-fpl-data.yml (use the downloaded yml file)
```

---

## 🎯 Recommendation

**Start with Option 1** (simple), then upgrade to Option 2 later if you want better performance!
