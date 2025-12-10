#!/usr/bin/env node
/**
 * Full Pipeline Runner
 * 
 * Runs the complete API discovery pipeline:
 * 1. (Optional) Run Noizz2025 to crawl and capture JS files
 * 2. Extract JS from JSON files
 * 3. Run Static Analysis on extracted JS
 * 4. Convert both outputs to standardized format
 * 5. Merge results into unified JSON
 */

import { spawn, execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import merge from './merge_api_calls.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const NOIZZ_DIR = path.join(__dirname, 'Noizz2025');
const STATIC_DIR = path.join(__dirname, 'Static_Analysis');
const OUTPUTS_DIR = path.join(__dirname, 'outputs');
const JS_FILES_DIR = path.join(NOIZZ_DIR, 'mapping_output', 'js_files');
const EXTRACTED_JS_DIR = path.join(NOIZZ_DIR, 'mapping_output', 'extracted_js');

// Parse arguments
const args = process.argv.slice(2);
const skipCrawl = args.includes('--skip-crawl');
const mergeOnly = args.includes('--merge-only');
const targetUrl = args.find(a => a.startsWith('--url='))?.split('=')[1];

async function runCommand(command, args, cwd, options = {}) {
    return new Promise((resolve, reject) => {
        console.log(`\n📌 Running: ${command} ${args.join(' ')}`);
        console.log(`   in: ${cwd}`);
        
        const proc = spawn(command, args, {
            cwd,
            stdio: options.silent ? 'pipe' : 'inherit',
            shell: true
        });
        
        proc.on('close', (code) => {
            if (code === 0) {
                resolve();
            } else {
                reject(new Error(`Command failed with code ${code}`));
            }
        });
        
        proc.on('error', reject);
    });
}

function extractJsFromJson() {
    console.log('\n' + '='.repeat(60));
    console.log('📦 Extracting JS content from JSON files');
    console.log('='.repeat(60));
    
    // Ensure output directory exists
    if (!fs.existsSync(EXTRACTED_JS_DIR)) {
        fs.mkdirSync(EXTRACTED_JS_DIR, { recursive: true });
    }
    
    // Clear existing files
    const existingFiles = fs.readdirSync(EXTRACTED_JS_DIR).filter(f => f.endsWith('.js'));
    existingFiles.forEach(f => fs.unlinkSync(path.join(EXTRACTED_JS_DIR, f)));
    
    // Process JSON files
    const jsonFiles = fs.readdirSync(JS_FILES_DIR).filter(f => f.endsWith('.json'));
    console.log(`Found ${jsonFiles.length} JSON files to process`);
    
    let extracted = 0;
    let failed = 0;
    
    for (const jsonFile of jsonFiles) {
        try {
            const data = JSON.parse(fs.readFileSync(path.join(JS_FILES_DIR, jsonFile), 'utf8'));
            const content = data.content;
            
            if (content && typeof content === 'string' && content.length > 0) {
                const jsFileName = jsonFile.replace('.json', '.js');
                fs.writeFileSync(path.join(EXTRACTED_JS_DIR, jsFileName), content);
                extracted++;
            } else {
                failed++;
            }
        } catch (error) {
            failed++;
        }
    }
    
    console.log(`✓ Extracted ${extracted} JS files, ${failed} failed`);
    return extracted;
}

function convertNoizzOutput() {
    console.log('\n' + '='.repeat(60));
    console.log('🔄 Converting Noizz25 output to standardized format');
    console.log('='.repeat(60));
    
    const inputPath = path.join(NOIZZ_DIR, 'mapping_output', 'http_calls', 'ui_endpoints.json');
    const outputPath = path.join(OUTPUTS_DIR, 'noizz25_api_calls.json');
    
    if (!fs.existsSync(inputPath)) {
        console.log('⚠️  No Noizz25 output found, skipping...');
        // Create empty file
        fs.writeFileSync(outputPath, '[]');
        return;
    }
    
    const endpoints = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
    
    // Filter and convert
    const skipPatterns = ['/@vite/', '/@fs/', '/@ng/', '/node_modules/', '.hot-update.'];
    const standardized = endpoints
        .filter(ep => !skipPatterns.some(p => ep.endpoint?.includes(p)))
        .map(ep => ({
            method: (ep.method || 'GET').toUpperCase(),
            url: ep.endpoint,
            file: null,
            line: null,
            column: null,
            source: 'noizz25',
            authentication: ep.authentication || 'unknown'
        }));
    
    // Ensure output directory exists
    if (!fs.existsSync(OUTPUTS_DIR)) {
        fs.mkdirSync(OUTPUTS_DIR, { recursive: true });
    }
    
    fs.writeFileSync(outputPath, JSON.stringify(standardized, null, 2));
    console.log(`✓ Converted ${standardized.length} API calls from Noizz25`);
}

async function runStaticAnalysis() {
    console.log('\n' + '='.repeat(60));
    console.log('🔬 Running Static Analysis');
    console.log('='.repeat(60));
    
    if (!fs.existsSync(EXTRACTED_JS_DIR)) {
        console.log('⚠️  No extracted JS files found, skipping static analysis...');
        return null;
    }
    
    const jsFiles = fs.readdirSync(EXTRACTED_JS_DIR).filter(f => f.endsWith('.js'));
    if (jsFiles.length === 0) {
        console.log('⚠️  No JS files to analyze');
        return null;
    }
    
    console.log(`Found ${jsFiles.length} JS files to analyze`);
    
    // Run static analysis
    await runCommand('node', [
        'main.js',
        EXTRACTED_JS_DIR,
        '--deep',
        '--security',
        '--performance'
    ], STATIC_DIR);
    
    // Find the latest analysis file
    const analysisFiles = fs.readdirSync(STATIC_DIR)
        .filter(f => f.startsWith('http-analysis-') && f.endsWith('.json'))
        .map(f => ({
            name: f,
            path: path.join(STATIC_DIR, f),
            mtime: fs.statSync(path.join(STATIC_DIR, f)).mtime
        }))
        .sort((a, b) => b.mtime - a.mtime);
    
    return analysisFiles.length > 0 ? analysisFiles[0].path : null;
}

function convertStaticAnalysisOutput(analysisFile) {
    console.log('\n' + '='.repeat(60));
    console.log('🔄 Converting Static Analysis output to standardized format');
    console.log('='.repeat(60));
    
    const outputPath = path.join(OUTPUTS_DIR, 'static_analysis_api_calls.json');
    
    if (!analysisFile || !fs.existsSync(analysisFile)) {
        console.log('⚠️  No analysis file found, creating empty output...');
        fs.writeFileSync(outputPath, '[]');
        return;
    }
    
    const data = JSON.parse(fs.readFileSync(analysisFile, 'utf8'));
    
    // Handle different input formats
    let httpCalls = [];
    if (Array.isArray(data)) {
        httpCalls = data;
    } else if (data.httpCalls) {
        httpCalls = data.httpCalls;
    } else if (data.findings) {
        httpCalls = data.findings;
    }
    
    console.log(`📊 Raw analysis found ${httpCalls.length} HTTP call patterns`);
    
    // Patterns that indicate non-useful/placeholder data
    const skipPatterns = [
        'example.com',
        '(unknown pattern)',
        '{complex',
        '{function',
        '{member:',
        '{{member:',
        '{variable:',
        '__proto__',
        'width',
        'height',
        'box-sizing'
    ];
    
    // Convert all calls, tracking what's filtered
    let filtered = 0;
    let kept = 0;
    
    const standardized = [];
    
    for (const call of httpCalls) {
        const url = call.url || call.endpoint || '';
        const urlLower = url.toLowerCase();
        
        // Skip non-useful patterns
        if (skipPatterns.some(p => urlLower.includes(p))) {
            filtered++;
            continue;
        }
        
        // Skip empty or very short URLs
        if (!url || url.length < 2) {
            filtered++;
            continue;
        }
        
        kept++;
        
        // Extract locations if available
        const locations = call.locations || (call.location ? [call.location] : []);
        
        // For each location, create a separate entry (better for tracing)
        if (locations.length > 0) {
            for (const loc of locations.slice(0, 10)) { // Limit to first 10 locations per URL
                standardized.push({
                    method: (call.httpMethod || call.method || 'UNKNOWN').toUpperCase(),
                    url: url,
                    file: loc.file?.replace(/^.*[\\\/]extracted_js[\\\/]/, '').replace(/\\/g, '/') || null,
                    line: loc.line || null,
                    column: loc.column || null,
                    source: 'static_analysis',
                    library: call.category || 'unknown',
                    authentication: call.authentication || 'unknown'
                });
            }
        } else {
            standardized.push({
                method: (call.httpMethod || call.method || 'UNKNOWN').toUpperCase(),
                url: url,
                file: null,
                line: null,
                column: null,
                source: 'static_analysis',
                library: call.category || 'unknown',
                authentication: call.authentication || 'unknown'
            });
        }
    }
    
    console.log(`   - Filtered out: ${filtered} placeholder/framework patterns`);
    console.log(`   - Useful patterns kept: ${kept}`);
    console.log(`   - Total entries (with locations): ${standardized.length}`);
    
    fs.writeFileSync(outputPath, JSON.stringify(standardized, null, 2));
    console.log(`✓ Saved ${standardized.length} API calls to static_analysis_api_calls.json`);
}

function runMerge() {
    console.log('\n' + '='.repeat(60));
    console.log('🔀 Merging API calls');
    console.log('='.repeat(60));
    
    // Full merge (all patterns)
    merge({
        noizzPath: path.join(OUTPUTS_DIR, 'noizz25_api_calls.json'),
        staticPath: path.join(OUTPUTS_DIR, 'static_analysis_api_calls.json'),
        outputPath: path.join(OUTPUTS_DIR, 'api_calls_merged.json'),
        realUrlsOnly: false
    });
    
    // Also create a filtered version with only real URLs
    console.log('\n📋 Creating filtered output (real URLs only)...');
    merge({
        noizzPath: path.join(OUTPUTS_DIR, 'noizz25_api_calls.json'),
        staticPath: path.join(OUTPUTS_DIR, 'static_analysis_api_calls.json'),
        outputPath: path.join(OUTPUTS_DIR, 'real_api_calls.json'),
        realUrlsOnly: true
    });
}

async function main() {
    console.log('='.repeat(60));
    console.log('🚀 API Discovery Pipeline');
    console.log('='.repeat(60));
    
    // Ensure outputs directory exists
    if (!fs.existsSync(OUTPUTS_DIR)) {
        fs.mkdirSync(OUTPUTS_DIR, { recursive: true });
    }
    
    if (mergeOnly) {
        // Only run merge step
        runMerge();
        return;
    }
    
    let analysisFile = null;
    
    if (!skipCrawl) {
        // TODO: Run Noizz2025 crawl (requires running the server)
        console.log('\n⚠️  Crawl step requires Noizz2025 server.');
        console.log('   Use: python run_analysis.py --url <URL> for full crawl');
        console.log('   Or use: npm run pipeline:skip-crawl to skip crawling');
    }
    
    // Extract JS from JSON
    if (fs.existsSync(JS_FILES_DIR)) {
        extractJsFromJson();
    }
    
    // Run Static Analysis
    analysisFile = await runStaticAnalysis();
    
    // Convert Noizz output
    convertNoizzOutput();
    
    // Convert Static Analysis output
    convertStaticAnalysisOutput(analysisFile);
    
    // Merge
    runMerge();
    
    console.log('\n' + '='.repeat(60));
    console.log('✅ Pipeline complete!');
    console.log('='.repeat(60));
    console.log('\n📁 Output files:');
    console.log(`   • outputs/noizz25_api_calls.json       - Runtime captured API calls`);
    console.log(`   • outputs/static_analysis_api_calls.json - AST analysis results`);
    console.log(`   • outputs/api_calls_merged.json        - All patterns merged`);
    console.log(`   • outputs/real_api_calls.json          - ⭐ REAL API URLs only`);
}

main().catch(error => {
    console.error('\n❌ Pipeline failed:', error.message);
    process.exit(1);
});

