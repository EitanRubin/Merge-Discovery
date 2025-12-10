import { EnhancedASTAnalyzer } from './analyzers/enhanced-ast-analyzer.js';
import { EnhancedHTTPCallExtractor } from './analyzers/enhanced-http-call-extractor.js';
import { CodePatternAnalyzer } from './analyzers/code-pattern-analyzer.js';
import { StaticValueResolver } from './analyzers/static-value-resolver.js';
import { ScopeResolver } from './analyzers/scope-resolver.js';
import { ConfigLoadingTracker } from './analyzers/config-loading-tracker.js';
import { JsonConfigScanner } from './analyzers/json-config-scanner.js';
import { HTTP_PATTERNS, URL_PATTERNS, SECURITY_PATTERNS } from './patterns/http-patterns.js';
import { ValidationUtils } from './utils/validation-utils.js';
import { AstUtils } from './ast/ast-utils.js';
import { StringUtils } from './utils/string-utils.js';
import fs from 'fs';
import path from 'path';
import { globSync } from 'glob';
import chalk from 'chalk';
import _traverse from '@babel/traverse';

const traverse = _traverse.default;

export class DeepHTTPAnalyzer {
    constructor(options = {}) {
        this.options = {
            // Analysis depth
            deep: true,
            includeSecurityAnalysis: true,
            includePerformanceAnalysis: true,
            trackDynamicUrls: true,
            analyzeHeaders: true,
            detectPatterns: true,
            
            // File processing
            includeExtensions: ['.js', '.jsx', '.ts', '.tsx', '.vue', '.mjs', '.cjs', '.php', '.py', '.rb', '.java', '.cs', '.cpp', '.c', '.h', '.go', '.rs', '.kt', '.swift', '.dart', '.scala', '.html', '.xml', '.json', '.yml', '.yaml'],
            excludePatterns: ['node_modules', 'dist', 'build', '.git', 'coverage', '__pycache__', 'vendor', 'target', 'bin', 'obj', '.next', '.nuxt', 'tmp', 'temp', '.cache'],
            
            // Output options
            verbose: false,
            includeContext: true,
            includeStats: true,
            
            ...options
        };

        this.scopeResolver = new ScopeResolver();
        this.jsonConfigScanner = new JsonConfigScanner();
        this.configLoadingTracker = new ConfigLoadingTracker(this.scopeResolver, this.jsonConfigScanner);
        this.codePatternAnalyzer = new CodePatternAnalyzer();
        this.staticValueResolver = new StaticValueResolver();
        this.enhancedHTTPCallExtractor = new EnhancedHTTPCallExtractor(this.scopeResolver);
        this.astAnalyzer = new EnhancedASTAnalyzer(this.options, this.scopeResolver, this.configLoadingTracker, this.enhancedHTTPCallExtractor);
        
        this.results = {
            httpCalls: [],
            urlStrings: [],
            imports: [],
            statistics: {
                totalFiles: 0,
                filesWithHttpCalls: 0,
                totalHttpCalls: 0,
                librariesUsed: new Set(),
                securityIssues: [],
                performanceIssues: []
            }
        };
    }

    /**
     * Perform deep analysis of HTTP/HTTPS calls in a directory
     */
    async analyzeDirectory(dirPath) {
        if (!ValidationUtils.isValidDirectory(dirPath)) {
            throw new Error(`Invalid directory: ${dirPath}`);
        }

        console.log(chalk.blue('🔍 Starting Deep HTTP Analysis...'));
        
        try {
            // Phase 1: Scan for JSON configurations
            await this.scanConfigurations(dirPath);
            
            // Phase 2: Collect files to analyze
            const files = this.collectFiles(dirPath);
            this.results.statistics.totalFiles = files.length;
            
            console.log(chalk.blue(`📁 Found ${files.length} files to analyze`));
            
            // Phase 3: Collect definitions (imports, configs, etc.)
            await this.collectDefinitions(files);
            
            // Phase 4: Perform deep analysis
            await this.performDeepAnalysis(files);
            
            // Phase 5: Post-processing and statistics
            this.postProcess();
            
            console.log(chalk.green('✅ Deep analysis complete!'));
            return this.results;
            
        } catch (error) {
            console.error(chalk.red('❌ Error during analysis:'), error);
            throw error;
        }
    }

    /**
     * Analyze a single file for HTTP calls
     */
    async analyzeFile(filePath) {
        if (!fs.existsSync(filePath)) {
            throw new Error(`File not found: ${filePath}`);
        }

        console.log(chalk.blue(`🔍 Analyzing file: ${path.basename(filePath)}`));
        
        try {
            const content = fs.readFileSync(filePath, 'utf8');
            const ast = this.astAnalyzer.parseCode(content, filePath);
            
            if (!ast) {
                console.warn(chalk.yellow(`⚠️  Could not parse ${filePath}`));
                return { httpCalls: [], issues: ['parse_error'] };
            }

            // Collect definitions
            this.astAnalyzer.collectDefinitions(ast, filePath);
            
            // Perform analysis
            const fileResults = this.astAnalyzer.analyze(ast, filePath);
            
            return {
                file: filePath,
                httpCalls: fileResults,
                stats: this.astAnalyzer.getStats()
            };
            
        } catch (error) {
            console.error(chalk.red(`❌ Error analyzing ${filePath}:`), error);
            return { httpCalls: [], issues: [error.message] };
        }
    }

    /**
     * Find all HTTP/HTTPS calls with advanced pattern matching
     */
    findAllHttpCalls(ast, filePath) {
        const calls = [];
        
        traverse(ast, {
            enter: (path) => {
                // Multiple strategies for finding HTTP calls
                const strategies = [
                    () => this.findDirectHttpCalls(path, filePath),
                    () => this.findDynamicHttpCalls(path, filePath),
                    () => this.findIndirectHttpCalls(path, filePath),
                    () => this.findFrameworkSpecificCalls(path, filePath)
                ];

                for (const strategy of strategies) {
                    try {
                        const found = strategy();
                        if (found) {
                            calls.push(...(Array.isArray(found) ? found : [found]));
                        }
                    } catch (error) {
                        if (this.options.verbose) {
                            console.debug('Strategy error:', error);
                        }
                    }
                }
            }
        });

        return calls;
    }

    /**
     * Find direct HTTP calls (fetch, axios.get, etc.)
     */
    findDirectHttpCalls(path, filePath) {
        if (path.isCallExpression()) {
            const calleeInfo = this.getCalleeInfo(path.node.callee);
            if (this.isHttpCall(calleeInfo)) {
                return this.enhancedHTTPCallExtractor.extractHTTPCallInfo(
                    path, filePath, calleeInfo, path.scope
                );
            }
        }
        return null;
    }

    /**
     * Find dynamic HTTP calls (variables containing HTTP functions)
     */
    findDynamicHttpCalls(path, filePath) {
        if (path.isCallExpression() && path.node.callee.type === 'Identifier') {
            const binding = path.scope.getBinding(path.node.callee.name);
            if (binding && binding.path.isVariableDeclarator()) {
                const init = binding.path.node.init;
                if (init && (this.isHttpFunction(init) || this.looksLikeHttpCall(init))) {
                    return {
                        type: 'dynamic_http_call',
                        variable: path.node.callee.name,
                        location: this.getLocation(path, filePath),
                        originalDefinition: this.getCodeSnippet(binding.path),
                        confidence: 'medium'
                    };
                }
            }
        }
        return null;
    }

    /**
     * Find indirect HTTP calls (callbacks, promises, etc.)
     */
    findIndirectHttpCalls(path, filePath) {
        // Look for promise chains that might contain HTTP calls
        if (path.isMemberExpression() && 
            path.node.property.type === 'Identifier' && 
            ['then', 'catch', 'finally'].includes(path.node.property.name)) {
            
            const parent = path.parent;
            if (parent.type === 'CallExpression') {
                // This might be a promise chain from an HTTP call
                const objectInfo = this.getCalleeInfo(path.node.object);
                if (this.isHttpCall(objectInfo) || this.looksLikeHttpCall(path.node.object)) {
                    return {
                        type: 'promise_chain',
                        method: path.node.property.name,
                        location: this.getLocation(path, filePath),
                        chainedFrom: objectInfo
                    };
                }
            }
        }
        return null;
    }

    /**
     * Find framework-specific HTTP patterns
     */
    findFrameworkSpecificCalls(path, filePath) {
        const frameworks = {
            react: this.findReactHttpPatterns.bind(this),
            vue: this.findVueHttpPatterns.bind(this),
            angular: this.findAngularHttpPatterns.bind(this),
            express: this.findExpressHttpPatterns.bind(this)
        };

        const results = [];
        for (const [framework, finder] of Object.entries(frameworks)) {
            const found = finder(path, filePath);
            if (found) {
                results.push(...(Array.isArray(found) ? found : [found]));
            }
        }
        
        return results.length > 0 ? results : null;
    }

    /**
     * React-specific patterns (useEffect with fetch, SWR, React Query, etc.)
     */
    findReactHttpPatterns(path, filePath) {
        // useSWR, useQuery patterns
        if (path.isCallExpression() && path.node.callee.type === 'Identifier') {
            const reactHttpHooks = ['useSWR', 'useQuery', 'useMutation', 'useFetch'];
            if (reactHttpHooks.includes(path.node.callee.name)) {
                return {
                    type: 'react_hook',
                    hook: path.node.callee.name,
                    location: this.getLocation(path, filePath),
                    framework: 'react'
                };
            }
        }

        // useEffect with HTTP calls
        if (path.isCallExpression() && 
            path.node.callee.type === 'Identifier' && 
            path.node.callee.name === 'useEffect') {
            
            const callback = path.node.arguments[0];
            if (callback && callback.type === 'ArrowFunctionExpression') {
                // Check if body contains HTTP calls
                if (this.containsHttpCall(callback.body)) {
                    return {
                        type: 'useeffect_http',
                        location: this.getLocation(path, filePath),
                        framework: 'react'
                    };
                }
            }
        }

        return null;
    }

    findVueHttpPatterns(path, filePath) {
        // Vue.js patterns like this.$http, useFetch, etc.
        if (path.isMemberExpression() && 
            path.node.object.type === 'ThisExpression' &&
            path.node.property.type === 'Identifier' &&
            ['$http', '$fetch', '$axios'].includes(path.node.property.name)) {
            
            return {
                type: 'vue_instance_method',
                method: path.node.property.name,
                location: this.getLocation(path, filePath),
                framework: 'vue'
            };
        }
        return null;
    }

    findAngularHttpPatterns(path, filePath) {
        // Angular HttpClient patterns
        if (path.isMemberExpression()) {
            const objectName = path.node.object.name;
            if (objectName && ['http', 'httpClient', '$http'].includes(objectName)) {
                return {
                    type: 'angular_http',
                    service: objectName,
                    location: this.getLocation(path, filePath),
                    framework: 'angular'
                };
            }
        }
        return null;
    }

    findExpressHttpPatterns(path, filePath) {
        // Express.js route handlers
        if (path.isMemberExpression() && 
            path.node.object.type === 'Identifier' &&
            ['app', 'router'].includes(path.node.object.name) &&
            path.node.property.type === 'Identifier' &&
            ['get', 'post', 'put', 'delete', 'patch'].includes(path.node.property.name)) {
            
            return {
                type: 'express_route',
                method: path.node.property.name.toUpperCase(),
                location: this.getLocation(path, filePath),
                framework: 'express'
            };
        }
        return null;
    }

    /**
     * Advanced URL detection from various sources
     */
    findAllUrls(ast, filePath) {
        const urls = [];
        
        traverse(ast, {
            StringLiteral: (path) => {
                if (this.looksLikeUrl(path.node.value)) {
                    urls.push({
                        type: 'string_url',
                        url: path.node.value,
                        location: this.getLocation(path, filePath),
                        context: this.getUrlContext(path)
                    });
                }
            },
            
            TemplateLiteral: (path) => {
                const reconstructed = this.reconstructTemplateLiteral(path.node);
                if (this.looksLikeUrl(reconstructed)) {
                    urls.push({
                        type: 'template_url',
                        url: reconstructed,
                        location: this.getLocation(path, filePath),
                        dynamic: true
                    });
                }
            },
            
            MemberExpression: (path) => {
                // Environment variables, config objects
                const memberInfo = this.getMemberExpressionInfo(path.node);
                if (this.looksLikeUrlProperty(memberInfo)) {
                    urls.push({
                        type: 'member_url',
                        property: memberInfo,
                        location: this.getLocation(path, filePath),
                        dynamic: true
                    });
                }
            }
        });
        
        return urls;
    }

    /**
     * Security analysis for HTTP calls
     */
    performSecurityAnalysis(httpCalls) {
        const issues = [];
        
        for (const call of httpCalls) {
            // HTTP vs HTTPS
            if (call.url && typeof call.url === 'string') {
                if (SECURITY_PATTERNS.insecure.test(call.url)) {
                    issues.push({
                        type: 'insecure_protocol',
                        severity: 'high',
                        message: 'Using HTTP instead of HTTPS',
                        location: call.location,
                        url: call.url
                    });
                }
            }

            // Sensitive data in URLs
            if (call.parameters) {
                for (const [param, value] of Object.entries(call.parameters)) {
                    if (SECURITY_PATTERNS.sensitiveParams.some(sensitive => 
                        param.toLowerCase().includes(sensitive))) {
                        issues.push({
                            type: 'sensitive_data_in_url',
                            severity: 'medium',
                            message: `Potentially sensitive parameter '${param}' in URL`,
                            location: call.location
                        });
                    }
                }
            }

            // Missing authentication
            if (!call.headers || !Object.keys(call.headers).some(header =>
                SECURITY_PATTERNS.authHeaders.includes(header.toLowerCase()))) {
                issues.push({
                    type: 'missing_auth',
                    severity: 'low',
                    message: 'No authentication headers detected',
                    location: call.location
                });
            }
        }
        
        return issues;
    }

    // Implementation of helper methods and remaining functionality
    async scanConfigurations(dirPath) {
        const configs = this.jsonConfigScanner.scanFolder(dirPath);
        for (const [key, config] of configs.keys.entries()) {
            this.scopeResolver.addConfigTrace(key, config.value, config.file, 'json-config');
        }
    }

    collectFiles(dirPath) {
        const normalizedPath = dirPath.replace(/\\/g, '/');
        const pattern = `${normalizedPath}/**/*.{${this.options.includeExtensions.map(ext => ext.slice(1)).join(',')}}`;
        
        const isAbsolute = path.isAbsolute(dirPath);
        const ignorePatternsNew = this.options.excludePatterns.map(p =>
            isAbsolute ? `${normalizedPath}/${p}/**` : `**/${p}/**`
        );

        return globSync(pattern, {
            ignore: ignorePatternsNew,
        });
    }

    async collectDefinitions(files) {
        console.log(chalk.blue('📚 Collecting definitions...'));
        
        // Collect all ASTs for ultimate resolver
        const allASTs = new Map();
        
        for (const file of files) {
            try {
                const content = fs.readFileSync(file, 'utf8');
                const ast = this.astAnalyzer.parseCode(content, file);
                
                if (ast) {
                    // Store AST for ultimate resolver
                    allASTs.set(file, ast);
                    
                    // Collect standard definitions
                    this.astAnalyzer.collectDefinitions(ast, file);
                    
                    // Analyze code patterns for better URL resolution
                    this.codePatternAnalyzer.analyzeFile(ast, file);
                    
                    // Extract static values (variables, properties, etc.)
                    this.staticValueResolver.analyzeFile(ast, file);
                }
            } catch (error) {
                if (this.options.verbose) {
                    console.warn(chalk.yellow(`⚠️  Could not collect definitions from ${file}: ${error.message}`));
                }
            }
        }
        
        // Initialize ultimate resolver with all ASTs
        if (this.enhancedHTTPCallExtractor.initializeWithCodebase) {
            this.enhancedHTTPCallExtractor.initializeWithCodebase(allASTs);
        }
        
        // Pass the analysis results to the URL resolver
        if (this.enhancedHTTPCallExtractor.urlResolver) {
            const patterns = this.codePatternAnalyzer.getAllPatterns();
            this.enhancedHTTPCallExtractor.urlResolver.setCodePatterns(patterns);
            
            // Pass the static value resolver for real-time resolution
            this.enhancedHTTPCallExtractor.urlResolver.setStaticValueResolver(this.staticValueResolver);
        }
        
        if (this.options.verbose) {
            const resolvedValues = this.staticValueResolver.getAllResolvedValues();
            console.log(chalk.gray(`📋 Found ${resolvedValues.variables.length} variables, ${resolvedValues.objectProperties.length} object properties, ${resolvedValues.classProperties.length} class properties`));
            
            // Show some examples of what we found
            if (resolvedValues.variables.length > 0) {
                console.log(chalk.gray('   Variables:'));
                resolvedValues.variables.slice(0, 5).forEach(([name, data]) => {
                    console.log(chalk.gray(`     ${name} = ${data.value}`));
                });
            }
            
            if (resolvedValues.objectProperties.length > 0) {
                console.log(chalk.gray('   Object Properties:'));
                resolvedValues.objectProperties.slice(0, 5).forEach(([key, data]) => {
                    console.log(chalk.gray(`     ${key} = ${data.value}`));
                });
            }
            
            if (resolvedValues.classProperties.length > 0) {
                console.log(chalk.gray('   Class Properties:'));
                resolvedValues.classProperties.slice(0, 5).forEach(([key, data]) => {
                    console.log(chalk.gray(`     ${key} = ${data.value}`));
                });
            }
        }
    }

    async performDeepAnalysis(files) {
        console.log(chalk.blue('🔬 Performing deep analysis...'));
        
        for (const file of files) {
            try {
                const fileResult = await this.analyzeFile(file);
                
                if (fileResult.httpCalls.length > 0) {
                    this.results.statistics.filesWithHttpCalls++;
                    this.results.httpCalls.push(...fileResult.httpCalls);
                }
                
                // Update statistics
                this.updateStatistics(fileResult);
                
            } catch (error) {
                if (this.options.verbose) {
                    console.warn(chalk.yellow(`⚠️  Error analyzing ${file}: ${error.message}`));
                }
            }
        }
    }

    postProcess() {
        // Perform security analysis
        if (this.options.includeSecurityAnalysis) {
            this.results.statistics.securityIssues = this.performSecurityAnalysis(this.results.httpCalls);
        }

        // Calculate final statistics
        this.results.statistics.totalHttpCalls = this.results.httpCalls.length;
        this.results.statistics.librariesUsed = Array.from(this.results.statistics.librariesUsed);
    }

    updateStatistics(fileResult) {
        if (fileResult.httpCalls) {
            for (const call of fileResult.httpCalls) {
                if (call.category) {
                    this.results.statistics.librariesUsed.add(call.category);
                }
            }
        }
    }

    // Utility methods (implementations would be added here)
    getCalleeInfo(callee) {
        // Implementation from existing AstUtils
        return AstUtils.getCalleeInfo2(callee);
    }

    isHttpCall(calleeInfo) {
        return this.astAnalyzer.isHTTPCall(calleeInfo);
    }

    getLocation(path, filePath) {
        return AstUtils.getLocation(path, filePath);
    }

    getCodeSnippet(path) {
        return AstUtils.getCodeSnippet(path);
    }

    looksLikeUrl(str) {
        return StringUtils.looksLikeUrl(str);
    }

    // Additional utility methods would be implemented here...
    isHttpFunction(node) {
        // Check if a node represents an HTTP function
        return false; // Implementation needed
    }

    looksLikeHttpCall(node) {
        // Check if a node looks like an HTTP call
        return false; // Implementation needed
    }

    containsHttpCall(node) {
        // Check if a node contains HTTP calls
        return false; // Implementation needed
    }

    getUrlContext(path) {
        // Get context information for a URL
        return 'unknown'; // Implementation needed
    }

    reconstructTemplateLiteral(node) {
        // Reconstruct template literal
        return ''; // Implementation needed
    }

    getMemberExpressionInfo(node) {
        return AstUtils.getMemberExpressionInfo2(node);
    }

    looksLikeUrlProperty(memberInfo) {
        const urlKeywords = ['url', 'endpoint', 'api', 'host', 'baseurl', 'uri', 'href'];
        return urlKeywords.some(keyword => memberInfo.toLowerCase().includes(keyword));
    }

    // Public API methods
    getResults() {
        return this.results;
    }

    getStatistics() {
        return this.results.statistics;
    }

    generateReport() {
        const report = {
            metadata: {
                analyzer: 'Deep HTTP Analyzer',
                version: '1.0.0',
                timestamp: new Date().toISOString(),
                analysisType: 'comprehensive'
            },
            summary: {
                ...this.results.statistics,
                analysisDate: new Date().toISOString()
            },
            httpCalls: this.results.httpCalls,
            urlStrings: this.results.urlStrings || [],
            imports: this.results.imports || [],
            security: {
                issues: this.results.statistics.securityIssues || [],
                httpsCoverage: this.calculateHttpsCoverage(this.results.httpCalls),
                recommendations: this.generateRecommendations().filter(r => r.type === 'security')
            },
            performance: {
                issues: this.extractPerformanceIssues(),
                recommendations: this.generateRecommendations().filter(r => r.type === 'performance'),
                statistics: this.generatePerformanceStats()
            },
            groupedByFile: this.groupByFile(this.results.httpCalls),
            groupedByLibrary: this.groupByLibrary(this.results.httpCalls),
            groupedByMethod: this.groupByMethod(this.results.httpCalls)
        };

        return report;
    }

    extractPerformanceIssues() {
        const issues = [];
        this.results.httpCalls.forEach(call => {
            if (call.performance && call.performance.suggestions.length > 0) {
                issues.push({
                    location: call.location,
                    suggestions: call.performance.suggestions,
                    httpCall: {
                        method: call.httpMethod,
                        url: call.url,
                        library: call.category
                    }
                });
            }
        });
        return issues;
    }

    generatePerformanceStats() {
        const stats = {
            totalCalls: this.results.httpCalls.length,
            methodDistribution: {},
            libraryDistribution: {},
            averageCallsPerFile: 0
        };

        // Method distribution
        this.results.httpCalls.forEach(call => {
            const method = call.httpMethod || 'UNKNOWN';
            stats.methodDistribution[method] = (stats.methodDistribution[method] || 0) + 1;
        });

        // Library distribution
        this.results.httpCalls.forEach(call => {
            const library = call.category || 'unknown';
            stats.libraryDistribution[library] = (stats.libraryDistribution[library] || 0) + 1;
        });

        // Average calls per file
        const fileCount = this.results.statistics.filesWithHttpCalls || 1;
        stats.averageCallsPerFile = Math.round(stats.totalCalls / fileCount * 100) / 100;

        return stats;
    }

    groupByFile(httpCalls) {
        const grouped = {};
        httpCalls.forEach(call => {
            const file = call.location?.file || 'unknown';
            if (!grouped[file]) {
                grouped[file] = {
                    count: 0,
                    calls: []
                };
            }
            grouped[file].count++;
            grouped[file].calls.push(call);
        });
        return grouped;
    }

    groupByLibrary(httpCalls) {
        const grouped = {};
        httpCalls.forEach(call => {
            const library = call.category || 'unknown';
            if (!grouped[library]) {
                grouped[library] = {
                    count: 0,
                    calls: []
                };
            }
            grouped[library].count++;
            grouped[library].calls.push(call);
        });
        return grouped;
    }

    groupByMethod(httpCalls) {
        const grouped = {};
        httpCalls.forEach(call => {
            const method = call.httpMethod || 'UNKNOWN';
            if (!grouped[method]) {
                grouped[method] = {
                    count: 0,
                    calls: []
                };
            }
            grouped[method].count++;
            grouped[method].calls.push(call);
        });
        return grouped;
    }

    exportToJSON(filename = null) {
        const timestamp = new Date().toISOString().slice(0, 19).replace(/:/g, '-');
        const defaultFilename = `http-analysis-${timestamp}.json`;
        const finalFilename = filename || defaultFilename;
        
        const report = this.generateSimplifiedReport();
        
        try {
            fs.writeFileSync(finalFilename, JSON.stringify(report, null, 2));
            return {
                success: true,
                filename: finalFilename,
                size: fs.statSync(finalFilename).size,
                callCount: report.length
            };
        } catch (error) {
            return {
                success: false,
                error: error.message
            };
        }
    }

    /**
     * Generate simplified report in the format:
     * { endpoint, method, authentication, requests_count }
     */
    generateSimplifiedReport() {
        const endpointMap = new Map();
        
        for (const call of this.results.httpCalls) {
            // Get endpoint (URL)
            const endpoint = call.url || call.rawCode || 'unknown';
            const method = call.httpMethod || 'UNKNOWN';
            
            // Determine authentication status
            let authentication = 'anonymous';
            if (call.headers) {
                const headerKeys = Object.keys(call.headers).map(k => k.toLowerCase());
                if (headerKeys.some(h => ['authorization', 'x-api-key', 'x-auth-token', 'bearer'].includes(h))) {
                    authentication = 'authenticated';
                }
            }
            
            // Check if there are auth-related security issues
            const hasAuthIssue = call.security?.issues?.some(issue => 
                issue.type === 'missing_auth'
            );
            if (hasAuthIssue) {
                authentication = 'anonymous';
            }
            
            // Create unique key for grouping
            const key = `${endpoint}|${method}|${authentication}`;
            
            if (endpointMap.has(key)) {
                const existing = endpointMap.get(key);
                existing.requests_count++;
                // Add location info
                if (call.location) {
                    existing.locations.push(call.location);
                }
            } else {
                endpointMap.set(key, {
                    endpoint: endpoint,
                    method: method,
                    authentication: authentication,
                    requests_count: 1,
                    locations: call.location ? [call.location] : []
                });
            }
        }
        
        // Convert to array and sort by requests_count descending
        return Array.from(endpointMap.values())
            .sort((a, b) => b.requests_count - a.requests_count);
    }

    generateRecommendations() {
        const recommendations = [];
        
        // Security recommendations
        if (this.results.statistics.securityIssues.some(issue => issue.type === 'insecure_protocol')) {
            recommendations.push({
                type: 'security',
                priority: 'high',
                message: 'Replace HTTP URLs with HTTPS for secure communication'
            });
        }

        // Performance recommendations
        const httpCallCount = this.results.statistics.totalHttpCalls;
        if (httpCallCount > 50) {
            recommendations.push({
                type: 'performance',
                priority: 'medium',
                message: 'Consider implementing request caching or batching for better performance'
            });
        }

        return recommendations;
    }

    generateSecurityReport() {
        const results = this.getResults();
        return {
            summary: results.statistics,
            securityIssues: results.statistics.securityIssues || [],
            recommendations: this.generateRecommendations(),
            httpsCoverage: this.calculateHttpsCoverage(results.httpCalls)
        };
    }

    generatePerformanceReport() {
        const results = this.getResults();
        const performanceIssues = [];
        
        results.httpCalls.forEach(call => {
            if (call.performance && call.performance.suggestions.length > 0) {
                performanceIssues.push({
                    location: call.location,
                    suggestions: call.performance.suggestions
                });
            }
        });

        return {
            totalCalls: results.statistics.totalHttpCalls,
            performanceIssues,
            recommendations: this.generatePerformanceRecommendations(results.httpCalls)
        };
    }

    calculateHttpsCoverage(httpCalls) {
        if (!httpCalls || httpCalls.length === 0) return 0;
        
        const httpsCallsCount = httpCalls.filter(call => 
            call.url && typeof call.url === 'string' && call.url.startsWith('https:')
        ).length;
        
        return Math.round((httpsCallsCount / httpCalls.length) * 100);
    }

    generatePerformanceRecommendations(httpCalls) {
        const recommendations = [];
        const callsInLoops = httpCalls.filter(call => 
            call.performance?.suggestions?.some(s => s.type === 'loop_optimization')
        ).length;
        
        if (callsInLoops > 0) {
            recommendations.push({
                type: 'batch_requests',
                message: `${callsInLoops} HTTP calls detected in loops - consider request batching`,
                priority: 'high'
            });
        }

        const getCalls = httpCalls.filter(call => call.httpMethod === 'GET').length;
        if (getCalls > 20) {
            recommendations.push({
                type: 'caching',
                message: `${getCalls} GET requests found - implement caching strategy`,
                priority: 'medium'
            });
        }

        return recommendations;
    }
}

export default DeepHTTPAnalyzer;
