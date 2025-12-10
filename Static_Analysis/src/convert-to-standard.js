#!/usr/bin/env node
/**
 * CLI tool to convert Static_Analysis output to standardized format.
 * 
 * Usage:
 *   node convert-to-standard.js [input-file] [output-file]
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { loadAndConvertExisting, convertToStandardizedFormat, saveStandardizedOutput } from './standardized-output.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Find the most recent analysis file
function findLatestAnalysisFile() {
    const staticAnalysisDir = path.join(__dirname, '..');
    const files = fs.readdirSync(staticAnalysisDir)
        .filter(f => f.startsWith('http-analysis-') && f.endsWith('.json'))
        .map(f => ({
            name: f,
            path: path.join(staticAnalysisDir, f),
            mtime: fs.statSync(path.join(staticAnalysisDir, f)).mtime
        }))
        .sort((a, b) => b.mtime - a.mtime);
    
    return files.length > 0 ? files[0].path : null;
}

// Main
const args = process.argv.slice(2);
let inputPath = args[0];
let outputPath = args[1] || path.join(__dirname, '../../outputs/static_analysis_api_calls.json');

if (!inputPath) {
    // Try to find the latest analysis file
    inputPath = findLatestAnalysisFile();
    if (!inputPath) {
        console.error('❌ No input file specified and no analysis files found.');
        console.error('Usage: node convert-to-standard.js [input-file] [output-file]');
        process.exit(1);
    }
    console.log(`📂 Using latest analysis file: ${path.basename(inputPath)}`);
}

if (!fs.existsSync(inputPath)) {
    console.error(`❌ Input file not found: ${inputPath}`);
    process.exit(1);
}

console.log(`📄 Converting: ${inputPath}`);
console.log(`📁 Output: ${outputPath}`);

try {
    loadAndConvertExisting(inputPath, outputPath);
    console.log('✅ Conversion complete!');
} catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
}

