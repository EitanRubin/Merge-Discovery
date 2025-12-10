import * as t from '@babel/types';
import _traverse from '@babel/traverse';

const traverse = _traverse.default;

/**
 * Analyzes code patterns to find URL definitions and variable assignments
 */
export class CodePatternAnalyzer {
    constructor() {
        this.urlPatterns = new Map();
        this.classProperties = new Map();
        this.variables = new Map();
    }

    analyzeFile(ast, filePath) {
        this.currentFile = filePath;
        
        traverse(ast, {
            // Find variable declarations with URL-like values
            VariableDeclarator: (path) => {
                this.analyzeVariableDeclarator(path);
            },

            // Find class property assignments
            ClassProperty: (path) => {
                this.analyzeClassProperty(path);
            },

            // Find constructor assignments
            AssignmentExpression: (path) => {
                this.analyzeAssignment(path);
            },

            // Find string literals that look like URLs
            StringLiteral: (path) => {
                this.analyzeStringLiteral(path);
            },

            // Find template literals with URL patterns
            TemplateLiteral: (path) => {
                this.analyzeTemplateLiteral(path);
            }
        });
    }

    analyzeVariableDeclarator(path) {
        const node = path.node;
        
        if (t.isIdentifier(node.id) && node.init) {
            const varName = node.id.name;
            
            if (t.isStringLiteral(node.init)) {
                const value = node.init.value;
                if (this.looksLikeUrl(value) || this.isUrlVariable(varName)) {
                    this.variables.set(varName, {
                        value: value,
                        type: 'string',
                        file: this.currentFile,
                        line: node.loc?.start?.line
                    });
                }
            }
        }
    }

    analyzeClassProperty(path) {
        const node = path.node;
        
        if (t.isIdentifier(node.key) && node.value) {
            const propName = node.key.name;
            
            if (t.isStringLiteral(node.value)) {
                const value = node.value.value;
                if (this.looksLikeUrl(value) || this.isUrlProperty(propName)) {
                    const className = this.findClassName(path);
                    const key = `${className}.${propName}`;
                    
                    this.classProperties.set(key, {
                        value: value,
                        type: 'class_property',
                        file: this.currentFile,
                        line: node.loc?.start?.line
                    });
                }
            }
        }
    }

    analyzeAssignment(path) {
        const node = path.node;
        
        // Look for this.property = value assignments
        if (t.isMemberExpression(node.left) && 
            t.isThisExpression(node.left.object) &&
            t.isIdentifier(node.left.property) &&
            t.isStringLiteral(node.right)) {
            
            const propName = node.left.property.name;
            const value = node.right.value;
            
            if (this.looksLikeUrl(value) || this.isUrlProperty(propName)) {
                const className = this.findClassName(path);
                const key = `${className}.${propName}`;
                
                this.classProperties.set(key, {
                    value: value,
                    type: 'assignment',
                    file: this.currentFile,
                    line: node.loc?.start?.line
                });
            }
        }
    }

    analyzeStringLiteral(path) {
        const node = path.node;
        const value = node.value;
        
        if (this.looksLikeUrl(value)) {
            // Try to find what this URL is assigned to
            const parent = path.parent;
            let context = 'literal';
            
            if (t.isVariableDeclarator(parent) && t.isIdentifier(parent.id)) {
                context = `variable:${parent.id.name}`;
            } else if (t.isAssignmentExpression(parent) && t.isMemberExpression(parent.left)) {
                const memberInfo = this.getMemberExpressionInfo(parent.left);
                context = `assignment:${memberInfo}`;
            }
            
            this.urlPatterns.set(value, {
                context: context,
                file: this.currentFile,
                line: node.loc?.start?.line
            });
        }
    }

    analyzeTemplateLiteral(path) {
        const node = path.node;
        
        // Check if template looks like a URL pattern
        const hasUrlStructure = node.quasis.some(quasi => 
            quasi.value.cooked.includes('://') ||
            quasi.value.cooked.includes('/api') ||
            quasi.value.cooked.includes('localhost') ||
            quasi.value.cooked.startsWith('/')
        );
        
        if (hasUrlStructure) {
            const reconstructed = this.reconstructTemplate(node);
            
            this.urlPatterns.set(reconstructed, {
                context: 'template',
                file: this.currentFile,
                line: node.loc?.start?.line,
                type: 'template'
            });
        }
    }

    findClassName(path) {
        const classPath = path.findParent(p => p.isClassDeclaration() || p.isClassExpression());
        
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

    getMemberExpressionInfo(node) {
        if (t.isMemberExpression(node)) {
            const object = t.isThisExpression(node.object) ? 'this' : 
                          t.isIdentifier(node.object) ? node.object.name : 'unknown';
            const property = t.isIdentifier(node.property) ? node.property.name : 'unknown';
            return `${object}.${property}`;
        }
        return 'unknown';
    }

    reconstructTemplate(node) {
        let result = '';
        
        for (let i = 0; i < node.quasis.length; i++) {
            result += node.quasis[i].value.cooked;
            
            if (i < node.expressions.length) {
                const expr = node.expressions[i];
                if (t.isIdentifier(expr)) {
                    result += `{${expr.name}}`;
                } else {
                    result += '{expr}';
                }
            }
        }
        
        return result;
    }

    looksLikeUrl(str) {
        if (!str || typeof str !== 'string') return false;
        
        return str.includes('://') ||
               str.startsWith('/api') ||
               str.startsWith('http') ||
               str.includes('localhost') ||
               str.includes('.com') ||
               str.includes('.org') ||
               str.includes('.net') ||
               (str.startsWith('/') && str.length > 3);
    }

    isUrlVariable(name) {
        const urlNames = [
            'apiUrl', 'baseUrl', 'baseURL', 'endpoint', 'host', 'apiHost',
            'API_URL', 'BASE_URL', 'ENDPOINT', 'HOST', 'SERVER_URL'
        ];
        return urlNames.includes(name);
    }

    isUrlProperty(name) {
        return this.isUrlVariable(name);
    }

    // Public methods to get results
    getUrlForVariable(varName) {
        return this.variables.get(varName);
    }

    getUrlForProperty(className, propName) {
        return this.classProperties.get(`${className}.${propName}`) ||
               this.classProperties.get(`*.${propName}`); // Wildcard match
    }

    getAllPatterns() {
        return {
            variables: Array.from(this.variables.entries()),
            classProperties: Array.from(this.classProperties.entries()),
            urlPatterns: Array.from(this.urlPatterns.entries())
        };
    }

    clear() {
        this.urlPatterns.clear();
        this.classProperties.clear();
        this.variables.clear();
    }
}
