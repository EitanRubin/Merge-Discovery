# Universal HTTP Call Analyzer

A generic, language-agnostic tool for analyzing HTTP/HTTPS calls and API requests in any web client codebase.

## Features

- **Multi-Language Support**: Analyze HTTP calls in JavaScript, TypeScript, Python, PHP, Java, C#, Ruby, Go, Rust, Swift, and more
- **Framework Detection**: Automatically detects and analyzes popular HTTP libraries and frameworks
- **Deep Analysis**: Advanced static analysis with scope resolution and dynamic URL detection  
- **Security Analysis**: Identifies insecure protocols, sensitive data exposure, and missing authentication
- **Performance Analysis**: Detects performance issues like calls in loops and suggests optimizations
- **Configurable**: Fully customizable for any project structure and requirements
- **Multiple Output Formats**: JSON, CSV, Markdown reports with detailed metrics

## Quick Start

### Installation

```bash
npm install
```

### Basic Usage

```bash
# Analyze current directory
node main.js ./

# Analyze specific project folder  
node main.js ./my-project

# Deep analysis with security and performance checks
node main.js ./src --deep --security --performance

# Export comprehensive report
node main.js ./ --json --export analysis-report.json
```

## Supported Languages & Frameworks

### JavaScript/TypeScript
- **Native APIs**: fetch, XMLHttpRequest, WebSocket
- **Libraries**: axios, jQuery, superagent, got, ky, needle
- **Frameworks**: React (SWR, React Query), Vue.js, Angular, Next.js, Nuxt.js

### Python  
- **Libraries**: requests, urllib, httpx, aiohttp

### PHP
- **Libraries**: cURL, Guzzle, file_get_contents

### Java
- **Libraries**: HttpClient, OkHttp, RestTemplate, WebClient

### C# (.NET)
- **Libraries**: HttpClient, RestSharp, WebClient

### Ruby
- **Libraries**: Net::HTTP, Faraday, HTTParty

### Go
- **Libraries**: net/http, resty

### Rust
- **Libraries**: reqwest

### Swift
- **Libraries**: URLSession, Alamofire

## Configuration

Create a `config.json` file based on `config.template.json`:

```json
{
  "analysis": {
    "includeExtensions": [".js", ".py", ".php", ".java"],
    "excludePatterns": ["node_modules", "__pycache__", "vendor"],
    "defaultDirectory": "./"
  },
  "httpPatterns": {
    "customPatterns": {
      "my_framework": ["MyFramework.request", "MyFramework.get"]
    }
  },
  "security": {
    "requireHttps": true,
    "sensitiveParams": ["password", "token", "api_key"]
  }
}
```

## Command Line Options

```
Usage: http-analyzer [directory] [options]

Options:
  -h, --help          Show help message
  -v, --version       Show version information
  -f, --format        Output format (json, csv, markdown)
  -o, --output        Output file path
  -j, --json          Export comprehensive JSON report
  -q, --quiet         Suppress console output
  --verbose           Show detailed output
  --include           File extensions to include (e.g., js,ts,py)
  --exclude           Patterns to exclude
  -d, --deep          Enable deep analysis
  -s, --security      Include security analysis
  -p, --performance   Include performance analysis

Examples:
  http-analyzer ./                          # Analyze current directory
  http-analyzer ./project --deep --security # Deep analysis with security
  http-analyzer ./app -j -e report.json    # Export JSON report
```

## Project Types

The tool automatically adapts to different project structures:

### Web Applications
- **Frontend**: React, Vue.js, Angular, vanilla JavaScript
- **Backend**: Node.js, Express, Next.js, Nuxt.js
- **Full-Stack**: MEAN, MERN, LAMP, Django, Rails

### Mobile Applications  
- **React Native**: Detects AsyncStorage, navigation calls
- **Flutter/Dart**: HTTP package analysis
- **iOS/Swift**: URLSession, Alamofire patterns
- **Android/Java**: OkHttp, Retrofit patterns

### Desktop Applications
- **Electron**: Web-based HTTP calls in desktop context
- **C#/WPF**: HttpClient patterns
- **Java/Swing**: HTTP client libraries

### Microservices
- **API Gateways**: Kong, Nginx, Envoy configuration
- **Service Mesh**: Istio, Linkerd communication patterns
- **Containerized**: Docker, Kubernetes service calls

## Output Examples

### Console Output
```
🔍 HTTP Call Analyzer
   Detect HTTP calls and URLs in your codebase

📁 Found 42 files to analyze
✅ Found 15 HTTP calls

📊 Analysis Summary:
   - Total Files: 42
   - Files with HTTP calls: 8  
   - Total HTTP calls: 15
   - Libraries used: axios, fetch, requests
   
🔒 Security Analysis:
   - HTTPS Coverage: 87%
   - Security Issues: 2 medium severity
   
⚡ Performance Analysis: 
   - Calls in loops: 1
   - Caching opportunities: 5
```

### JSON Report Structure
```json
{
  "metadata": {
    "analyzer": "Deep HTTP Analyzer", 
    "timestamp": "2024-12-09T10:30:00.000Z",
    "analysisType": "comprehensive"
  },
  "summary": {
    "totalFiles": 42,
    "filesWithHttpCalls": 8,
    "totalHttpCalls": 15,
    "librariesUsed": ["axios", "fetch", "requests"]
  },
  "httpCalls": [...],
  "security": {...},
  "performance": {...},
  "groupedByFile": {...},
  "groupedByLibrary": {...}
}
```

## Adding Support for New Languages

1. **Add file extensions** to `includeExtensions` in configuration
2. **Add HTTP patterns** to `src/patterns/http-patterns.js`:
   ```javascript
   my_language: ['HttpClient.get', 'HttpClient.post', 'makeRequest']
   ```
3. **Add categorization** in `src/ast/ast-utils.js` `categorizeHTTPCall` method
4. **Test with sample files** in your target language

## Security Features

- **Protocol Analysis**: Detects HTTP vs HTTPS usage
- **Sensitive Data Detection**: Identifies credentials in URLs/headers  
- **Authentication Analysis**: Checks for proper auth headers
- **Vulnerability Scanning**: Common security anti-patterns
- **Compliance Reporting**: Generate security compliance reports

## Performance Features

- **Loop Detection**: Finds HTTP calls inside loops
- **Caching Analysis**: Suggests caching opportunities
- **Request Batching**: Identifies sequential calls that could be batched
- **Error Handling**: Analyzes try/catch and error handling patterns
- **Async/Await Patterns**: Validates proper async usage

## Contributing

1. Fork the repository
2. Add support for new languages/frameworks in `src/patterns/`
3. Update tests and documentation
4. Submit a pull request

## License

MIT License - see LICENSE file for details

## Support

- Create an issue for bug reports or feature requests
- Check existing issues for common problems
- Contribute patterns for new languages/frameworks

---

*This tool is designed to be truly universal - if your language/framework isn't supported, it can be easily added!*