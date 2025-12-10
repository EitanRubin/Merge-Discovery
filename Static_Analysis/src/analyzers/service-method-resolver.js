import * as t from '@babel/types';
import _traverse from '@babel/traverse';
import { AstUtils } from '../ast/ast-utils.js';

const traverse = _traverse.default;

/**
 * Service Method Resolver - Specifically handles .subscribe patterns and service DI
 */
export class ServiceMethodResolver {
    constructor() {
        this.serviceClasses = new Map();      // ServiceName -> { methods: Map, properties: Map }
        this.serviceMethods = new Map();      // ServiceName.methodName -> method AST + body
        this.httpCallsInMethods = new Map();  // ServiceName.methodName -> HTTP call details
        this.urlVariables = new Map();        // className.propName -> resolved URL
        this.allASTs = new Map();             // filePath -> AST
        this.isInitialized = false;
    }

    /**
     * Initialize with full codebase analysis
     */
    initializeWithCodebase(allASTs) {
        if (this.isInitialized) return;
        
        this.allASTs = allASTs;
        console.debug('🔍 Service Method Resolver: Analyzing', allASTs.size, 'files');

        // Phase 1: Find all service classes and their methods
        for (const [filePath, ast] of allASTs.entries()) {
            this.findServiceClasses(ast, filePath);
        }

        // Phase 2: Analyze each service method for HTTP calls
        for (const [filePath, ast] of allASTs.entries()) {
            this.analyzeServiceMethods(ast, filePath);
        }

        // Phase 3: Extract URL variables and properties
        for (const [filePath, ast] of allASTs.entries()) {
            this.extractUrlVariables(ast, filePath);
        }

        // Phase 4: Process service aliases and copy HTTP calls
        this.processServiceAliases();

        console.debug('✅ Found', this.serviceClasses.size, 'service classes');
        console.debug('✅ Found', this.serviceMethods.size, 'service methods');
        console.debug('✅ Found', this.httpCallsInMethods.size, 'methods with HTTP calls');
        
        this.isInitialized = true;
    }

    /**
     * Find all service classes in the AST
     */
    findServiceClasses(ast, filePath) {
        traverse(ast, {
            // Find class declarations
            ClassDeclaration: (path) => {
                const className = path.node.id.name;
                console.debug(`🔍 Found ClassDeclaration: ${className}, isService: ${this.isServiceClass(className)}`);
                
                if (this.isServiceClass(className)) {
                    this.registerServiceClass(className, path, filePath);
                }
            },

            // Find variable assignments to classes (var _ItemService = class _ItemService { ... })
            VariableDeclarator: (path) => {
                // Handle var _ItemService = class _ItemService { ... }
                if (t.isIdentifier(path.node.id) && t.isClassExpression(path.node.init)) {
                    const varName = path.node.id.name;
                    console.debug(`🔍 Found ClassExpression in variable: ${varName}, isService: ${this.isServiceClass(varName)}`);
                    
                    if (this.isServiceClass(varName)) {
                        // Create a wrapper path that looks like a class declaration
                        const classPath = {
                            node: {
                                ...path.node.init,
                                id: path.node.id // Use the variable name as class name
                            },
                            traverse: path.get('init').traverse.bind(path.get('init'))
                        };
                        this.registerServiceClass(varName, classPath, filePath);
                    }
                }
                
                // Handle var ItemService = _ItemService (aliases)
                else if (t.isIdentifier(path.node.id) && t.isIdentifier(path.node.init)) {
                    const varName = path.node.id.name;
                    const initName = path.node.init.name;
                    
                    // Link service aliases
                    if (this.isServiceClass(varName) || this.isServiceClass(initName)) {
                        console.debug(`🔗 Found service alias: ${varName} = ${initName}`);
                        
                        // Just track the alias for now - will be processed later
                        if (this.serviceClasses.has(initName)) {
                            this.serviceClasses.set(varName, this.serviceClasses.get(initName));
                        } else if (this.serviceClasses.has(varName)) {
                            this.serviceClasses.set(initName, this.serviceClasses.get(varName));
                        }
                    }
                }
            }
        });
    }

    /**
     * Register a service class with its methods
     */
    registerServiceClass(className, classPath, filePath) {
        console.debug(`📝 Registering service class: ${className} in ${filePath}`);
        
        const serviceInfo = {
            className: className,
            filePath: filePath,
            methods: new Map(),
            properties: new Map(),
            constructor: null
        };

        // Find all methods in this class
        if (classPath.traverse) {
            classPath.traverse({
                ClassMethod: (methodPath) => {
                    const methodName = methodPath.node.key.name;
                    const methodKey = `${className}.${methodName}`;
                    console.debug(`📋 Found method: ${methodKey}`);
                    
                    serviceInfo.methods.set(methodName, {
                        path: methodPath,
                        name: methodName,
                        isConstructor: methodName === 'constructor',
                        body: methodPath.node.body
                    });

                    this.serviceMethods.set(methodKey, {
                        className: className,
                        methodName: methodName,
                        path: methodPath,
                        body: methodPath.node.body,
                        filePath: filePath
                    });

                    if (methodName === 'constructor') {
                        serviceInfo.constructor = methodPath;
                        this.extractConstructorProperties(methodPath, className);
                    }
                },

                // Class properties
                ClassProperty: (propPath) => {
                    if (t.isIdentifier(propPath.node.key)) {
                        const propName = propPath.node.key.name;
                        console.debug(`🏷️  Found property: ${className}.${propName}`);
                        serviceInfo.properties.set(propName, {
                            name: propName,
                            value: propPath.node.value,
                            path: propPath
                        });
                    }
                }
            });
        } else {
            // Handle case where we don't have traverse method - inspect the class body directly
            if (classPath.node && classPath.node.body && classPath.node.body.body) {
                classPath.node.body.body.forEach((bodyNode, index) => {
                    if (t.isMethodDefinition(bodyNode) && t.isIdentifier(bodyNode.key)) {
                        const methodName = bodyNode.key.name;
                        const methodKey = `${className}.${methodName}`;
                        console.debug(`📋 Found method (direct): ${methodKey}`);
                        
                        serviceInfo.methods.set(methodName, {
                            node: bodyNode,
                            name: methodName,
                            isConstructor: methodName === 'constructor',
                            body: bodyNode.value.body
                        });

                        this.serviceMethods.set(methodKey, {
                            className: className,
                            methodName: methodName,
                            node: bodyNode,
                            body: bodyNode.value.body,
                            filePath: filePath
                        });
                    }
                });
            }
        }

        this.serviceClasses.set(className, serviceInfo);
    }

    /**
     * Extract constructor properties (this.apiUrl = ...)
     */
    extractConstructorProperties(constructorPath, className) {
        constructorPath.traverse({
            AssignmentExpression: (assignPath) => {
                if (t.isMemberExpression(assignPath.node.left) && 
                    t.isThisExpression(assignPath.node.left.object) &&
                    t.isIdentifier(assignPath.node.left.property)) {
                    
                    const propName = assignPath.node.left.property.name;
                    const propKey = `${className}.${propName}`;
                    
                    const resolvedValue = this.resolveNodeValue(assignPath.node.right, assignPath.scope);
                    if (resolvedValue) {
                        this.urlVariables.set(propKey, resolvedValue);
                        console.debug(`📍 Found property: ${propKey} = ${resolvedValue}`);
                    }
                }
            }
        });
    }

    /**
     * Analyze service methods for HTTP calls
     */
    analyzeServiceMethods(ast, filePath) {
        // For each service method, find HTTP calls within it
        for (const [methodKey, methodInfo] of this.serviceMethods.entries()) {
            if (methodInfo.filePath === filePath) {
                this.findHttpCallsInMethod(methodInfo);
            }
        }
    }

    /**
     * Find HTTP calls within a specific method
     */
    findHttpCallsInMethod(methodInfo) {
        const httpCalls = [];
        
        try {
            // Handle different method structure types
            if (methodInfo.path && methodInfo.path.traverse) {
                // Use the path's traverse if available
                methodInfo.path.traverse({
                    ReturnStatement: (returnPath) => {
                        if (returnPath.node.argument) {
                            const httpCall = this.analyzeForHttpCall(returnPath.node.argument, returnPath.scope, methodInfo);
                            if (httpCall) {
                                httpCalls.push(httpCall);
                            }
                        }
                    },

                    CallExpression: (callPath) => {
                        const httpCall = this.analyzeForHttpCall(callPath.node, callPath.scope, methodInfo);
                        if (httpCall) {
                            httpCalls.push(httpCall);
                        }
                    }
                });
            } else {
                // Manually traverse the method body for direct node access
                this.traverseMethodBodyManually(methodInfo.body, httpCalls, methodInfo);
            }

            if (httpCalls.length > 0) {
                const methodKey = `${methodInfo.className}.${methodInfo.methodName}`;
                this.httpCallsInMethods.set(methodKey, httpCalls);
                console.debug(`🌐 Found HTTP calls in ${methodKey}:`, httpCalls.map(c => c.url));
            }
        } catch (error) {
            console.debug(`⚠️  Error analyzing method ${methodInfo.className}.${methodInfo.methodName}:`, error.message);
        }
    }

    /**
     * Manually traverse method body when normal traverse isn't available
     */
    traverseMethodBodyManually(body, httpCalls, methodInfo) {
        if (!body || !body.body) return;

        const visitNode = (node, depth = 0) => {
            const indent = '  '.repeat(depth);
            console.debug(`${indent}👁️ Visiting ${node.type} in ${methodInfo.className}.${methodInfo.methodName}`);
            
            if (t.isReturnStatement(node) && node.argument) {
                console.debug(`${indent}↩️ Found return statement`);
                const httpCall = this.analyzeForHttpCall(node.argument, null, methodInfo);
                if (httpCall) {
                    httpCalls.push(httpCall);
                }
            } else if (t.isCallExpression(node)) {
                console.debug(`${indent}📞 Found call expression`);
                const httpCall = this.analyzeForHttpCall(node, null, methodInfo);
                if (httpCall) {
                    httpCalls.push(httpCall);
                }
            }

            // Recursively visit child nodes
            for (const key in node) {
                const child = node[key];
                if (Array.isArray(child)) {
                    child.forEach(c => c && typeof c === 'object' && c.type && visitNode(c, depth + 1));
                } else if (child && typeof child === 'object' && child.type) {
                    visitNode(child, depth + 1);
                }
            }
        };

        body.body.forEach(visitNode);
    }

    /**
     * Analyze a node for HTTP call patterns
     */
    analyzeForHttpCall(node, scope, methodInfo) {
        if (!t.isCallExpression(node)) {
            return null;
        }

        console.debug(`📞 Analyzing call expression in ${methodInfo.className}.${methodInfo.methodName}`);
        console.debug(`   Callee type: ${node.callee ? node.callee.type : 'null'}`);
        
        if (t.isMemberExpression(node.callee)) {
            console.debug(`   Object: ${node.callee.object ? node.callee.object.type : 'null'}`);
            console.debug(`   Property: ${node.callee.property ? node.callee.property.name || node.callee.property.type : 'null'}`);
            
            const memberKey = this.getMemberKey(node.callee);
            console.debug(`🔍 Checking call: ${memberKey} in ${methodInfo.className}.${methodInfo.methodName}`);
            
            // Check for HTTP call patterns
            if (this.isHttpCallPattern(memberKey)) {
                const url = this.extractUrlFromHttpCall(node, scope, methodInfo);
                const httpMethod = this.extractHttpMethod(memberKey);
                
                console.debug(`🌐 Found HTTP call: ${memberKey} -> ${url}`);
                
                return {
                    url: url,
                    method: httpMethod,
                    memberKey: memberKey,
                    arguments: node.arguments,
                    requestBody: this.extractRequestBody(node, scope, methodInfo),
                    requestHeaders: this.extractRequestHeaders(node, scope, methodInfo),
                    requestOptions: this.extractRequestOptions(node, scope, methodInfo),
                    rawCall: this.nodeToString(node)
                };
            } else {
                console.debug(`❌ Not HTTP pattern: ${memberKey}`);
            }
        } else {
            console.debug(`❌ Not member expression: ${node.callee ? node.callee.type : 'null'}`);
        }

        return null;
    }

    /**
     * Extract URL from HTTP call arguments
     */
    extractUrlFromHttpCall(callNode, scope, methodInfo) {
        const args = callNode.arguments;
        if (args.length === 0) return null;

        const urlArg = args[0];
        return this.resolveUrlExpression(urlArg, scope, methodInfo);
    }

    /**
     * Extract request body from HTTP call arguments
     */
    extractRequestBody(callNode, scope, methodInfo) {
        const args = callNode.arguments;
        
        // For POST, PUT, PATCH - body is typically the second argument
        if (args.length >= 2) {
            const bodyArg = args[1];
            return this.extractArgumentInfo(bodyArg, scope, methodInfo, 'body');
        }
        
        return null;
    }

    /**
     * Extract request headers from HTTP call arguments
     */
    extractRequestHeaders(callNode, scope, methodInfo) {
        const args = callNode.arguments;
        
        // Headers are typically the third argument, or in options object
        if (args.length >= 3) {
            const headersArg = args[2];
            
            // Check if it's an options object with headers property
            if (t.isObjectExpression(headersArg)) {
                const headersProperty = headersArg.properties.find(prop => 
                    t.isObjectProperty(prop) && 
                    t.isIdentifier(prop.key) && 
                    prop.key.name === 'headers'
                );
                
                if (headersProperty) {
                    return this.extractArgumentInfo(headersProperty.value, scope, methodInfo, 'headers');
                }
            }
            
            return this.extractArgumentInfo(headersArg, scope, methodInfo, 'headers');
        }
        
        return null;
    }

    /**
     * Extract request options from HTTP call arguments
     */
    extractRequestOptions(callNode, scope, methodInfo) {
        const args = callNode.arguments;
        
        // Options are typically the last argument and usually an object
        if (args.length >= 2) {
            const lastArg = args[args.length - 1];
            
            if (t.isObjectExpression(lastArg)) {
                return this.extractArgumentInfo(lastArg, scope, methodInfo, 'options');
            }
        }
        
        return null;
    }

    /**
     * Extract information from any argument (body, headers, options)
     */
    extractArgumentInfo(arg, scope, methodInfo, argType) {
        const info = {
            type: argType,
            originalType: arg.type,
            value: null,
            resolved: false
        };

        try {
            // String literal
            if (t.isStringLiteral(arg)) {
                info.value = arg.value;
                info.resolved = true;
            }
            // Number literal  
            else if (t.isNumericLiteral(arg)) {
                info.value = arg.value;
                info.resolved = true;
            }
            // Boolean literal
            else if (t.isBooleanLiteral(arg)) {
                info.value = arg.value;
                info.resolved = true;
            }
            // Identifier (variable reference)
            else if (t.isIdentifier(arg)) {
                info.value = `{${arg.name}}`;
                info.variableName = arg.name;
                
                // Try to resolve the variable
                const resolved = this.resolveIdentifier(arg.name, scope, methodInfo);
                if (resolved) {
                    info.resolvedValue = resolved;
                    info.resolved = true;
                }
            }
            // Member expression (this.property)
            else if (t.isMemberExpression(arg)) {
                const memberKey = this.getMemberKey(arg);
                info.value = `{${memberKey}}`;
                info.memberExpression = memberKey;
                
                // Try to resolve the member expression
                const resolved = this.resolveMemberExpression(arg, scope, methodInfo);
                if (resolved) {
                    info.resolvedValue = resolved;
                    info.resolved = true;
                }
            }
            // Object expression
            else if (t.isObjectExpression(arg)) {
                info.value = this.extractObjectExpression(arg, scope, methodInfo);
                info.resolved = true;
            }
            // Array expression
            else if (t.isArrayExpression(arg)) {
                info.value = arg.elements.map((elem, idx) => 
                    elem ? this.extractArgumentInfo(elem, scope, methodInfo, `${argType}[${idx}]`) : null
                );
                info.resolved = true;
            }
            // Call expression (function call)
            else if (t.isCallExpression(arg)) {
                const memberKey = t.isMemberExpression(arg.callee) ? this.getMemberKey(arg.callee) : 
                                 t.isIdentifier(arg.callee) ? arg.callee.name : 'unknownCall';
                info.value = `{${memberKey}()}`;
                info.callExpression = memberKey;
            }
            // Default case
            else {
                info.value = `{${arg.type}}`;
            }
        } catch (error) {
            console.debug(`⚠️ Error extracting ${argType}:`, error);
            info.value = `{${arg.type}}`;
        }

        return info;
    }

    /**
     * Extract object expression properties
     */
    extractObjectExpression(objExpr, scope, methodInfo) {
        const result = {};
        
        objExpr.properties.forEach(prop => {
            if (t.isObjectProperty(prop)) {
                const key = t.isIdentifier(prop.key) ? prop.key.name : 
                           t.isStringLiteral(prop.key) ? prop.key.value : 'unknownKey';
                
                const valueInfo = this.extractArgumentInfo(prop.value, scope, methodInfo, `object.${key}`);
                result[key] = valueInfo.resolvedValue || valueInfo.value;
            }
        });
        
        return result;
    }

    /**
     * Resolve URL expressions (template literals, member expressions, etc.)
     */
    resolveUrlExpression(expr, scope, methodInfo) {
        // String literal
        if (t.isStringLiteral(expr)) {
            return expr.value;
        }

        // Template literal
        if (t.isTemplateLiteral(expr)) {
            return this.resolveTemplateLiteral(expr, scope, methodInfo);
        }

        // Member expression (this.apiUrl)
        if (t.isMemberExpression(expr)) {
            return this.resolveMemberExpression(expr, scope, methodInfo);
        }

        // Identifier (variable)
        if (t.isIdentifier(expr)) {
            return this.resolveIdentifier(expr.name, scope, methodInfo);
        }

        // Binary expression (concatenation)
        if (t.isBinaryExpression(expr) && expr.operator === '+') {
            const left = this.resolveUrlExpression(expr.left, scope, methodInfo);
            const right = this.resolveUrlExpression(expr.right, scope, methodInfo);
            return (left && right) ? left + right : null;
        }

        return null;
    }

    /**
     * Resolve template literal
     */
    resolveTemplateLiteral(node, scope, methodInfo) {
        let result = '';

        for (let i = 0; i < node.quasis.length; i++) {
            result += node.quasis[i].value.cooked;

            if (i < node.expressions.length) {
                const expr = node.expressions[i];
                const resolved = this.resolveUrlExpression(expr, scope, methodInfo);
                
                if (resolved !== null) {
                    result += resolved;
                } else {
                    // Create placeholder
                    result += this.createPlaceholder(expr);
                }
            }
        }

        return result;
    }

    /**
     * Resolve member expression (this.apiUrl, etc.)
     */
    resolveMemberExpression(expr, scope, methodInfo) {
        if (t.isThisExpression(expr.object) && t.isIdentifier(expr.property)) {
            const propName = expr.property.name;
            const className = methodInfo.className;
            const propKey = `${className}.${propName}`;
            
            if (this.urlVariables.has(propKey)) {
                return this.urlVariables.get(propKey);
            }
        }

        return null;
    }

    /**
     * Resolve identifier
     */
    resolveIdentifier(name, scope, methodInfo) {
        // Try to resolve from scope
        try {
            const binding = scope.getBinding(name);
            if (binding && binding.path.isVariableDeclarator()) {
                const init = binding.path.node.init;
                return this.resolveNodeValue(init, binding.path.scope);
            }
        } catch (error) {
            // Continue
        }

        return null;
    }

    /**
     * Extract URL variables from the entire codebase
     */
    extractUrlVariables(ast, filePath) {
        traverse(ast, {
            // Variable declarations (const environment = {...})
            VariableDeclarator: (path) => {
                if (t.isIdentifier(path.node.id) && path.node.init) {
                    const varName = path.node.id.name;
                    
                    if (varName.toLowerCase().includes('environment') || 
                        varName.toLowerCase().includes('config') ||
                        varName.toLowerCase().includes('url')) {
                        
                        const value = this.resolveNodeValue(path.node.init, path.scope);
                        if (value) {
                            this.urlVariables.set(varName, value);
                        }
                    }
                }
            }
        });
    }

    /**
     * Resolve subscribe calls to their underlying HTTP calls
     */
    resolveSubscribeCall(callExpression, scope, astPath) {
        if (!this.isSubscribeCall(callExpression)) {
            return null;
        }

        // Get the object being subscribed to
        const subscribedObject = callExpression.callee.object;
        console.debug(`📦 Subscribed object type: ${subscribedObject ? subscribedObject.type : 'null'}`);
        
        if (t.isCallExpression(subscribedObject) && t.isMemberExpression(subscribedObject.callee)) {
            const memberKey = this.getMemberKey(subscribedObject.callee);
            console.debug(`🔗 Service method call chain: ${memberKey}`);
            
            // Check if this is a service method call pattern
            const serviceMatch = memberKey && memberKey.match(/this\.(\w+Service)\.(\w+)/);
            if (serviceMatch) {
                const serviceName = serviceMatch[1];
                const methodName = serviceMatch[2];
                console.debug(`🎯 Found service method pattern: ${serviceName}.${methodName}`);
                
                // Find the service class (convert serviceName to ClassName)
                const serviceClassName = this.findServiceClassName(serviceName);
                console.debug(`🏢 Service class name: ${serviceClassName}`);
                
                if (serviceClassName) {
                    const methodKey = `${serviceClassName}.${methodName}`;
                    console.debug(`🔍 Looking for HTTP calls in: ${methodKey}`);
                    console.debug(`📋 Available methods:`, Array.from(this.httpCallsInMethods.keys()));
                    
                    if (this.httpCallsInMethods.has(methodKey)) {
                        const httpCalls = this.httpCallsInMethods.get(methodKey);
                        console.debug(`✅ Found HTTP calls for ${methodKey}:`, httpCalls.map(c => c.url));
                        
                        // Return the HTTP call with complete information
                        const httpCall = httpCalls[0];
                        return {
                            url: httpCall.url,
                            method: httpCall.method,
                            requestBody: httpCall.requestBody,
                            requestHeaders: httpCall.requestHeaders, 
                            requestOptions: httpCall.requestOptions,
                            actualCall: httpCall.memberKey,
                            rawCall: httpCall.rawCall
                        };
                    } else {
                        console.debug(`❌ No HTTP calls found for ${methodKey}`);
                    }
                }
            } else {
                console.debug(`❌ No service pattern match for: ${memberKey}`);
            }
        } else {
            console.debug(`❌ Not a service method call chain`);
        }

        return null;
    }

    /**
     * Find actual service class name from service property name
     */
    findServiceClassName(servicePropName) {
        // Generic patterns for service name resolution
        const candidates = [
            servicePropName.charAt(0).toUpperCase() + servicePropName.slice(1), // camelCase -> PascalCase
            '_' + servicePropName.charAt(0).toUpperCase() + servicePropName.slice(1), // camelCase -> _PascalCase
            servicePropName, // exact match
            servicePropName.toLowerCase(), // lowercase match
            servicePropName.toUpperCase() // uppercase match
        ];

        for (const candidate of candidates) {
            if (this.serviceClasses.has(candidate)) {
                console.debug(`✅ Found service class: ${servicePropName} → ${candidate}`);
                return candidate;
            }
        }

        // Also check for partial matches
        for (const [className] of this.serviceClasses) {
            if (className.toLowerCase().includes(servicePropName.toLowerCase()) ||
                servicePropName.toLowerCase().includes(className.toLowerCase().replace('_', ''))) {
                console.debug(`✅ Found service class by partial match: ${servicePropName} → ${className}`);
                return className;
            }
        }

        console.debug(`❌ No service class found for: ${servicePropName}, available:`, Array.from(this.serviceClasses.keys()));
        return null;
    }

    /**
     * Resolve any node to its static value
     */
    resolveNodeValue(node, scope) {
        if (t.isStringLiteral(node)) return node.value;
        if (t.isNumericLiteral(node)) return node.value;
        if (t.isBooleanLiteral(node)) return node.value;
        
        if (t.isTemplateLiteral(node)) {
            // Simple template literal resolution
            let result = '';
            for (let i = 0; i < node.quasis.length; i++) {
                result += node.quasis[i].value.cooked;
                if (i < node.expressions.length) {
                    const expr = node.expressions[i];
                    if (t.isMemberExpression(expr)) {
                        const memberKey = this.getMemberKey(expr);
                        if (memberKey === 'environment.supabaseUrl') {
                            result += 'https://juaogodstdjfllmdepop.supabase.co';
                        } else {
                            result += `{${memberKey}}`;
                        }
                    } else if (t.isIdentifier(expr)) {
                        result += `{${expr.name}}`;
                    }
                }
            }
            return result;
        }

        if (t.isObjectExpression(node)) {
            const obj = {};
            node.properties.forEach(prop => {
                if (t.isObjectProperty(prop) && t.isIdentifier(prop.key)) {
                    const value = this.resolveNodeValue(prop.value, scope);
                    if (value) {
                        obj[prop.key.name] = value;
                    }
                }
            });
            return obj;
        }

        return null;
    }

    /**
     * Check if this is a subscribe call
     */
    isSubscribeCall(callExpression) {
        return t.isCallExpression(callExpression) &&
               t.isMemberExpression(callExpression.callee) &&
               t.isIdentifier(callExpression.callee.property) &&
               callExpression.callee.property.name === 'subscribe';
    }

    /**
     * Check if member key is an HTTP call pattern
     */
    isHttpCallPattern(memberKey) {
        if (!memberKey) return false;
        
        const httpPatterns = [
            /this\.http\.(get|post|put|delete|patch|head|options)/i,
            /http\.(get|post|put|delete|patch|head|options)/i,
            /axios\.(get|post|put|delete|patch|head|options)/i
        ];

        return httpPatterns.some(pattern => pattern.test(memberKey));
    }

    /**
     * Extract HTTP method from member key
     */
    extractHttpMethod(memberKey) {
        const match = memberKey.match(/\.(get|post|put|delete|patch|head|options)/i);
        return match ? match[1].toUpperCase() : 'GET';
    }

    /**
     * Check if class name indicates a service
     */
    isServiceClass(className) {
        if (!className || typeof className !== 'string') return false;
        
        // Generic check for service classes
        const lowerName = className.toLowerCase();
        return lowerName.includes('service') || 
               lowerName.includes('repository') || 
               lowerName.includes('api') || 
               lowerName.includes('client') ||
               lowerName.includes('dao') ||
               lowerName.includes('gateway') ||
               lowerName.includes('provider') ||
               // Match common service patterns
               /^_?\w*Service$/i.test(className) ||
               /^_?\w*(Service|Repository|API|Client|DAO|Gateway|Provider)$/i.test(className);
    }

    /**
     * Get member expression as string
     */
    getMemberKey(expr) {
        if (!t.isMemberExpression(expr)) {
            console.debug(`❌ Not a member expression: ${expr ? expr.type : 'null'}`);
            return null;
        }
        
        const object = t.isThisExpression(expr.object) ? 'this' :
                      t.isIdentifier(expr.object) ? expr.object.name : 
                      t.isMemberExpression(expr.object) ? this.getMemberKey(expr.object) : null;
        
        const property = t.isIdentifier(expr.property) ? expr.property.name : 
                        t.isStringLiteral(expr.property) ? expr.property.value : null;
        
        const result = (object && property) ? `${object}.${property}` : null;
        console.debug(`🔑 Member key: ${object}.${property} = ${result}`);
        return result;
    }

    /**
     * Create placeholder for unresolved expressions
     */
    createPlaceholder(expr) {
        if (t.isIdentifier(expr)) {
            const name = expr.name;
            if (name.toLowerCase().includes('id')) return '{id}';
            if (name.toLowerCase().includes('status')) return '{status}';
            return `{${name}}`;
        }
        return '{expr}';
    }

    /**
     * Convert AST node to string representation
     */
    nodeToString(node) {
        try {
            if (t.isStringLiteral(node)) return `"${node.value}"`;
            if (t.isIdentifier(node)) return node.name;
            if (t.isMemberExpression(node)) return this.getMemberKey(node);
            return '[complex expression]';
        } catch {
            return '[expression]';
        }
    }

    /**
     * Main resolver method - resolves any HTTP call pattern
     */
    resolveHttpCall(callExpression, scope, astPath) {
        console.debug(`🚀 Service method resolver called for expression type: ${callExpression.type}`);
        
        // Handle .subscribe() patterns
        if (this.isSubscribeCall(callExpression)) {
            console.debug(`📧 Found subscribe call, analyzing...`);
            const result = this.resolveSubscribeCall(callExpression, scope, astPath);
            if (result) {
                return {
                    url: result.url,
                    method: result.method,
                    requestBody: result.requestBody,
                    requestHeaders: result.requestHeaders,
                    requestOptions: result.requestOptions,
                    source: 'service_method_subscribe',
                    confidence: 'high',
                    isResolved: true,
                    actualCall: result.actualCall,
                    rawCall: result.rawCall
                };
            }
        }

        // Handle direct service method calls
        if (t.isMemberExpression(callExpression.callee)) {
            const memberKey = this.getMemberKey(callExpression.callee);
            const serviceMatch = memberKey && memberKey.match(/this\.(\w+Service)\.(\w+)/);
            
            if (serviceMatch) {
                const serviceName = serviceMatch[1];
                const methodName = serviceMatch[2];
                
                const serviceClassName = this.findServiceClassName(serviceName);
                if (serviceClassName) {
                    const methodKey = `${serviceClassName}.${methodName}`;
                    
                    if (this.httpCallsInMethods.has(methodKey)) {
                        const httpCalls = this.httpCallsInMethods.get(methodKey);
                        const httpCall = httpCalls[0];
                        
                        return {
                            url: httpCall.url,
                            method: httpCall.method,
                            requestBody: httpCall.requestBody,
                            requestHeaders: httpCall.requestHeaders,
                            requestOptions: httpCall.requestOptions,
                            source: 'service_method_direct',
                            confidence: 'high',
                            isResolved: true,
                            actualCall: httpCall.memberKey,
                            rawCall: httpCall.rawCall
                        };
                    }
                }
            }
        }

        return {
            url: null,
            isResolved: false,
            confidence: 'low'
        };
    }

    /**
     * Process service aliases and ensure HTTP calls are available under all aliases
     */
    processServiceAliases() {
        // Look for common alias patterns dynamically
        const aliasPatterns = [];
        
        // Dynamically find alias patterns from discovered service classes
        for (const className of this.serviceClasses.keys()) {
            if (className.startsWith('_')) {
                const aliasName = className.substring(1); // Remove underscore
                aliasPatterns.push([className, aliasName]);
            }
        }

        for (const [originalName, aliasName] of aliasPatterns) {
            if (this.serviceClasses.has(originalName)) {
                this.copyHttpCallsForAlias(aliasName, originalName);
            }
        }

        // Also process dynamically found aliases
        for (const [className] of this.serviceClasses) {
            if (className.startsWith('_')) {
                const aliasName = className.substring(1); // Remove underscore
                this.copyHttpCallsForAlias(aliasName, className);
            }
        }
    }

    /**
     * Copy HTTP calls between service aliases
     */
    copyHttpCallsForAlias(aliasName, originalName) {
        // Copy HTTP calls from original methods to aliased methods
        for (const [methodKey, httpCalls] of this.httpCallsInMethods.entries()) {
            if (methodKey.startsWith(`${originalName}.`)) {
                const methodName = methodKey.substring(originalName.length + 1);
                const aliasMethodKey = `${aliasName}.${methodName}`;
                this.httpCallsInMethods.set(aliasMethodKey, httpCalls);
                console.debug(`📋 Copied HTTP calls: ${methodKey} → ${aliasMethodKey}`);
            }
        }

        // Also copy in reverse direction
        for (const [methodKey, httpCalls] of this.httpCallsInMethods.entries()) {
            if (methodKey.startsWith(`${aliasName}.`)) {
                const methodName = methodKey.substring(aliasName.length + 1);
                const originalMethodKey = `${originalName}.${methodName}`;
                if (!this.httpCallsInMethods.has(originalMethodKey)) {
                    this.httpCallsInMethods.set(originalMethodKey, httpCalls);
                    console.debug(`📋 Copied HTTP calls: ${methodKey} → ${originalMethodKey}`);
                }
            }
        }
    }

    /**
     * Get debug information
     */
    getDebugInfo() {
        return {
            serviceClasses: Array.from(this.serviceClasses.keys()),
            serviceMethods: Array.from(this.serviceMethods.keys()),
            httpCallsInMethods: Array.from(this.httpCallsInMethods.keys()),
            urlVariables: Array.from(this.urlVariables.entries())
        };
    }
}
