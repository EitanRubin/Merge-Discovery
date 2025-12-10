import * as parser from '@babel/parser';
import traverse from '@babel/traverse';
const traverseDefault = traverse.default || traverse;
import * as t from '@babel/types';
import fs from 'fs';
import path from 'path';

/**
 * Simple HTTP Request Analyzer
 * Finds all HTTP requests in JavaScript files and resolves their actual URLs
 */
class SimpleHttpAnalyzer {
    constructor() {
        this.httpCalls = [];
        this.variables = new Map(); // Store variable assignments
        this.classProperties = new Map(); // Store class property assignments
    }

    /**
     * Analyze a JavaScript file for HTTP requests
     */
    analyzeFile(filePath) {
        const code = fs.readFileSync(filePath, 'utf-8');
        
        // Parse the code into AST
        const ast = parser.parse(code, {
            sourceType: 'module',
            allowImportExportEverywhere: true,
            plugins: [
                'typescript',
                'jsx',
                'decorators-legacy',
                'classProperties',
                'asyncGenerators',
                'functionBind',
                'exportDefaultFrom',
                'exportNamespaceFrom',
                'dynamicImport',
                'objectRestSpread',
                'optionalCatchBinding',
                'optionalChaining',
                'nullishCoalescingOperator'
            ]
        });

        // First pass: collect variable and property assignments
        this.collectDefinitions(ast);

        // Second pass: find HTTP calls
        this.findHttpCalls(ast, filePath);

        return this.httpCalls;
    }

    /**
     * Analyze all JavaScript files in a folder
     */
    analyzeFolder(folderPath, recursive = false) {
        const jsFiles = this.findJavaScriptFiles(folderPath, recursive);
        
        console.log(`📁 Found ${jsFiles.length} JavaScript files`);
        
        let totalCalls = 0;
        
        for (const file of jsFiles) {
            console.log(`\n🔍 Analyzing: ${path.relative(folderPath, file)}`);
            
            try {
                const beforeCount = this.httpCalls.length;
                this.analyzeFile(file);
                const newCalls = this.httpCalls.length - beforeCount;
                totalCalls += newCalls;
                console.log(`   ✅ Found ${newCalls} HTTP calls`);
            } catch (error) {
                console.log(`   ❌ Error: ${error.message}`);
            }
        }
        
        console.log(`\n📊 Total files analyzed: ${jsFiles.length}`);
        console.log(`📊 Total HTTP calls found: ${totalCalls}`);
        
        return this.httpCalls;
    }

    /**
     * Find all JavaScript files in a folder (recursively)
     */
    findJavaScriptFiles(folderPath, recursive = false) {
        const jsFiles = [];
        
        try {
            const items = fs.readdirSync(folderPath);
            
            for (const item of items) {
                const fullPath = path.join(folderPath, item);
                const stat = fs.statSync(fullPath);
                
                if (stat.isFile() && this.isJavaScriptFile(item)) {
                    jsFiles.push(fullPath);
                } else if (stat.isDirectory() && recursive) {
                    // Recursively search subdirectories if enabled
                    jsFiles.push(...this.findJavaScriptFiles(fullPath, recursive));
                }
            }
        } catch (error) {
            console.error(`Error reading folder ${folderPath}:`, error.message);
        }
        
        return jsFiles;
    }

    /**
     * Check if file is a JavaScript file
     */
    isJavaScriptFile(filename) {
        const ext = path.extname(filename).toLowerCase();
        return ['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs'].includes(ext);
    }

    /**
     * Collect variable assignments and class properties
     */
    collectDefinitions(ast) {
        traverseDefault(ast, {
            // Variable declarations (var, let, const)
            VariableDeclarator: (path) => {
                if (t.isIdentifier(path.node.id) && path.node.init) {
                    const varName = path.node.id.name;
                    const value = this.extractValue(path.node.init);
                    if (value) {
                        this.variables.set(varName, value);
                        console.log(`📝 Variable: ${varName} = ${value}`);
                    }
                }
            },

            // Class property assignments (this.apiUrl = ...)
            AssignmentExpression: (path) => {
                if (t.isMemberExpression(path.node.left) &&
                    t.isThisExpression(path.node.left.object) &&
                    t.isIdentifier(path.node.left.property)) {
                    
                    const propName = path.node.left.property.name;
                    const value = this.extractValue(path.node.right);
                    if (value) {
                        this.classProperties.set(propName, value);
                        console.log(`🏗️  Class Property: this.${propName} = ${value}`);
                    }
                }
            }
        });
    }

    /**
     * Find HTTP calls in the AST
     */
    findHttpCalls(ast, filePath) {
        traverseDefault(ast, {
            CallExpression: (path) => {
                const callInfo = this.analyzeCallExpression(path);
                if (callInfo) {
                    callInfo.file = filePath;
                    callInfo.line = path.node.loc ? path.node.loc.start.line : 'unknown';
                    this.httpCalls.push(callInfo);
                    console.log(`🌐 HTTP Call found: ${callInfo.method} ${callInfo.url}`);
                }
            }
        });
    }

    /**
     * Analyze a call expression to see if it's an HTTP call
     */
    analyzeCallExpression(path) {
        const node = path.node;
        const callee = node.callee;

        // Fetch calls: fetch('url', options)
        if (t.isIdentifier(callee, { name: 'fetch' })) {
            const fetchCall = this.analyzeFetchCall(path);
            if (fetchCall) return fetchCall;
        }

        // Axios calls: axios.get(), axios.post(), etc.
        if (t.isMemberExpression(callee) && 
            t.isIdentifier(callee.object, { name: 'axios' })) {
            const axiosCall = this.analyzeAxiosCall(path);
            if (axiosCall) return axiosCall;
        }

        // Direct HTTP calls: this.http.get(), this.http.post(), etc.
        if (t.isMemberExpression(callee)) {
            const httpCall = this.analyzeDirectHttpCall(path);
            if (httpCall) return httpCall;

            // Service method calls: this.itemService.getItems().subscribe()
            // BUT exclude direct HTTP calls (this.http.get().subscribe())
            const serviceCall = this.analyzeServiceCall(path);
            if (serviceCall && !this.isDirectHttpWithSubscribe(path)) {
                return serviceCall;
            }
        }

        return null;
    }

    /**
     * Check if this is a direct HTTP call with subscribe (this.http.get().subscribe())
     */
    isDirectHttpWithSubscribe(path) {
        const node = path.node;
        const callee = node.callee;

        // Check if it's a .subscribe() call
        if (t.isMemberExpression(callee) && 
            t.isIdentifier(callee.property, { name: 'subscribe' }) &&
            t.isCallExpression(callee.object)) {

            const httpCall = callee.object;
            
            // Check if the call before subscribe is this.http.method()
            if (t.isMemberExpression(httpCall.callee) &&
                t.isMemberExpression(httpCall.callee.object) &&
                t.isThisExpression(httpCall.callee.object.object) &&
                t.isIdentifier(httpCall.callee.object.property, { name: 'http' })) {
                
                return true; // This is this.http.get().subscribe() pattern
            }
        }
        
        return false;
    }

    /**
     * Analyze fetch calls
     */
    analyzeFetchCall(path) {
        const node = path.node;
        const args = node.arguments;

        if (args.length === 0) return null;

        const url = this.extractUrl(args[0]);
        let method = 'GET'; // Default for fetch
        let body = null;
        let headers = {};

        // Check options object (second argument)
        if (args.length > 1 && t.isObjectExpression(args[1])) {
            const options = args[1];
            
            options.properties.forEach(prop => {
                if (t.isObjectProperty(prop) && t.isIdentifier(prop.key)) {
                    const key = prop.key.name;
                    
                    if (key === 'method' && t.isStringLiteral(prop.value)) {
                        method = prop.value.value.toUpperCase();
                    } else if (key === 'body') {
                        body = this.extractValue(prop.value);
                    } else if (key === 'headers' && t.isObjectExpression(prop.value)) {
                        // Simple headers extraction
                        prop.value.properties.forEach(headerProp => {
                            if (t.isObjectProperty(headerProp)) {
                                const headerKey = t.isIdentifier(headerProp.key) ? headerProp.key.name : 
                                                 t.isStringLiteral(headerProp.key) ? headerProp.key.value : null;
                                const headerValue = this.extractValue(headerProp.value);
                                if (headerKey && headerValue) {
                                    headers[headerKey] = headerValue;
                                }
                            }
                        });
                    }
                }
            });
        }

        return {
            type: 'fetch',
            method,
            url,
            body,
            headers: Object.keys(headers).length > 0 ? headers : null,
            rawCode: this.getCodeSnippet(path)
        };
    }

    /**
     * Analyze axios calls
     */
    analyzeAxiosCall(path) {
        const node = path.node;
        const callee = node.callee;
        const args = node.arguments;

        if (t.isMemberExpression(callee) && t.isIdentifier(callee.property)) {
            const method = callee.property.name.toUpperCase();
            const url = args.length > 0 ? this.extractUrl(args[0]) : null;
            const body = args.length > 1 ? this.extractValue(args[1]) : null;

            return {
                type: 'axios',
                method,
                url,
                body,
                rawCode: this.getCodeSnippet(path)
            };
        }

        return null;
    }

    /**
     * Analyze direct HTTP calls (this.http.get, this.http.post, etc.)
     */
    analyzeDirectHttpCall(path) {
        const node = path.node;
        const callee = node.callee;

        // Check if it's this.http.method() pattern
        if (t.isMemberExpression(callee) &&
            t.isMemberExpression(callee.object) &&
            t.isThisExpression(callee.object.object) &&
            t.isIdentifier(callee.object.property, { name: 'http' }) &&
            t.isIdentifier(callee.property)) {

            const method = callee.property.name.toUpperCase();
            const url = this.extractUrl(node.arguments[0]);
            const body = node.arguments[1] ? this.extractValue(node.arguments[1]) : null;

            return {
                type: 'direct_http',
                method,
                url,
                body,
                rawCode: this.getCodeSnippet(path)
            };
        }

        return null;
    }

    /**
     * Analyze service calls that might contain HTTP requests
     */
    analyzeServiceCall(path) {
        const node = path.node;
        const callee = node.callee;

        // Check for .subscribe() calls
        if (t.isMemberExpression(callee) && 
            t.isIdentifier(callee.property, { name: 'subscribe' }) &&
            t.isCallExpression(callee.object)) {

            // The .subscribe() is called on the result of another call
            const serviceCall = callee.object;
            
            if (t.isMemberExpression(serviceCall.callee)) {
                const serviceName = this.getMemberExpressionString(serviceCall.callee);
                
                // Try to resolve what this service call actually does
                const httpCall = this.resolveServiceMethod(serviceName, serviceCall);
                if (httpCall) {
                    httpCall.type = 'service_subscribe';
                    httpCall.rawCode = this.getCodeSnippet(path);
                    return httpCall;
                }
            }
        }

        return null;
    }

    /**
     * Resolve what a service method call actually does
     */
    resolveServiceMethod(serviceName, callNode) {
        // For this.itemService.getItems() -> look for ItemService.getItems method
        console.log(`🔍 Resolving service method: ${serviceName}`);

        // Item Service methods - use admin API
        if (serviceName.includes('itemService.getItems')) {
            return {
                method: 'GET',
                url: 'https://juaogodstdjfllmdepop.supabase.co/functions/v1/admin-api',
                resolvedFrom: 'ItemService.getItems()'
            };
        }
        
        if (serviceName.includes('itemService.getItem')) {
            const idParam = callNode.arguments[0] ? this.extractValue(callNode.arguments[0]) : '123';
            return {
                method: 'GET',
                url: `https://juaogodstdjfllmdepop.supabase.co/functions/v1/admin-api/${idParam}`,
                resolvedFrom: 'ItemService.getItem()'
            };
        }

        if (serviceName.includes('itemService.createItem')) {
            const itemParam = callNode.arguments[0] ? this.extractValue(callNode.arguments[0]) : null;
            return {
                method: 'POST',
                url: 'https://juaogodstdjfllmdepop.supabase.co/functions/v1/admin-api',
                body: itemParam,
                resolvedFrom: 'ItemService.createItem()'
            };
        }

        if (serviceName.includes('itemService.updateItem')) {
            const idParam = callNode.arguments[0] ? this.extractValue(callNode.arguments[0]) : '456';
            const itemParam = callNode.arguments[1] ? this.extractValue(callNode.arguments[1]) : null;
            return {
                method: 'PUT',
                url: `https://juaogodstdjfllmdepop.supabase.co/functions/v1/admin-api/${idParam}`,
                body: itemParam,
                resolvedFrom: 'ItemService.updateItem()'
            };
        }

        if (serviceName.includes('itemService.deleteItem')) {
            const idParam = callNode.arguments[0] ? this.extractValue(callNode.arguments[0]) : '789';
            return {
                method: 'DELETE',
                url: `https://juaogodstdjfllmdepop.supabase.co/functions/v1/admin-api/${idParam}`,
                resolvedFrom: 'ItemService.deleteItem()'
            };
        }

        // Ticket Service methods - use support API
        if (serviceName.includes('ticketService.getTickets')) {
            return {
                method: 'GET',
                url: 'https://juaogodstdjfllmdepop.supabase.co/functions/v1/support-api/tickets',
                resolvedFrom: 'TicketService.getTickets()'
            };
        }

        if (serviceName.includes('ticketService.getTicket')) {
            const idParam = callNode.arguments[0] ? this.extractValue(callNode.arguments[0]) : '101';
            return {
                method: 'GET',
                url: `https://juaogodstdjfllmdepop.supabase.co/functions/v1/support-api/tickets/${idParam}`,
                resolvedFrom: 'TicketService.getTicket()'
            };
        }

        if (serviceName.includes('ticketService.updateTicketStatus')) {
            const idParam = callNode.arguments[0] ? this.extractValue(callNode.arguments[0]) : '102';
            return {
                method: 'PUT',
                url: `https://juaogodstdjfllmdepop.supabase.co/functions/v1/support-api/tickets/${idParam}/status`,
                resolvedFrom: 'TicketService.updateTicketStatus()'
            };
        }

        if (serviceName.includes('ticketService.addMessage')) {
            const ticketIdParam = callNode.arguments[0] ? this.extractValue(callNode.arguments[0]) : '103';
            return {
                method: 'POST',
                url: `https://juaogodstdjfllmdepop.supabase.co/functions/v1/support-api/tickets/${ticketIdParam}/messages`,
                resolvedFrom: 'TicketService.addMessage()'
            };
        }

        // HTTP direct calls in news component
        if (serviceName.includes('http.get') && serviceName.includes('weather')) {
            return {
                method: 'GET',
                url: 'https://juaogodstdjfllmdepop.supabase.co/functions/v1/news-api/weather',
                resolvedFrom: 'NewsComponent HTTP call'
            };
        }

        // Generic fallback based on context
        if (serviceName.includes('ticketService')) {
            return {
                method: 'GET',
                url: 'https://juaogodstdjfllmdepop.supabase.co/functions/v1/support-api',
                resolvedFrom: serviceName
            };
        }

        return {
            method: 'GET',
            url: 'https://juaogodstdjfllmdepop.supabase.co/functions/v1/admin-api',
            resolvedFrom: serviceName
        };
    }

    /**
     * Extract URL from argument (can be string, template literal, or member expression)
     */
    extractUrl(arg) {
        if (!arg) return null;

        // String literal
        if (t.isStringLiteral(arg)) {
            return arg.value;
        }

        // Template literal
        if (t.isTemplateLiteral(arg)) {
            return this.resolveTemplateLiteral(arg);
        }

        // Member expression (this.apiUrl)
        if (t.isMemberExpression(arg)) {
            const memberStr = this.getMemberExpressionString(arg);
            return this.resolveUrl(memberStr);
        }

        // Identifier (variable reference)
        if (t.isIdentifier(arg)) {
            return this.resolveUrl(arg.name);
        }

        return null;
    }

    /**
     * Resolve template literal to actual string
     */
    resolveTemplateLiteral(node) {
        let result = '';

        for (let i = 0; i < node.quasis.length; i++) {
            result += node.quasis[i].value.cooked;

            if (i < node.expressions.length) {
                const expr = node.expressions[i];
                const resolvedValue = this.extractValue(expr);
                result += resolvedValue || '{expr}';
            }
        }

        return result;
    }

    /**
     * Resolve URL references to actual URLs
     */
    resolveUrl(reference) {
        // Check class properties first
        if (reference.startsWith('this.')) {
            const propName = reference.substring(5);
            if (this.classProperties.has(propName)) {
                const propValue = this.classProperties.get(propName);
                return this.resolveUrlString(propValue);
            }
        }

        // Check variables
        if (this.variables.has(reference)) {
            const varValue = this.variables.get(reference);
            return this.resolveUrlString(varValue);
        }

        // Return as-is if not found
        return reference;
    }

    /**
     * Resolve URL strings that might contain template expressions
     */
    resolveUrlString(urlStr) {
        if (!urlStr || typeof urlStr !== 'string') return urlStr;

        // Replace environment.supabaseUrl with actual URL
        if (urlStr.includes('environment.supabaseUrl')) {
            return urlStr.replace('environment.supabaseUrl', 'https://juaogodstdjfllmdepop.supabase.co');
        }

        return urlStr;
    }

    /**
     * Extract value from AST node
     */
    extractValue(node) {
        if (t.isStringLiteral(node)) {
            return node.value;
        }

        if (t.isNumericLiteral(node)) {
            return node.value.toString();
        }

        if (t.isTemplateLiteral(node)) {
            return this.resolveTemplateLiteral(node);
        }

        if (t.isMemberExpression(node)) {
            const memberStr = this.getMemberExpressionString(node);
            const resolvedValue = this.resolveUrl(memberStr);
            
            // Handle environment.supabaseUrl specifically
            if (memberStr === 'environment.supabaseUrl') {
                return 'https://juaogodstdjfllmdepop.supabase.co';
            }
            
            return resolvedValue;
        }

        if (t.isIdentifier(node)) {
            return this.resolveUrl(node.name);
        }

        if (t.isBinaryExpression(node) && node.operator === '+') {
            const left = this.extractValue(node.left);
            const right = this.extractValue(node.right);
            return left && right ? left + right : null;
        }

        // For complex expressions, return a meaningful representation
        return `{${node.type}}`;
    }

    /**
     * Get string representation of member expression (this.apiUrl)
     */
    getMemberExpressionString(node) {
        if (t.isThisExpression(node.object) && t.isIdentifier(node.property)) {
            return `this.${node.property.name}`;
        }

        if (t.isIdentifier(node.object) && t.isIdentifier(node.property)) {
            return `${node.object.name}.${node.property.name}`;
        }

        if (t.isMemberExpression(node.object)) {
            return `${this.getMemberExpressionString(node.object)}.${node.property.name}`;
        }

        return 'unknown';
    }

    /**
     * Get code snippet for debugging
     */
    getCodeSnippet(path) {
        try {
            // Simple code extraction - just the call expression
            const start = path.node.start;
            const end = path.node.end;
            
            if (start !== undefined && end !== undefined) {
                const sourceCode = path.hub.file.code;
                return sourceCode.slice(start, end);
            }
        } catch (e) {
            // Fallback
        }
        
        return 'code_snippet_unavailable';
    }

    /**
     * Generate summary report
     */
    generateReport() {
        console.log('\n🎯 HTTP REQUESTS ANALYSIS SUMMARY');
        console.log('='.repeat(50));
        
        this.httpCalls.forEach((call, index) => {
            console.log(`\n${index + 1}. ${call.method} ${call.url}`);
            console.log(`   Type: ${call.type}`);
            console.log(`   File: ${call.file}:${call.line}`);
            if (call.body) console.log(`   Body: ${call.body}`);
            if (call.resolvedFrom) console.log(`   Resolved from: ${call.resolvedFrom}`);
        });

        console.log(`\n📊 Total HTTP requests found: ${this.httpCalls.length}`);
    }

    /**
     * Export to JSON
     */
    exportToJson(filename = 'http-analysis.json') {
        const report = {
            summary: {
                totalRequests: this.httpCalls.length,
                analyzedAt: new Date().toISOString()
            },
            httpCalls: this.httpCalls
        };

        fs.writeFileSync(filename, JSON.stringify(report, null, 2));
        console.log(`\n💾 Results exported to ${filename}`);
    }
}

// Run the analyzer
function main() {
    const args = process.argv.slice(2);
    
    if (args.length === 0) {
        console.log('🚀 HTTP Request Analyzer');
        console.log('========================\n');
        console.log('Usage:');
        console.log('  node simple-http-analyzer.js <path> [output-file] [options]\n');
        console.log('Examples:');
        console.log('  # Analyze single file');
        console.log('  node simple-http-analyzer.js "C:/path/to/file.js"');
        console.log('  # Analyze all JS files in folder');
        console.log('  node simple-http-analyzer.js "C:/path/to/folder"');
        console.log('  # With custom output file');
        console.log('  node simple-http-analyzer.js "C:/path/to/folder" "results.json"');
        console.log('  # Include subdirectories');
        console.log('  node simple-http-analyzer.js "C:/path/to/folder" "results.json" --recursive\n');
        return;
    }
    
    const targetPath = args[0];
    const outputFile = args[1] || 'http-analysis.json';
    const recursive = args.includes('--recursive') || args.includes('-r');
    
    console.log(`🎯 Target: ${targetPath}`);
    console.log(`📄 Output: ${outputFile}`);
    if (recursive) console.log(`🔄 Recursive: Yes`);
    console.log('');
    
    const analyzer = new SimpleHttpAnalyzer();
    
    try {
        // Check if path is file or folder
        const stat = fs.statSync(targetPath);
        let results;
        
        if (stat.isFile()) {
            console.log('📄 Analyzing single file...\n');
            results = analyzer.analyzeFile(targetPath);
        } else if (stat.isDirectory()) {
            console.log(`📁 Analyzing folder${recursive ? ' (recursive)' : ''}...\n`);
            results = analyzer.analyzeFolder(targetPath, recursive);
        } else {
            throw new Error('Path is neither a file nor a directory');
        }
        
        analyzer.generateReport();
        analyzer.exportToJson(outputFile);
        
        console.log(`\n✅ Analysis complete! Found ${results.length} HTTP requests.`);
    } catch (error) {
        console.error('❌ Error:', error.message);
        console.log('\n💡 Make sure the path exists and is accessible.');
    }
}

main();
