import fs from 'fs';
import path from 'path';

export class JsonConfigScanner {
    static jsonData = {}//remove
    constructor() {
        this.configFiles = [];
        this.configData = new Map(); // filename -> parsed data
        this.configKeys = new Map(); // key -> {file, value, path}
        // this.jsonData = {}; // remove?
    }

    scanFolder(folderPath) {
        console.log('🔍 Scanning for JSON configuration files...');

        const jsonFiles = this.findJsonFiles(folderPath);

        for (const jsonFile of jsonFiles) {
            this.analyzeJsonFile(jsonFile);
        }

        console.log(`✅ Found ${this.configFiles.length} JSON configuration files`);
        console.log(`✅ Extracted ${this.configKeys.size} configuration keys`);

        return {
            files: this.configFiles,
            data: this.configData,
            keys: this.configKeys
        };
    }

    findJsonFiles(dir) {
        const jsonFiles = [];

        function scanDirectory(currentDir) {
            const items = fs.readdirSync(currentDir);

            for (const item of items) {
                const fullPath = path.join(currentDir, item);
                const stat = fs.statSync(fullPath);

                if (stat.isDirectory()) {
                    // Skip common directories
                    if (!['node_modules', '.git', 'dist', 'build', '.angular', '.vscode'].includes(item)) {
                        scanDirectory(fullPath);
                    }
                } else if (stat.isFile() && item.endsWith('.json')) {
                    // Look for likely config files
                    const configPatterns = [
                        'settings', 'config', 'configuration', 'app-config',
                        'api-config', 'environment', 'env', 'constants'
                    ];

                    const fileName = item.toLowerCase();
                    const isLikelyConfig = configPatterns.some(pattern =>
                        fileName.includes(pattern)
                    ) || fileName === 'settings.json';

                    if (isLikelyConfig || jsonFiles.length === 0) { // Include at least some JSON files
                        jsonFiles.push(fullPath);
                    }
                }
            }
        }

        scanDirectory(dir);
        return jsonFiles;
    }

    analyzeJsonFile(filePath) {
        try {
            const content = fs.readFileSync(filePath, 'utf8');

            if (!content.trim()) {
                console.log(`  JSON file is empty: ${filePath}`);
                return;
            }

            let data;
            try {
                data = JSON.parse(content);
                JsonConfigScanner.jsonData = data // remove?
            } catch (parseError) {
                console.warn(`  Invalid JSON in ${filePath}: ${parseError.message}`);
                return;
            }

            if (typeof data !== 'object' || data === null) {
                console.warn(`  JSON file does not contain an object: ${filePath}`);
                return;
            }

            const fileName = path.basename(filePath);

            const configFile = {
                filename: fileName,
                filepath: filePath,
                size: content.length,
                keys: Object.keys(data),
                hasUrls: this.containsUrls(data),
                hasApiConfig: this.containsApiConfig(data),
                structure: this.analyzeStructure(data)
            };

            this.configFiles.push(configFile);
            this.configData.set(fileName, data);

            // Extract all keys with their paths and values
            this.extractConfigKeys(data, fileName, []);

            console.log(`  📄 ${fileName}: ${Object.keys(data).length} keys, URLs: ${configFile.hasUrls ? 'Yes' : 'No'}`);

        } catch (error) {
            console.warn(`⚠️  Could not parse JSON file ${filePath}: ${error.message}`);
        }
    }

    extractConfigKeys(obj, filename, currentPath) {
        if (typeof obj !== 'object' || obj === null) {
            return;
        }

        try {

            for (const [key, value] of Object.entries(obj)) {
                const fullPath = currentPath.length > 0 ? `${currentPath.join('.')}.${key}` : key;

                if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
                    // Recursively handle nested objects
                    this.extractConfigKeys(value, filename, [...currentPath, key]);
                } else {
                    // Store the key-value mapping
                    const configEntry = {
                        file: filename,
                        value: value,
                        path: fullPath,
                        key: key,
                        type: typeof value,
                        isUrl: this.isUrl(value),
                        isApiEndpoint: this.isApiEndpoint(key, value)
                    };

                    this.configKeys.set(fullPath, configEntry);

                    // Also store just the key name for simpler lookups
                    if (!this.configKeys.has(key)) {
                        this.configKeys.set(key, configEntry);
                    }
                }
            }
        } catch (error) {
            console.warn(`  Error extracting keys from ${filename}: ${error.message}`);
        }
    }

    containsUrls(obj) {
        return this.findInObject(obj, (key, value) => this.isUrl(value));
    }

    containsApiConfig(obj) {
        const apiKeywords = ['api', 'endpoint', 'baseurl', 'host', 'service'];
        return this.findInObject(obj, (key, value) => {
            const keyLower = key.toString().toLowerCase();
            return apiKeywords.some(keyword => keyLower.includes(keyword)) ||
                this.isUrl(value);
        });
    }

    analyzeStructure(obj) {
        const structure = {
            totalKeys: 0,
            nestedObjects: 0,
            arrays: 0,
            urls: 0,
            apiEndpoints: 0,
            categories: []
        };

        const categories = new Set();

        const analyze = (current, path = []) => {
            if (typeof current === 'object' && current !== null) {
                if (Array.isArray(current)) {
                    structure.arrays++;
                } else {
                    if (path.length > 0) structure.nestedObjects++;

                    for (const [key, value] of Object.entries(current)) {
                        structure.totalKeys++;

                        // Categorize keys
                        const keyLower = key.toLowerCase();
                        if (keyLower.includes('api')) categories.add('API');
                        if (keyLower.includes('url') || keyLower.includes('endpoint')) categories.add('URLs');
                        if (keyLower.includes('auth') || keyLower.includes('token')) categories.add('Authentication');
                        if (keyLower.includes('config') || keyLower.includes('setting')) categories.add('Configuration');

                        if (this.isUrl(value)) {
                            structure.urls++;
                            if (this.isApiEndpoint(key, value)) {
                                structure.apiEndpoints++;
                            }
                        }

                        analyze(value, [...path, key]);
                    }
                }
            }
        }

        // analyze.call(this, obj);
        analyze(obj);
        structure.categories = Array.from(categories);

        return structure;
    }

    isUrl(value) {
        if (typeof value !== 'string') return false;
        return /^https?:\/\//.test(value) ||
            /^\/\/([\w\-\.]+\.)+[\w\-]+(\/.*)?/.test(value) ||
            value.includes('://');
    }

    isApiEndpoint(key, value) {
        if (!this.isUrl(value)) return false;

        const keyLower = key.toString().toLowerCase();
        const apiKeywords = ['api', 'endpoint', 'service', 'base', 'host'];

        return apiKeywords.some(keyword => keyLower.includes(keyword));
    }

    findInObject(obj, predicate) {
        const search = (current, key = '') => {
            if (typeof current === 'object' && current !== null) {
                if (Array.isArray(current)) {
                    return current.some((item, index) => search(item, index.toString()));
                } else {
                    return Object.entries(current).some(([k, v]) => {
                        return predicate(k, v) || search(v, k);
                    });
                }
            } else {
                return predicate(key, current);
            }
        }

        return search(obj);
    }

    getConfig(key) {
        return this.configKeys.get(key);
    }

    getAllConfigs() {
        return {
            files: this.configFiles,
            data: this.configData,
            keys: this.configKeys
        };
    }

    findRelatedConfigs(searchTerm) {
        const related = [];
        const searchLower = searchTerm.toLowerCase();

        for (const [key, config] of this.configKeys.entries()) {
            if (key.toLowerCase().includes(searchLower) ||
                config.path.toLowerCase().includes(searchLower)) {
                related.push({ key, ...config });
            }
        }

        return related;
    }

    clear() {
        this.configFiles = [];
        this.configData.clear();
        this.configKeys.clear();
    }

    //to remove:
    static getJsonData(){
        return JsonConfigScanner.jsonData;
    }
}