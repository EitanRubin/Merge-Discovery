import * as t from '@babel/types';
import _traverse from '@babel/traverse';
import { AstUtils } from '../ast/ast-utils.js';

const traverse = _traverse.default;

/**
 * Static Value Resolver - Finds actual values of variables and properties in code
 */
export class StaticValueResolver {
    constructor() {
        this.variableAssignments = new Map(); // varName -> value
        this.objectProperties = new Map();    // objName.propName -> value
        this.classProperties = new Map();     // className.propName -> value
        this.templateLiterals = new Map();    // location -> resolved template
        this.currentFile = null;
    }

    /**
     * Analyze a file to extract all variable assignments and property definitions
     */
    analyzeFile(ast, filePath) {
        this.currentFile = filePath;
        
        traverse(ast, {
            // Variable declarations: var x = "value"
            VariableDeclarator: (path) => {
                this.handleVariableDeclarator(path);
            },

            // Assignment expressions: this.prop = value, obj.prop = value
            AssignmentExpression: (path) => {
                this.handleAssignmentExpression(path);
            },

            // Object properties: { prop: "value" }
            ObjectProperty: (path) => {
                this.handleObjectProperty(path);
            },

            // Class properties: class { prop = "value" }
            ClassProperty: (path) => {
                this.handleClassProperty(path);
            }
        });
    }

    handleVariableDeclarator(path) {
        const node = path.node;
        
        if (t.isIdentifier(node.id) && node.init) {
            const varName = node.id.name;
            const value = this.extractValue(node.init, path.scope);
            
            if (value !== null) {
                this.variableAssignments.set(varName, {
                    value: value,
                    type: this.getValueType(node.init),
                    location: this.getLocation(path)
                });
            }
        }
    }

    handleAssignmentExpression(path) {
        const node = path.node;
        
        if (t.isMemberExpression(node.left)) {
            const memberKey = this.getMemberKey(node.left);
            const value = this.extractValue(node.right, path.scope);
            
            if (memberKey && value !== null) {
                if (memberKey.startsWith('this.')) {
                    // Class property assignment
                    const className = this.getClassName(path);
                    const propName = memberKey.substring(5); // Remove 'this.'
                    const classKey = `${className}.${propName}`;
                    
                    this.classProperties.set(classKey, {
                        value: value,
                        type: this.getValueType(node.right),
                        location: this.getLocation(path)
                    });
                } else {
                    // Object property assignment
                    this.objectProperties.set(memberKey, {
                        value: value,
                        type: this.getValueType(node.right),
                        location: this.getLocation(path)
                    });
                }
            }
        }
    }

    handleObjectProperty(path) {
        const node = path.node;
        
        if (t.isIdentifier(node.key) || t.isStringLiteral(node.key)) {
            const propName = t.isIdentifier(node.key) ? node.key.name : node.key.value;
            const objectName = this.getObjectName(path);
            
            if (objectName) {
                const value = this.extractValue(node.value, path.scope);
                
                if (value !== null) {
                    const key = `${objectName}.${propName}`;
                    this.objectProperties.set(key, {
                        value: value,
                        type: this.getValueType(node.value),
                        location: this.getLocation(path)
                    });
                }
            }
        }
    }

    handleClassProperty(path) {
        const node = path.node;
        
        if (t.isIdentifier(node.key) && node.value) {
            const propName = node.key.name;
            const className = this.getClassName(path);
            const value = this.extractValue(node.value, path.scope);
            
            if (value !== null) {
                const key = `${className}.${propName}`;
                this.classProperties.set(key, {
                    value: value,
                    type: this.getValueType(node.value),
                    location: this.getLocation(path)
                });
            }
        }
    }

    /**
     * Extract the actual value from an AST node
     */
    extractValue(node, scope) {
        if (t.isStringLiteral(node)) {
            return node.value;
        }
        
        if (t.isNumericLiteral(node)) {
            return node.value;
        }
        
        if (t.isBooleanLiteral(node)) {
            return node.value;
        }
        
        if (t.isTemplateLiteral(node)) {
            return this.resolveTemplateLiteral(node, scope);
        }
        
        if (t.isIdentifier(node)) {
            // Try to resolve the identifier
            return this.resolveIdentifier(node.name, scope);
        }
        
        if (t.isMemberExpression(node)) {
            return this.resolveMemberExpression(node, scope);
        }
        
        if (t.isBinaryExpression(node) && node.operator === '+') {
            const left = this.extractValue(node.left, scope);
            const right = this.extractValue(node.right, scope);
            
            if (left !== null && right !== null) {
                return String(left) + String(right);
            }
        }
        
        return null;
    }

    /**
     * Resolve template literal by substituting variables
     */
    resolveTemplateLiteral(node, scope) {
        let result = '';
        
        for (let i = 0; i < node.quasis.length; i++) {
            result += node.quasis[i].value.cooked;
            
            if (i < node.expressions.length) {
                const expr = node.expressions[i];
                const exprValue = this.extractValue(expr, scope);
                
                if (exprValue !== null) {
                    result += String(exprValue);
                } else {
                    // If we can't resolve, return null to indicate failure
                    return null;
                }
            }
        }
        
        return result;
    }

    /**
     * Resolve an identifier to its actual value
     */
    resolveIdentifier(name, scope) {
        // First check our resolved variables
        if (this.variableAssignments.has(name)) {
            return this.variableAssignments.get(name).value;
        }
        
        // Try to resolve from scope
        const binding = scope.getBinding(name);
        if (binding && binding.path.isVariableDeclarator()) {
            const init = binding.path.node.init;
            if (init) {
                return this.extractValue(init, binding.path.scope);
            }
        }
        
        return null;
    }

    /**
     * Resolve member expression like obj.prop
     */
    resolveMemberExpression(node, scope) {
        const memberKey = this.getMemberKey(node);
        
        if (memberKey) {
            // Check object properties
            if (this.objectProperties.has(memberKey)) {
                return this.objectProperties.get(memberKey).value;
            }
            
            // Check class properties
            if (this.classProperties.has(memberKey)) {
                return this.classProperties.get(memberKey).value;
            }
            
            // Try to resolve the object and property separately
            if (t.isIdentifier(node.object) && t.isIdentifier(node.property)) {
                const objName = node.object.name;
                const propName = node.property.name;
                
                // Look for pattern: objectName.propertyName
                const key = `${objName}.${propName}`;
                if (this.objectProperties.has(key)) {
                    return this.objectProperties.get(key).value;
                }
            }
        }
        
        return null;
    }

    /**
     * Get a string representation of a member expression
     */
    getMemberKey(node) {
        if (t.isMemberExpression(node)) {
            const object = t.isThisExpression(node.object) ? 'this' : 
                          t.isIdentifier(node.object) ? node.object.name : null;
            const property = t.isIdentifier(node.property) ? node.property.name : null;
            
            if (object && property) {
                return `${object}.${property}`;
            }
        }
        
        return null;
    }

    /**
     * Get the object name from context (for object literals)
     */
    getObjectName(path) {
        // Look for variable assignment: var obj = { ... }
        const objectExpr = path.findParent(p => p.isObjectExpression());
        if (objectExpr) {
            const parent = objectExpr.parent;
            
            if (t.isVariableDeclarator(parent) && t.isIdentifier(parent.id)) {
                return parent.id.name;
            }
            
            if (t.isAssignmentExpression(parent) && t.isIdentifier(parent.left)) {
                return parent.left.name;
            }
        }
        
        return null;
    }

    /**
     * Get class name from context
     */
    getClassName(path) {
        const classPath = path.findParent(p => p.isClassDeclaration() || p.isClassExpression());
        
        if (classPath && classPath.node) {
            if (t.isClassDeclaration(classPath.node) && classPath.node.id) {
                return classPath.node.id.name;
            }
            
            // Look for assignment: var MyClass = class { ... }
            const parent = classPath.parent;
            if (t.isVariableDeclarator(parent) && t.isIdentifier(parent.id)) {
                return parent.id.name;
            }
        }
        
        return 'UnknownClass';
    }

    getValueType(node) {
        if (t.isStringLiteral(node)) return 'string';
        if (t.isNumericLiteral(node)) return 'number';
        if (t.isBooleanLiteral(node)) return 'boolean';
        if (t.isTemplateLiteral(node)) return 'template';
        return 'unknown';
    }

    getLocation(path) {
        const loc = path.node.loc;
        return {
            file: this.currentFile,
            line: loc ? loc.start.line : 0,
            column: loc ? loc.start.column : 0
        };
    }

    /**
     * Public API to resolve a value by name/key
     */
    resolveValue(key) {
        // Try variables first
        if (this.variableAssignments.has(key)) {
            return this.variableAssignments.get(key).value;
        }
        
        // Try object properties
        if (this.objectProperties.has(key)) {
            return this.objectProperties.get(key).value;
        }
        
        // Try class properties
        if (this.classProperties.has(key)) {
            return this.classProperties.get(key).value;
        }
        
        return null;
    }

    /**
     * Get all resolved values for debugging
     */
    getAllResolvedValues() {
        return {
            variables: Array.from(this.variableAssignments.entries()),
            objectProperties: Array.from(this.objectProperties.entries()),
            classProperties: Array.from(this.classProperties.entries())
        };
    }

    clear() {
        this.variableAssignments.clear();
        this.objectProperties.clear();
        this.classProperties.clear();
        this.templateLiterals.clear();
    }
}
