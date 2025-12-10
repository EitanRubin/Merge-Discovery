# API Discovery Tool

A full-stack application for discovering API calls from websites using both **dynamic** and **static** analysis.

## What It Does

1. **You enter a URL** (e.g., `http://localhost:4200`)
2. **Click "Discover APIs"**
3. **The system runs:**
   - 🔍 **Dynamic Analysis** (Noizz2025) - Crawls the website, captures network requests
   - 📊 **Static Analysis** (Babel AST) - Parses JavaScript files for API patterns
4. **Returns a unified JSON** with all discovered API calls
5. **Download the JSON** file with one click
6. **Optionally sends** results to a target API endpoint

---

## Quick Start

### 1. Start the Backend

```bash
cd client-processor/backend
npm install
npm run dev
```

### 2. Start the Frontend

```bash
cd client-processor/frontend
npm install
npm run dev
```

### 3. Open the UI

Navigate to: **http://localhost:5173**

### 4. Enter a URL and Click "Discover APIs"

---

## How to Use

### Step 1: Enter Target URL
Enter the URL of the website you want to analyze (e.g., `http://localhost:4200`)

### Step 2: Click "Discover APIs"
The system will:
- Crawl the website
- Capture all JavaScript files
- Analyze them for API calls
- Merge and deduplicate results

### Step 3: View Results
- See a summary with total API calls found
- Browse the API calls table (filter by method, search by URL)
- View source (Dynamic vs Static analysis)

### Step 4: Download JSON
Click the **"Download JSON"** button to save the results file.

---

## Output JSON Format

```json
{
  "summary": {
    "total_calls_found": 45,
    "unique_calls": 32,
    "duplicates_removed": 13,
    "sources": {
      "noizz25": 28,
      "static_analysis": 17
    },
    "processing_time_ms": 45000
  },
  "api_calls": [
    {
      "method": "GET",
      "url": "/api/users",
      "file": "main.js",
      "line": 123,
      "column": 5,
      "sources": ["noizz25", "static_analysis"],
      "authentication": "bearer"
    }
  ]
}
```

---

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/discover` | Run full discovery pipeline |
| `GET` | `/api/discover/results` | Get latest results |
| `GET` | `/api/discover/download` | Download JSON file |
| `GET` | `/health` | Health check |

### Example API Call

```powershell
$body = @{clientUrl = "http://localhost:4200"} | ConvertTo-Json
Invoke-RestMethod -Uri "http://localhost:3001/api/discover" -Method POST -Body $body -ContentType "application/json"
```

---

## Configuration

Edit `backend/config.json`:

```json
{
  "port": 3001,
  "targetApiUrl": "http://your-api.com/receive",
  "requestTimeout": 30000,
  "verboseLogging": true
}
```

| Setting | Description |
|---------|-------------|
| `port` | Backend server port |
| `targetApiUrl` | Optional - send results to this URL after discovery |
| `requestTimeout` | Timeout for HTTP requests (ms) |
| `verboseLogging` | Enable debug logging |

---

## Project Structure

```
client-processor/
├── backend/
│   ├── src/
│   │   ├── index.ts                    # Express server
│   │   ├── routes/discover.ts          # Discovery endpoints
│   │   ├── services/apiDiscoveryService.ts  # Pipeline orchestration
│   │   └── utils/logger.ts
│   ├── config.json
│   └── package.json
├── frontend/
│   ├── src/
│   │   ├── components/ClientProcessor.tsx  # Main UI
│   │   ├── services/api.ts
│   │   └── types/index.ts
│   └── package.json
└── README.md
```

---

## Tech Stack

- **Backend:** Node.js + TypeScript + Express
- **Frontend:** React + TypeScript + Vite
- **Analysis:** Noizz2025 (Python/Playwright) + Static_Analysis (Babel AST)

---

## License

MIT
