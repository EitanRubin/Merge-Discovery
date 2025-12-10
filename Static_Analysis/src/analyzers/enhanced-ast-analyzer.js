import * as babel from '@babel/parser';
import _traverse from '@babel/traverse';
import * as t from '@babel/types';
import path from 'path';
import { EnhancedHTTPCallExtractor } from './enhanced-http-call-extractor.js';
import { AstUtils } from '../ast/ast-utils.js';
import { HTTP_PATTERNS, URL_PATTERNS, HTTP_METHODS, SECURITY_PATTERNS } from '../patterns/http-patterns.js';
import { StringUtils } from '../utils/string-utils.js';

const traverse = _traverse.default;

export class EnhancedASTAnalyzer {
    constructor(options = {}, scopeResolver, configLoadingTracker, httpCallExtractor = null) {
        this.options = {
            deep: true,
            includeSecurityAnalysis: true,
            includePerformanceAnalysis: true,
            trackDynamicUrls: true,
            analyzeHeaders: true,
            ...options
        };
        
        this.results = [];
        this.scopeResolver = scopeResolver;
        this.httpCallExtractor = httpCallExtractor || new EnhancedHTTPCallExtractor(this.scopeResolver);
        this.configLoadingTracker = configLoadingTracker;
        
        // Statistics tracking
        this.stats = {
            totalCalls: 0,
            httpsCalls: 0,
            httpCalls: 0,
            dynamicUrls: 0,
            potentialSecurityIssues: []
        };
    }

    parseCode(content, filePath) {
        try {
            const ext = path.extname(filePath);
            const plugins = ['jsx'];

            if (ext === '.ts' || ext === '.tsx') {
                plugins.push('typescript');
            }

            plugins.push(
                'decorators-legacy', 
                'classProperties', 
                'objectRestSpread', 
                'asyncGenerators', 
                'dynamicImport', 
                'logicalAssignment',
                'optionalChaining',
                'nullishCoalescingOperator',
                'privateClassMethods',
                'exportDefaultFrom',
                'functionBind'
            );

            return babel.parse(content, {
                sourceType: 'module',
                plugins,
                allowImportExportEverywhere: true,
                allowReturnOutsideFunction: true,
                allowAwaitOutsideFunction: true,
                ranges: false,
                tokens: false,
                attachComments: true
            });
        } catch (error) {
            console.error(`⚠️  Parse error in ${filePath}: ${error.message}`);
            return null;
        }
    }

    collectDefinitions(ast, filePath) {
        traverse(ast, {
            ImportDeclaration: (path) => {
                this.configLoadingTracker.handleImportDeclaration(path);
                this.analyzeImportForHttpLibraries(path, filePath);
            },

            'StringLiteral|TemplateLiteral': (path) => {
                this.configLoadingTracker.handleStringAndTemplate(path);
                this.analyzeStringForUrls(path, filePath);
            },

            BinaryExpression: (path) => {
                this.configLoadingTracker.handleBinaryExpression(path);
                this.analyzeBinaryExpressionForUrls(path, filePath);
            }
        });
    }

    configPass(ast, filePath) {
        traverse(ast, {
            VariableDeclarator: (path) => {
                this.configLoadingTracker.memberSeedsPassVariableDeclarator(path);
                this.analyzeVariableForHttpConfig(path, filePath);
            },

            AssignmentExpression: (path) => {
                this.configLoadingTracker.memberSeedsPassAssignmentExpression(path);
            }
        });
    }

    // Enhanced deep analysis with comprehensive traversal
    analyze(ast, filePath) {
        this.results = [];

        // Initialize the comprehensive tracker with the AST
        if (this.httpCallExtractor.initializeWithAST) {
            this.httpCallExtractor.initializeWithAST(ast, filePath);
        }

        traverse(ast, {
            // Standard HTTP calls
            CallExpression: (path) => {
                this.analyzeCallExpression(path, filePath);
            },

            // Constructor calls (new XMLHttpRequest, etc.)
            NewExpression: (path) => {
                this.analyzeNewExpression(path, filePath);
            },

            // Arrow functions and function declarations that might contain HTTP calls
            'ArrowFunctionExpression|FunctionExpression|FunctionDeclaration': (path) => {
                this.analyzeFunctionForAsyncPatterns(path, filePath);
            },

            // Method definitions in classes
            ClassMethod: (path) => {
                this.analyzeClassMethod(path, filePath);
            },

            // Object methods
            ObjectMethod: (path) => {
                this.analyzeObjectMethod(path, filePath);
            },

            // Assignment expressions that might assign HTTP functions
            AssignmentExpression: (path) => {
                this.analyzeAssignmentForHttpPattern(path, filePath);
            },

            // Member expressions for dynamic HTTP calls
            MemberExpression: (path) => {
                this.analyzeMemberExpressionForHttpCall(path, filePath);
            },

            // Conditional expressions that might contain HTTP calls
            ConditionalExpression: (path) => {
                this.analyzeConditionalExpression(path, filePath);
            },

            // Try-catch blocks (common for HTTP error handling)
            TryStatement: (path) => {
                this.analyzeTryStatementForHttpCalls(path, filePath);
            },

            // Promise chains and async/await patterns
            AwaitExpression: (path) => {
                this.analyzeAwaitExpression(path, filePath);
            }
        });

        return this.results;
    }

    analyzeCallExpression(path, filePath) {
        try {
            const node = path.node;
            const calleeInfo = AstUtils.getCalleeInfo2(node.callee);

            if (this.isHTTPCall(calleeInfo)) {
                const httpCall = this.httpCallExtractor.extractHTTPCallInfo(path, filePath, calleeInfo, path.scope);
                if (httpCall) {
                    // Enhanced analysis
                    this.enhanceHttpCall(httpCall, path, filePath);
                    this.results.push(httpCall);
                    this.updateStats(httpCall);
                }
            }

            // Deep analysis: check arguments for nested HTTP calls
            if (this.options.deep) {
                this.analyzeCallArgumentsForHttpCalls(path, filePath);
            }

        } catch (error) {
            console.error('Error at analyzeCallExpression:', error);
        }
    }

    analyzeNewExpression(astPath, filePath) {
        try {
            const node = astPath.node;

            if (t.isIdentifier(node.callee) && node.callee.name === 'XMLHttpRequest') {
                const xhrCall = {
                    type: 'XMLHttpRequest',
                    location: AstUtils.getLocation(astPath, filePath),
                    method: 'unknown',
                    url: 'unknown',
                    rawCode: AstUtils.getCodeSnippet(astPath),
                    category: 'xhr'
                };

                // Try to find method and URL by analyzing surrounding code
                this.analyzeXHRUsage(astPath, xhrCall, filePath);
                this.results.push(xhrCall);
                this.updateStats(xhrCall);
            }

            // Check for WebSocket or other HTTP-related constructors
            if (t.isIdentifier(node.callee) && node.callee.name === 'WebSocket') {
                const wsCall = this.analyzeWebSocketCall(astPath, filePath);
                if (wsCall) {
                    this.results.push(wsCall);
                    this.updateStats(wsCall);
                }
            }

        } catch (error) {
            console.error('Error at analyzeNewExpression:', error);
        }
    }

    // Enhanced HTTP call analysis
    enhanceHttpCall(httpCall, astPath, filePath) {
        // Security analysis
        if (this.options.includeSecurityAnalysis) {
            this.performSecurityAnalysis(httpCall, astPath);
        }

        // Performance analysis
        if (this.options.includePerformanceAnalysis) {
            this.performPerformanceAnalysis(httpCall, astPath);
        }

        // Context analysis
        httpCall.context = this.analyzeCallContext(astPath, filePath);

        // Error handling analysis
        httpCall.errorHandling = this.analyzeErrorHandling(astPath);

        return httpCall;
    }

    performSecurityAnalysis(httpCall, astPath) {
        const security = {
            issues: [],
            score: 100
        };

        // Check for HTTP vs HTTPS
        if (httpCall.url && typeof httpCall.url === 'string') {
            if (SECURITY_PATTERNS.insecure.test(httpCall.url)) {
                security.issues.push({
                    type: 'insecure_protocol',
                    message: 'Using HTTP instead of HTTPS',
                    severity: 'high'
                });
                security.score -= 30;
            }
        }

        // Check for sensitive data in URL
        if (httpCall.parameters) {
            Object.keys(httpCall.parameters).forEach(param => {
                if (SECURITY_PATTERNS.sensitiveParams.some(sensitive => 
                    param.toLowerCase().includes(sensitive))) {
                    security.issues.push({
                        type: 'sensitive_data_in_params',
                        message: `Sensitive parameter '${param}' found in URL`,
                        severity: 'medium'
                    });
                    security.score -= 20;
                }
            });
        }

        // Check for authentication headers
        if (httpCall.headers) {
            const hasAuth = Object.keys(httpCall.headers).some(header =>
                SECURITY_PATTERNS.authHeaders.includes(header.toLowerCase()));
            if (hasAuth) {
                security.issues.push({
                    type: 'auth_header_present',
                    message: 'Authentication header detected',
                    severity: 'info'
                });
            }
        }

        httpCall.security = security;
    }

    performPerformanceAnalysis(httpCall, astPath) {
        const performance = {
            suggestions: []
        };

        // Check if call is in a loop
        const loop = astPath.findParent(p => 
            p.isForStatement() || p.isWhileStatement() || p.isForInStatement() || p.isForOfStatement());
        if (loop) {
            performance.suggestions.push({
                type: 'loop_optimization',
                message: 'HTTP call detected inside a loop - consider batching requests',
                impact: 'high'
            });
        }

        // Check for caching opportunities
        if (httpCall.httpMethod === 'GET' && !httpCall.url?.includes('?')) {
            performance.suggestions.push({
                type: 'caching_opportunity',
                message: 'GET request without parameters - consider caching',
                impact: 'medium'
            });
        }

        httpCall.performance = performance;
    }

    analyzeCallContext(astPath, filePath) {
        const context = {
            function: null,
            class: null,
            module: path.basename(filePath),
            isAsync: false,
            isInTryCatch: false
        };

        // Find containing function
        const func = astPath.getFunctionParent();
        if (func) {
            context.function = AstUtils.getFunctionName(func);
            context.isAsync = func.node.async || false;
        }

        // Find containing class
        const cls = astPath.findParent(p => p.isClassDeclaration() || p.isClassExpression());
        if (cls) {
            context.class = AstUtils.getClassIdentifier(cls);
        }

        // Check if in try-catch
        const tryStmt = astPath.findParent(p => p.isTryStatement());
        context.isInTryCatch = !!tryStmt;

        return context;
    }

    analyzeErrorHandling(astPath) {
        const errorHandling = {
            hasCatch: false,
            hasFinally: false,
            catchPatterns: []
        };

        // Check for try-catch
        const tryStmt = astPath.findParent(p => p.isTryStatement());
        if (tryStmt) {
            errorHandling.hasCatch = !!tryStmt.node.handler;
            errorHandling.hasFinally = !!tryStmt.node.finalizer;
        }

        // Check for .catch() on promises
        const parent = astPath.parent;
        if (t.isMemberExpression(parent) && t.isIdentifier(parent.property, { name: 'catch' })) {
            errorHandling.hasCatch = true;
            errorHandling.catchPatterns.push('promise_catch');
        }

        return errorHandling;
    }

    // Additional analysis methods
    analyzeImportForHttpLibraries(path, filePath) {
        const importSource = path.node.source.value;
        const httpLibraries = ['axios', 'fetch', 'superagent', 'got', 'ky', 'needle', 'request'];
        
        if (httpLibraries.includes(importSource)) {
            this.results.push({
                type: 'http_library_import',
                library: importSource,
                location: AstUtils.getLocation(path, filePath),
                specifiers: path.node.specifiers.map(spec => spec.local.name)
            });
        }
    }

    analyzeStringForUrls(path, filePath) {
        const node = path.node;
        let value = '';

        if (t.isStringLiteral(node)) {
            value = node.value;
        } else if (t.isTemplateLiteral(node)) {
            value = node.quasis.map(q => q.value.cooked).join('');
        }

        if (URL_PATTERNS.http.test(value) || URL_PATTERNS.domain.test(value)) {
            this.results.push({
                type: 'url_string',
                url: value,
                location: AstUtils.getLocation(path, filePath),
                context: 'string_literal'
            });
        }
    }

    isHTTPCall(calleeInfo) {
        const lowerCallee = calleeInfo.toLowerCase();

        for (const [category, patterns] of Object.entries(HTTP_PATTERNS)) {
            for (const pattern of patterns) {
                if (lowerCallee.includes(pattern.toLowerCase()) || 
                    lowerCallee === pattern.toLowerCase()) {
                    return true;
                }
            }
        }
        return false;
    }

    updateStats(httpCall) {
        this.stats.totalCalls++;
        
        if (httpCall.url && typeof httpCall.url === 'string') {
            if (SECURITY_PATTERNS.secure.test(httpCall.url)) {
                this.stats.httpsCalls++;
            } else if (SECURITY_PATTERNS.insecure.test(httpCall.url)) {
                this.stats.httpCalls++;
            }
            
            if (httpCall.url.includes('{') || httpCall.url.includes('$')) {
                this.stats.dynamicUrls++;
            }
        }

        if (httpCall.security?.issues?.length > 0) {
            this.stats.potentialSecurityIssues.push(...httpCall.security.issues);
        }
    }

    analyzeXHRUsage(path, xhrCall, filePath) {
        // Look for subsequent method calls on the XHR object
        const parent = path.parent;
        const binding = path.scope.getBinding(parent?.left?.name || 'xhr');
        
        if (binding) {
            binding.referencePaths.forEach(refPath => {
                const memberExpr = refPath.parent;
                if (t.isMemberExpression(memberExpr) && t.isIdentifier(memberExpr.property)) {
                    const propName = memberExpr.property.name;
                    
                    if (propName === 'open') {
                        const callExpr = refPath.getNextSibling();
                        if (t.isCallExpression(callExpr.node)) {
                            const args = callExpr.node.arguments;
                            if (args.length >= 2) {
                                xhrCall.method = t.isStringLiteral(args[0]) ? args[0].value : 'dynamic';
                                xhrCall.url = t.isStringLiteral(args[1]) ? args[1].value : 'dynamic';
                            }
                        }
                    }
                }
            });
        }
    }

    analyzeWebSocketCall(path, filePath) {
        const node = path.node;
        if (node.arguments.length > 0 && t.isStringLiteral(node.arguments[0])) {
            return {
                type: 'websocket',
                url: node.arguments[0].value,
                location: AstUtils.getLocation(path, filePath),
                category: 'websocket',
                protocol: node.arguments[0].value.startsWith('wss:') ? 'secure' : 'insecure'
            };
        }
        return null;
    }

    // Placeholder methods for additional deep analysis
    analyzeFunctionForAsyncPatterns(path, filePath) {
        // TODO: Analyze function body for async HTTP patterns
    }

    analyzeClassMethod(path, filePath) {
        // TODO: Analyze class methods for HTTP patterns
    }

    analyzeObjectMethod(path, filePath) {
        // TODO: Analyze object methods for HTTP patterns
    }

    analyzeAssignmentForHttpPattern(path, filePath) {
        // TODO: Analyze assignments that might create HTTP functions
    }

    analyzeMemberExpressionForHttpCall(path, filePath) {
        // TODO: Analyze member expressions for dynamic HTTP calls
    }

    analyzeConditionalExpression(path, filePath) {
        // TODO: Analyze conditional expressions containing HTTP calls
    }

    analyzeTryStatementForHttpCalls(path, filePath) {
        // TODO: Analyze try statements for HTTP error handling patterns
    }

    analyzeAwaitExpression(path, filePath) {
        // TODO: Analyze await expressions for HTTP calls
    }

    analyzeCallArgumentsForHttpCalls(path, filePath) {
        // TODO: Deep analysis of call arguments for nested HTTP calls
    }

    analyzeVariableForHttpConfig(path, filePath) {
        // TODO: Analyze variables that might contain HTTP configurations
    }

    analyzeBinaryExpressionForUrls(path, filePath) {
        // TODO: Analyze binary expressions for URL construction
    }

    getHTTPCalls() {
        return this.results;
    }

    getStats() {
        return this.stats;
    }

    getConfigTraces() {
        return this.scopeResolver.getConfigTraces();
    }
}
