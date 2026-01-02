# GitHub Actions Setup Instructions

## 📁 Where to Put the Workflow File

After downloading `github-workflow-update-fpl-data.yml`, you need to place it in a specific folder structure in your GitHub repository:

### **Folder Structure:**
```
your-repo/
├── .github/
│   └── workflows/
│       └── update-fpl-data.yml  ← Put the file here
├── data/
│   └── .gitkeep
├── index.html
├── fpl-players-analysis.html
├── fpl-teams-analysis.html
├── netlify.toml
└── netlify/
    └── functions/
        └── fpl-proxy.js
```

### **Step-by-Step:**

1. **Create the folders in your GitHub repo:**
   - Click "Add file" → "Create new file"
   - Type: `.github/workflows/update-fpl-data.yml`
   - GitHub will automatically create the folders

2. **Copy the content:**
   - Open your downloaded `github-workflow-update-fpl-data.yml` file
   - Copy all the content
   - Paste it into the GitHub editor

3. **Commit the file:**
   - Scroll down
   - Add commit message: "Add daily FPL data update workflow"
   - Click "Commit new file"

### **Enable GitHub Actions:**

4. **Set permissions:**
   - Go to: Settings → Actions → General
   - Scroll to "Workflow permissions"
   - Select: "Read and write permissions"
   - Click "Save"

5. **Create the data folder:**
   - Click "Add file" → "Create new file"
   - Type: `data/.gitkeep`
   - Add a comment: "Folder for cached FPL data"
   - Commit the file

### **Test It:**

6. **Manual trigger:**
   - Go to: Actions tab
   - Click: "Update FPL Data Daily"
   - Click: "Run workflow" → "Run workflow"
   - Wait ~30 seconds
   - Check if `data/bootstrap-static.json` and `data/fixtures.json` were created

### **Done!** 🎉

The workflow will now run automatically every day at 3 AM UTC.

---

## ⚠️ Important Notes:

- The `.github` folder starts with a dot (it's hidden on some systems)
- You must create it exactly as shown: `.github/workflows/`
- The workflow file must be inside the `workflows` folder
- GitHub Actions must have write permissions enabled

---

## 🚀 Alternative: Upload via Web Interface

If you prefer, you can:
1. Go to your repo on GitHub
2. Click "Add file" → "Upload files"
3. Drag the entire `.github` folder structure
4. Commit

But make sure to maintain the folder structure!
