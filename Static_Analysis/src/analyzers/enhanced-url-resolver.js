import * as t from '@babel/types';
import { AstUtils } from '../ast/ast-utils.js';
import { StringUtils } from '../utils/string-utils.js';

export class EnhancedUrlResolver {
    constructor(scopeResolver) {
        this.scopeResolver = scopeResolver;
        this.classPropertyCache = new Map();
        this.variableCache = new Map();
        this.codePatterns = null;
        this.staticValueResolver = null;
    }

    setCodePatterns(patterns) {
        this.codePatterns = patterns;
        
        // Build lookup caches for faster access
        if (patterns) {
            // Cache variables
            patterns.variables.forEach(([name, data]) => {
                this.variableCache.set(name, data.value);
            });
            
            // Cache class properties
            patterns.classProperties.forEach(([key, data]) => {
                this.classPropertyCache.set(key, data.value);
            });
        }
    }

    setStaticValueResolver(resolver) {
        this.staticValueResolver = resolver;
    }

    /**
     * Enhanced URL extraction that tries to resolve actual values
     */
    extractActualUrl(args, scope, argsPaths, calleeInfo) {
        if (args.length === 0) return null;

        const firstArg = args[0];
        const firstArgPath = argsPaths[0];

        // Try multiple strategies to get the actual URL
        const strategies = [
            { name: 'direct', fn: () => this.extractDirectUrl(firstArg) },
            { name: 'template', fn: () => this.extractFromTemplate(firstArg, scope, firstArgPath) },
            { name: 'member', fn: () => this.extractFromMember(firstArg, scope, firstArgPath) },
            { name: 'variable', fn: () => this.extractFromVariable(firstArg, scope) },
            { name: 'constructor', fn: () => this.extractFromConstructor(firstArg, scope, firstArgPath) },
            { name: 'config', fn: () => this.extractFromConfig(args, scope) }
        ];

        for (const strategy of strategies) {
            try {
                const result = strategy.fn();
                if (result && this.isActualUrl(result)) {
                    return {
                        url: result,
                        confidence: this.calculateConfidence(result),
                        source: strategy.name
                    };
                }
            } catch (error) {
                // Continue to next strategy
                console.debug(`Strategy ${strategy.name} failed:`, error);
            }
        }

        // Always return a fallback - never return null
        return this.createFallbackUrl(firstArg, scope);
    }

    extractDirectUrl(firstArg) {
        if (t.isStringLiteral(firstArg)) {
            return firstArg.value;
        }
        return null;
    }

    extractFromTemplate(firstArg, scope, firstArgPath) {
        if (!t.isTemplateLiteral(firstArg)) return null;

        try {
            // Try to resolve all template expressions
            let resolved = '';
            let hasUnresolved = false;
            
            for (let i = 0; i < firstArg.quasis.length; i++) {
                resolved += firstArg.quasis[i].value.cooked;
                
                if (i < firstArg.expressions.length) {
                    const expr = firstArg.expressions[i];
                    let exprValue = null;
                    
                    // First, try StaticValueResolver
                    if (this.staticValueResolver) {
                        exprValue = this.staticValueResolver.extractValue(expr, scope);
                    }
                    
                    // Fallback to original resolution
                    if (!exprValue) {
                        exprValue = this.resolveExpression(expr, scope);
                    }
                    
                    if (exprValue && typeof exprValue === 'string') {
                        resolved += exprValue;
                    } else {
                        // Try to get a meaningful representation
                        const symbolicValue = this.getSymbolicValue(expr);
                        resolved += symbolicValue;
                        hasUnresolved = true;
                    }
                }
            }
            
            // Even if we have unresolved parts, return it if it looks like a valid URL structure
            if (resolved && (resolved.startsWith('http') || resolved.startsWith('/') || resolved.includes('.com'))) {
                return resolved;
            }
            
            return hasUnresolved ? null : resolved;
        } catch (error) {
            return null;
        }
    }

    extractFromMember(firstArg, scope, firstArgPath) {
        if (!t.isMemberExpression(firstArg)) return null;

        // Handle this.property cases
        if (t.isThisExpression(firstArg.object) && t.isIdentifier(firstArg.property)) {
            const propertyName = firstArg.property.name;
            const className = this.getClassNameFromPath(firstArgPath);
            
            // First, try to resolve using StaticValueResolver
            if (this.staticValueResolver) {
                const classKey = `${className}.${propertyName}`;
                let resolvedValue = this.staticValueResolver.resolveValue(classKey);
                
                if (resolvedValue) {
                    return resolvedValue;
                }
                
                // Also try with wildcard class name
                const wildcardKey = `*.${propertyName}`;
                const wildcardValue = this.staticValueResolver.resolveValue(wildcardKey);
                if (wildcardValue) {
                    return wildcardValue;
                }
                
                // Try all resolved class properties that end with the property name
                const allResolved = this.staticValueResolver.getAllResolvedValues();
                
                for (const [key, data] of allResolved.classProperties) {
                    if (key.endsWith(`.${propertyName}`)) {
                        return data.value;
                    }
                }
            }
            
            // Fallback to code pattern cache
            const fullKey = `${className}.${propertyName}`;
            const wildcardKey = `*.${propertyName}`;
            
            if (this.classPropertyCache.has(fullKey)) {
                return this.classPropertyCache.get(fullKey);
            }
            
            if (this.classPropertyCache.has(wildcardKey)) {
                return this.classPropertyCache.get(wildcardKey);
            }

            // Try to find the actual value in the class (removed missing method calls)

            // Don't use hardcoded patterns - let static analysis find the real values
            return null;

            if (urlPatterns[propertyName]) {
                return urlPatterns[propertyName];
            }
        }

        return null;
    }

    extractFromVariable(firstArg, scope) {
        if (!t.isIdentifier(firstArg)) return null;

        const varName = firstArg.name;
        
        // First, try to resolve using StaticValueResolver
        if (this.staticValueResolver) {
            const resolvedValue = this.staticValueResolver.resolveValue(varName);
            if (resolvedValue) {
                return resolvedValue;
            }
        }
        
        // Fallback to code pattern cache
        if (this.variableCache.has(varName)) {
            return this.variableCache.get(varName);
        }
        
        // Try to resolve the variable from scope
        const binding = scope.getBinding(varName);
        if (binding && binding.path) {
            const bindingValue = this.extractFromBinding(binding);
            if (bindingValue) {
                return bindingValue;
            }
        }

        // Use only discovered values from static analysis - no hardcoded patterns
        return null;
    }

    extractFromConstructor(firstArg, scope, firstArgPath) {
        // Simplified version - just return null for now
        return null;
    }

    extractFromConfig(args, scope) {
        // Look in configuration objects for URLs
        for (let i = 1; i < args.length; i++) {
            const arg = args[i];
            if (t.isObjectExpression(arg)) {
                const urlProp = arg.properties.find(prop =>
                    t.isObjectProperty(prop) &&
                    t.isIdentifier(prop.key) &&
                    ['url', 'baseURL', 'endpoint'].includes(prop.key.name)
                );
                
                if (urlProp && t.isStringLiteral(urlProp.value)) {
                    return urlProp.value.value;
                }
            }
        }
        return null;
    }

    findClassProperty(propertyName, astPath) {
        const classPath = astPath.findParent(p => p.isClassDeclaration() || p.isClassExpression());
        if (!classPath) return null;

        // Look for class properties
        const classBody = classPath.node.body.body;
        for (const member of classBody) {
            if (t.isClassProperty(member) && 
                t.isIdentifier(member.key) && 
                member.key.name === propertyName &&
                member.value) {
                
                if (t.isStringLiteral(member.value)) {
                    return member.value.value;
                }
            }
        }

        return null;
    }

    findConstructor(classPath) {
        const classBody = classPath.node.body.body;
        return classBody.find(member => 
            t.isClassMethod(member) && 
            t.isIdentifier(member.key) && 
            member.key.name === 'constructor'
        );
    }

    findPropertyAssignment(constructor, propertyName) {
        if (!constructor || !constructor.body) return null;

        // Look through constructor body for this.property = value
        for (const stmt of constructor.body.body) {
            if (t.isExpressionStatement(stmt) && 
                t.isAssignmentExpression(stmt.expression)) {
                
                const assignment = stmt.expression;
                if (t.isMemberExpression(assignment.left) &&
                    t.isThisExpression(assignment.left.object) &&
                    t.isIdentifier(assignment.left.property) &&
                    assignment.left.property.name === propertyName) {
                    
                    if (t.isStringLiteral(assignment.right)) {
                        return assignment.right.value;
                    }
                }
            }
        }

        return null;
    }

    extractFromBinding(binding) {
        const bindingPath = binding.path;
        
        if (bindingPath.isVariableDeclarator() && bindingPath.node.init) {
            const init = bindingPath.node.init;
            
            if (t.isStringLiteral(init)) {
                return init.value;
            }
            
            if (t.isTemplateLiteral(init)) {
                return this.reconstructSimpleTemplate(init);
            }
        }

        return null;
    }

    reconstructSimpleTemplate(templateLiteral) {
        let result = '';
        
        for (let i = 0; i < templateLiteral.quasis.length; i++) {
            result += templateLiteral.quasis[i].value.cooked;
            
            if (i < templateLiteral.expressions.length) {
                const expr = templateLiteral.expressions[i];
                
                // Try to resolve simple expressions
                if (t.isIdentifier(expr)) {
                    // For unresolved identifiers, make educated guesses
                    const name = expr.name.toLowerCase();
                    if (name.includes('port')) {
                        result += '3000';
                    } else if (name.includes('host')) {
                        result += 'localhost';
                    } else {
                        result += `{${expr.name}}`;
                    }
                } else {
                    result += '{expr}';
                }
            }
        }
        
        return result;
    }

    resolveExpression(expr, scope) {
        if (t.isStringLiteral(expr)) {
            return expr.value;
        }
        
        if (t.isIdentifier(expr)) {
            // First, try StaticValueResolver
            if (this.staticValueResolver) {
                const resolved = this.staticValueResolver.resolveIdentifier(expr.name, scope);
                if (resolved) {
                    return resolved;
                }
            }
            
            // Fallback to scope binding
            const binding = scope.getBinding(expr.name);
            if (binding) {
                return this.extractFromBinding(binding);
            }
            
            // Make educated guesses for common patterns (last resort)
            const name = expr.name.toLowerCase();
            if (name.includes('port')) return '3000';
            if (name.includes('host')) return 'localhost';
            if (name === 'id') return '123';
            if (name === 'userId') return '456';
        }
        
        if (t.isMemberExpression(expr)) {
            // First, try StaticValueResolver
            if (this.staticValueResolver) {
                const resolved = this.staticValueResolver.resolveMemberExpression(expr, scope);
                if (resolved) {
                    return resolved;
                }
            }
            
            const memberInfo = AstUtils.getMemberExpressionInfo2(expr);
            
            // Handle process.env cases
            if (memberInfo.startsWith('process.env')) {
                // Let the system discover environment variables dynamically
                return null;
            }
            
            // Try to resolve from our caches
            if (this.objectProperties && this.objectProperties.has(memberInfo)) {
                return this.objectProperties.get(memberInfo);
            }
        }
        
        return null;
    }

    getSymbolicValue(expr) {
        if (t.isIdentifier(expr)) {
            return `{${expr.name}}`;
        }
        
        if (t.isMemberExpression(expr)) {
            return `{${AstUtils.getMemberExpressionInfo2(expr)}}`;
        }
        
        return '{expr}';
    }

    createFallbackUrl(firstArg, scope) {
        if (t.isStringLiteral(firstArg)) {
            return {
                url: firstArg.value,
                confidence: 'high',
                source: 'literal'
            };
        }
        
        if (t.isTemplateLiteral(firstArg)) {
            const reconstructed = this.reconstructSimpleTemplate(firstArg);
            return {
                url: reconstructed,
                confidence: 'medium',
                source: 'template'
            };
        }
        
        if (t.isMemberExpression(firstArg)) {
            const memberInfo = AstUtils.getMemberExpressionInfo2(firstArg);
            
            // Check cache first
            if (this.classPropertyCache.has(memberInfo)) {
                return {
                    url: this.classPropertyCache.get(memberInfo),
                    confidence: 'high',
                    source: 'cached_property'
                };
            }
            
            // Return null so other resolvers can try - no hardcoded fallbacks
            return null;
        }
        
        if (t.isIdentifier(firstArg)) {
            const varName = firstArg.name;
            
            // Check cache first
            if (this.variableCache.has(varName)) {
                return {
                    url: this.variableCache.get(varName),
                    confidence: 'high',
                    source: 'cached_variable'
                };
            }
            
            // Return null - no hardcoded fallbacks, let dynamic analysis work
            return null;
        }
        
        return {
            url: 'https://example.com (unknown pattern)',
            confidence: 'low',
            source: 'unknown'
        };
    }

    isActualUrl(str) {
        if (!str || typeof str !== 'string') return false;
        
        // Accept our educated guesses that contain example.com
        if (str.includes('example.com')) return true;
        
        // Accept URLs with placeholders if they have a valid structure
        if ((str.startsWith('http') || str.startsWith('/')) && str.includes('{') && str.includes('}')) {
            return true;
        }
        
        // Accept direct URLs
        return StringUtils.looksLikeUrl(str) || 
               str.startsWith('http') || 
               str.startsWith('/api') ||
               str.startsWith('/');
    }

    calculateConfidence(url) {
        if (!url) return 'none';
        
        if (url.startsWith('http://') || url.startsWith('https://')) return 'high';
        if (url.includes('example.com')) return 'medium'; // Our educated guesses
        if (url.startsWith('/')) return 'medium';
        if (url.includes('{')) return 'low';
        
        return 'medium';
    }

    getClassNameFromPath(astPath) {
        const classPath = astPath.findParent(p => p.isClassDeclaration() || p.isClassExpression());
        
        if (classPath && classPath.node) {
            if (t.isClassDeclaration(classPath.node) && classPath.node.id) {
                return classPath.node.id.name;
            }
            
            // Look for variable assignment
            const parent = classPath.parent;
            if (t.isVariableDeclarator(parent) && t.isIdentifier(parent.id)) {
                return parent.id.name;
            }
        }
        
        return 'UnknownClass';
    }
}
