/**
 * Standardized API call output for Static_Analysis.
 * Converts AST analysis results to the unified format.
 */

import fs from 'fs';
import path from 'path';

/**
 * Convert Static_Analysis results to standardized API call format.
 * 
 * Standard format:
 * {
 *   "method": "GET",
 *   "url": "https://api.example.com/v1/users",
 *   "file": "relative/path/to/file.js",
 *   "line": 123,
 *   "column": 5,
 *   "source": "static_analysis"
 * }
 */
export function convertToStandardizedFormat(httpCalls, source = "static_analysis") {
    const standardized = [];
    
    for (const call of httpCalls) {
        // Get URL - handle different possible structures
        let url = call.url || call.endpoint || call.rawCode || 'unknown';
        
        // Skip example/placeholder URLs
        if (shouldSkipUrl(url)) {
            continue;
        }
        
        // Get method
        const method = (call.httpMethod || call.method || 'UNKNOWN').toUpperCase();
        
        // Get location info
        const location = call.location || {};
        const file = location.file || null;
        const line = location.line || null;
        const column = location.column || null;
        
        const apiCall = {
            method: method,
            url: url,
            file: file ? normalizeFilePath(file) : null,
            line: line,
            column: column,
            source: source,
            // Additional metadata
            library: call.category || call.library || 'unknown',
            authentication: determineAuthentication(call)
        };
        
        standardized.push(apiCall);
    }
    
    return standardized;
}

/**
 * Determine if URL should be skipped (example URLs, placeholders, etc.)
 */
function shouldSkipUrl(url) {
    if (!url || typeof url !== 'string') return true;
    
    const skipPatterns = [
        'example.com',
        'placeholder',
        '${',  // Template literals with unresolved variables
        'unknown',
        'localhost:0',
        'width',
        'height',
        'box-sizing',
        '__proto__'
    ];
    
    const urlLower = url.toLowerCase();
    return skipPatterns.some(pattern => urlLower.includes(pattern));
}

/**
 * Normalize file path to relative format
 */
function normalizeFilePath(filePath) {
    // Remove absolute path prefixes, keep relative
    return filePath
        .replace(/^.*[\\\/]extracted_js[\\\/]/, '')
        .replace(/^.*[\\\/]js_files[\\\/]/, '')
        .replace(/\\/g, '/');
}

/**
 * Determine authentication status from call info
 */
function determineAuthentication(call) {
    // Check headers for auth indicators
    if (call.headers) {
        const headerKeys = Object.keys(call.headers).map(k => k.toLowerCase());
        if (headerKeys.some(h => ['authorization', 'x-api-key', 'x-auth-token', 'bearer'].includes(h))) {
            return 'authenticated';
        }
    }
    
    // Check for security issues
    if (call.security?.issues?.some(issue => issue.type === 'missing_auth')) {
        return 'anonymous';
    }
    
    return 'unknown';
}

/**
 * Save standardized output to JSON file
 */
export function saveStandardizedOutput(httpCalls, outputPath = '../outputs/static_analysis_api_calls.json') {
    const standardized = convertToStandardizedFormat(httpCalls);
    
    // Ensure output directory exists
    const outputDir = path.dirname(outputPath);
    if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
    }
    
    fs.writeFileSync(outputPath, JSON.stringify(standardized, null, 2));
    
    console.log(`✓ Saved ${standardized.length} API calls to ${outputPath}`);
    return standardized;
}

/**
 * Load existing analysis results and convert to standardized format
 */
export function loadAndConvertExisting(inputPath, outputPath = '../outputs/static_analysis_api_calls.json') {
    const data = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
    
    // Handle different input formats
    let httpCalls;
    if (Array.isArray(data)) {
        // Direct array of calls
        httpCalls = data;
    } else if (data.httpCalls) {
        // Full report format
        httpCalls = data.httpCalls;
    } else if (data.findings) {
        // Report generator format
        httpCalls = data.findings;
    } else {
        throw new Error('Unknown input format');
    }
    
    return saveStandardizedOutput(httpCalls, outputPath);
}

export default {
    convertToStandardizedFormat,
    saveStandardizedOutput,
    loadAndConvertExisting
};

