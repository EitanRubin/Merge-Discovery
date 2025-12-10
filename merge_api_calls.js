/**
 * Merge API Calls Script
 * 
 * Combines API calls from Noizz2025 and Static_Analysis into a unified JSON file.
 * Removes duplicates based on method + url combination.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Default paths
const DEFAULT_NOIZZ_PATH = './outputs/noizz25_api_calls.json';
const DEFAULT_STATIC_PATH = './outputs/static_analysis_api_calls.json';
const DEFAULT_OUTPUT_PATH = './outputs/api_calls_merged.json';

/**
 * Load JSON file safely
 */
function loadJSON(filePath) {
    try {
        if (!fs.existsSync(filePath)) {
            console.warn(`⚠️  File not found: ${filePath}`);
            return [];
        }
        const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        return Array.isArray(data) ? data : [];
    } catch (error) {
        console.error(`❌ Error loading ${filePath}:`, error.message);
        return [];
    }
}

/**
 * Generate a unique key for an API call (method + normalized URL)
 */
function generateKey(call) {
    const method = (call.method || 'UNKNOWN').toUpperCase();
    const url = normalizeUrl(call.url || '');
    return `${method}|${url}`;
}

/**
 * Normalize URL for comparison (remove trailing slashes, query params for dedup)
 */
function normalizeUrl(url) {
    try {
        // Remove trailing slash
        let normalized = url.replace(/\/+$/, '');
        
        // For deduplication, we might want to ignore query params
        // But keep them for the actual URL stored
        return normalized.toLowerCase();
    } catch {
        return url.toLowerCase();
    }
}

/**
 * Check if URL is a real URL (not a framework pattern)
 */
function isRealUrl(url) {
    if (!url || typeof url !== 'string') return false;
    
    // Must start with http/https or be an absolute path
    if (url.startsWith('http://') || url.startsWith('https://')) {
        // Skip example/placeholder URLs
        if (url.includes('example.com') || url.includes('placeholder')) return false;
        return true;
    }
    
    // Absolute API paths
    if (url.startsWith('/api/') || url.startsWith('/v1/') || url.startsWith('/v2/')) {
        return true;
    }
    
    return false;
}

/**
 * Merge API calls from multiple sources
 */
function mergeApiCalls(noizzCalls, staticCalls, filterRealUrls = false) {
    const callMap = new Map();
    
    // Process all calls
    let allCalls = [
        ...noizzCalls.map(c => ({ ...c, _originalSource: 'noizz25' })),
        ...staticCalls.map(c => ({ ...c, _originalSource: 'static_analysis' }))
    ];
    
    // Optionally filter to only real URLs
    if (filterRealUrls) {
        const before = allCalls.length;
        allCalls = allCalls.filter(c => isRealUrl(c.url));
        console.log(`   Filtered to real URLs only: ${allCalls.length} of ${before}`);
    }
    
    for (const call of allCalls) {
        const key = generateKey(call);
        
        if (callMap.has(key)) {
            // Merge with existing entry
            const existing = callMap.get(key);
            
            // Add source if not already present
            if (!existing.sources.includes(call._originalSource)) {
                existing.sources.push(call._originalSource);
            }
            
            // Merge file/line info if available and existing doesn't have it
            if (!existing.file && call.file) {
                existing.file = call.file;
                existing.line = call.line;
                existing.column = call.column;
            }
            
            // Add to locations array if it has file info
            if (call.file && call.line) {
                if (!existing.locations) {
                    existing.locations = [];
                }
                const locationKey = `${call.file}:${call.line}`;
                if (!existing.locations.some(loc => `${loc.file}:${loc.line}` === locationKey)) {
                    existing.locations.push({
                        file: call.file,
                        line: call.line,
                        column: call.column || null
                    });
                }
            }
            
            // Update authentication if more specific
            if (existing.authentication === 'unknown' && call.authentication !== 'unknown') {
                existing.authentication = call.authentication;
            }
            
        } else {
            // New entry
            const entry = {
                method: (call.method || 'UNKNOWN').toUpperCase(),
                url: call.url,
                file: call.file || null,
                line: call.line || null,
                column: call.column || null,
                sources: [call._originalSource],
                authentication: call.authentication || 'unknown',
                library: call.library || null
            };
            
            // Add locations array if file info is available
            if (call.file && call.line) {
                entry.locations = [{
                    file: call.file,
                    line: call.line,
                    column: call.column || null
                }];
            }
            
            callMap.set(key, entry);
        }
    }
    
    return Array.from(callMap.values());
}

/**
 * Generate summary statistics
 */
function generateSummary(noizzCalls, staticCalls, mergedCalls) {
    const totalCallsFound = noizzCalls.length + staticCalls.length;
    const uniqueCalls = mergedCalls.length;
    
    // Count by source in merged
    const sourceCounts = {
        noizz25: 0,
        static_analysis: 0,
        both: 0
    };
    
    for (const call of mergedCalls) {
        if (call.sources.length === 2) {
            sourceCounts.both++;
        } else if (call.sources.includes('noizz25')) {
            sourceCounts.noizz25++;
        } else if (call.sources.includes('static_analysis')) {
            sourceCounts.static_analysis++;
        }
    }
    
    // Method distribution
    const methodCounts = {};
    for (const call of mergedCalls) {
        methodCounts[call.method] = (methodCounts[call.method] || 0) + 1;
    }
    
    return {
        total_calls_found: totalCallsFound,
        unique_calls: uniqueCalls,
        duplicates_removed: totalCallsFound - uniqueCalls,
        sources: {
            noizz25: noizzCalls.length,
            static_analysis: staticCalls.length
        },
        merged_sources: sourceCounts,
        methods: methodCounts
    };
}

/**
 * Main merge function
 */
function merge(options = {}) {
    const noizzPath = options.noizzPath || DEFAULT_NOIZZ_PATH;
    const staticPath = options.staticPath || DEFAULT_STATIC_PATH;
    const outputPath = options.outputPath || DEFAULT_OUTPUT_PATH;
    const realUrlsOnly = options.realUrlsOnly || false;
    
    console.log('🔄 Loading API call files...');
    console.log(`   Noizz25: ${noizzPath}`);
    console.log(`   Static Analysis: ${staticPath}`);
    
    // Load both files
    const noizzCalls = loadJSON(noizzPath);
    const staticCalls = loadJSON(staticPath);
    
    console.log(`\n📊 Input statistics:`);
    console.log(`   Noizz25 calls: ${noizzCalls.length}`);
    console.log(`   Static Analysis calls: ${staticCalls.length}`);
    console.log(`   Total: ${noizzCalls.length + staticCalls.length}`);
    
    // Merge calls
    console.log('\n🔀 Merging and deduplicating...');
    const mergedCalls = mergeApiCalls(noizzCalls, staticCalls, realUrlsOnly);
    
    // Generate summary
    const summary = generateSummary(noizzCalls, staticCalls, mergedCalls);
    
    // Create final output
    const output = {
        summary: summary,
        api_calls: mergedCalls.sort((a, b) => {
            // Sort by method, then by URL
            if (a.method !== b.method) return a.method.localeCompare(b.method);
            return a.url.localeCompare(b.url);
        })
    };
    
    // Ensure output directory exists
    const outputDir = path.dirname(outputPath);
    if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
    }
    
    // Write output
    fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));
    
    console.log('\n✅ Merge complete!');
    console.log(`\n📋 Summary:`);
    console.log(`   Total calls found: ${summary.total_calls_found}`);
    console.log(`   Unique calls: ${summary.unique_calls}`);
    console.log(`   Duplicates removed: ${summary.duplicates_removed}`);
    console.log(`   Found in both sources: ${summary.merged_sources.both}`);
    console.log(`\n💾 Output saved to: ${outputPath}`);
    
    return output;
}

// CLI execution
if (process.argv[1] === fileURLToPath(import.meta.url)) {
    const args = process.argv.slice(2);
    const options = {};
    
    for (let i = 0; i < args.length; i++) {
        switch (args[i]) {
            case '--noizz':
            case '-n':
                options.noizzPath = args[++i];
                break;
            case '--static':
            case '-s':
                options.staticPath = args[++i];
                break;
            case '--output':
            case '-o':
                options.outputPath = args[++i];
                break;
            case '--real-urls-only':
            case '-r':
                options.realUrlsOnly = true;
                break;
            case '--help':
            case '-h':
                console.log(`
Merge API Calls - Combine API calls from multiple sources

Usage: node merge_api_calls.js [options]

Options:
  -n, --noizz <path>    Path to Noizz25 API calls JSON (default: ${DEFAULT_NOIZZ_PATH})
  -s, --static <path>   Path to Static Analysis API calls JSON (default: ${DEFAULT_STATIC_PATH})
  -o, --output <path>   Output path for merged JSON (default: ${DEFAULT_OUTPUT_PATH})
  -r, --real-urls-only  Only include real URLs (http/https), filter out framework patterns
  -h, --help            Show this help message
                `);
                process.exit(0);
        }
    }
    
    try {
        merge(options);
    } catch (error) {
        console.error('❌ Error:', error.message);
        process.exit(1);
    }
}

export { merge, mergeApiCalls, generateSummary };
export default merge;

