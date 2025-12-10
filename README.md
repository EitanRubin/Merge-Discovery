# 🔍 Merge Discovery - API Discovery Tool

A powerful tool for discovering API calls from web applications using **dynamic** and **static** analysis.

![Version](https://img.shields.io/badge/version-2.0.0-blue)
![Node](https://img.shields.io/badge/node-20+-green)
![Python](https://img.shields.io/badge/python-3.9+-yellow)
![License](https://img.shields.io/badge/license-MIT-purple)

---

## 📖 Table of Contents

- [Overview](#-overview)
- [Features](#-features)
- [Quick Start](#-quick-start)
- [Installation](#-installation)
- [Usage](#-usage)
- [Docker](#-docker)
- [API Reference](#-api-reference)
- [Output Format](#-output-format)
- [Configuration](#-configuration)
- [Project Structure](#-project-structure)
- [Troubleshooting](#-troubleshooting)

---

## 🎯 Overview

Merge Discovery automatically finds all API endpoints used by a web application by combining two analysis methods:

| Analysis Type | Tool | Description |
|---------------|------|-------------|
| **Dynamic** | Noizz2025 | Crawls the website with Playwright, intercepts network requests |
| **Static** | Static_Analysis | Parses JavaScript files with Babel AST to find API patterns |

The results are merged, deduplicated, and presented in a unified JSON format.

---

## ✨ Features

- 🌐 **Web UI** - Modern React interface for easy interaction
- 🚀 **Quick Mode** - Instant results using cached data
- 🔄 **Full Scan** - Complete re-analysis of target website
- 📊 **Dual Analysis** - Combines dynamic + static methods
- 📥 **JSON Export** - Download results with one click
- 🔗 **API Forwarding** - Automatically send results to your endpoint
- 🐳 **Docker Support** - Easy deployment with containers
- 🎨 **Beautiful UI** - Dark theme with modern design

---

## 🚀 Quick Start

### Option 1: Using npm (Development)

```bash
# Terminal 1 - Start Backend
cd client-processor/backend
npm install
npm run dev

# Terminal 2 - Start Frontend
cd client-processor/frontend
npm install
npm run dev
```

Open http://localhost:5173 in your browser.

### Option 2: Using Docker

```bash
docker-compose up -d
```

Open http://localhost:5173 in your browser.

---

## 📦 Installation

### Prerequisites

- **Node.js** 20+ 
- **Python** 3.9+ (for full scan mode)
- **npm** or **yarn**

### Step-by-Step Installation

```bash
# 1. Clone the repository
git clone https://github.com/yourusername/Merge_Discovery.git
cd Merge_Discovery

# 2. Install backend dependencies
cd client-processor/backend
npm install

# 3. Install frontend dependencies
cd ../frontend
npm install

# 4. (Optional) Install Python dependencies for full scan
cd ../..
pip install -r Noizz2025/requirements.txt
```

---

## 📖 Usage

### Step 1: Start the Servers

**Backend:**
```bash
cd client-processor/backend
npm run dev
```

**Frontend:**
```bash
cd client-processor/frontend
npm run dev
```

### Step 2: Open the UI

Navigate to: **http://localhost:5173**

### Step 3: Discover APIs

1. Enter target URL (e.g., `http://localhost:4200`)
2. Choose mode:
   - ✅ **Quick Mode** - Returns cached results instantly (~1 second)
   - ☐ **Full Scan** - Runs complete analysis (5-10 minutes)
3. Click **"Load Results"** or **"Full Scan"**
4. View discovered API calls in the table
5. Click **"Download JSON"** to save results

### Step 4: Download Results

Results are saved to:
- `outputs/real_api_calls.json` - Only real HTTP/HTTPS URLs
- `outputs/api_calls_merged.json` - All results including patterns

---

## 🐳 Docker

### Build and Run

```bash
# Build the image
docker build -t merge-discovery .

# Run the container
docker run -p 3001:3001 -p 5173:5173 merge-discovery
```

### Using Docker Compose

```bash
# Start all services
docker-compose up -d

# View logs
docker-compose logs -f

# Stop all services
docker-compose down
```

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3001` | Backend server port |
| `TARGET_API_URL` | - | URL to forward results to |
| `VERBOSE_LOGGING` | `false` | Enable debug logging |

---

## 📡 API Reference

### POST /api/discover

Run API discovery on a target URL.

**Request:**
```json
{
  "clientUrl": "http://localhost:4200",
  "quickMode": true,
  "showAll": false
}
```

**Parameters:**
| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `clientUrl` | string | required | Target URL to analyze |
| `quickMode` | boolean | `true` | Use cached results (fast) |
| `showAll` | boolean | `false` | Include framework patterns |

**Response:**
```json
{
  "success": true,
  "message": "Discovered 8 unique API calls",
  "data": {
    "summary": { ... },
    "api_calls": [ ... ]
  }
}
```

### GET /api/discover/results

Get the latest discovery results without running a new scan.

### GET /api/discover/download

Download the results as a JSON file.

### GET /health

Health check endpoint.

---

## 📄 Output Format

```json
{
  "summary": {
    "total_calls_found": 8,
    "unique_calls": 8,
    "duplicates_removed": 0,
    "sources": {
      "noizz25": 8,
      "static_analysis": 0
    },
    "processing_time_ms": 150
  },
  "api_calls": [
    {
      "method": "GET",
      "url": "https://api.example.com/users",
      "file": "main.js",
      "line": 123,
      "column": 5,
      "sources": ["noizz25"],
      "authentication": "bearer"
    }
  ]
}
```

### API Call Fields

| Field | Type | Description |
|-------|------|-------------|
| `method` | string | HTTP method (GET, POST, PUT, DELETE, etc.) |
| `url` | string | The API endpoint URL |
| `file` | string | Source file where the call was found |
| `line` | number | Line number in the source file |
| `sources` | array | Which analysis found it (noizz25, static_analysis) |
| `authentication` | string | Auth type detected (bearer, anonymous, etc.) |

---

## ⚙️ Configuration

### Backend Configuration

Edit `client-processor/backend/config.json`:

```json
{
  "port": 3001,
  "targetApiUrl": "https://your-api.com/receive",
  "requestTimeout": 30000,
  "verboseLogging": true
}
```

| Setting | Description |
|---------|-------------|
| `port` | Backend server port |
| `targetApiUrl` | Automatically forward results to this URL |
| `requestTimeout` | HTTP request timeout in milliseconds |
| `verboseLogging` | Enable detailed console logging |

### Noizz2025 Configuration

Edit `Noizz2025/config.json`:

```json
{
  "start_url": "http://localhost:4200/",
  "max_depth": 2,
  "max_clicks_per_page": 10,
  "wait_timeout": 15000
}
```

---

## 📁 Project Structure

```
Merge_Discovery/
├── client-processor/           # Main application
│   ├── backend/               # Express.js API server
│   │   ├── src/
│   │   │   ├── index.ts       # Server entry point
│   │   │   ├── routes/        # API routes
│   │   │   ├── services/      # Business logic
│   │   │   └── utils/         # Utilities
│   │   ├── config.json        # Configuration
│   │   └── package.json
│   ├── frontend/              # React UI
│   │   ├── src/
│   │   │   ├── components/    # React components
│   │   │   ├── services/      # API client
│   │   │   └── types/         # TypeScript types
│   │   └── package.json
│   └── README.md
├── Noizz2025/                 # Dynamic analysis tool
│   ├── api_server.py          # FastAPI server
│   ├── api_mapper.py          # Web crawler
│   └── config.json            # Crawler config
├── Static_Analysis/           # Static analysis tool
│   ├── main.js                # CLI entry point
│   └── src/                   # Analysis modules
├── outputs/                   # Analysis results
│   ├── real_api_calls.json    # Filtered results
│   └── api_calls_merged.json  # All results
├── Dockerfile                 # Docker build file
├── docker-compose.yml         # Docker Compose config
├── nginx.conf                 # Nginx config for frontend
└── README.md                  # This file
```

---

## 🔧 Troubleshooting

### Common Issues

| Issue | Solution |
|-------|----------|
| **Backend won't start** | Run `npm install` in `client-processor/backend` |
| **Frontend won't start** | Run `npm install` in `client-processor/frontend` |
| **No results in Quick Mode** | Run a Full Scan first to generate data |
| **Full Scan takes forever** | Normal - it crawls the entire website (5-10 min) |
| **Empty results** | Make sure target app is running before scanning |
| **Port already in use** | Change port in `config.json` or kill existing process |

### Check Server Status

```bash
# Check if backend is running
curl http://localhost:3001/health

# Check if frontend is running
curl http://localhost:5173
```

### View Logs

```bash
# Backend logs (when using npm run dev)
# Logs appear in the terminal

# Docker logs
docker-compose logs -f backend
```

---

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

---

## 📄 License

MIT License - see [LICENSE](LICENSE) for details.

---

## 🙏 Acknowledgments

- [Playwright](https://playwright.dev/) - Web automation
- [Babel](https://babeljs.io/) - JavaScript parsing
- [React](https://react.dev/) - Frontend framework
- [Express](https://expressjs.com/) - Backend framework
- [Vite](https://vitejs.dev/) - Build tool

---

**Made with ❤️ for API discovery**

