import * as t from '@babel/types';
import { generate } from '@babel/generator';
import path from 'path';
import { HTTP_PATTERNS } from '../patterns/http-patterns.js';

export class AstUtils {

    static getCalleeInfo(callee) {
        if (t.isIdentifier(callee)) {
            return callee.name;
        }

        if (t.isMemberExpression(callee)) {
            return this.getMemberExpressionInfo(callee);
        }

        return 'unknown';
    }

    static getCalleeInfo2(callee) {
        if (t.isIdentifier(callee)) {
            return callee.name;
        }

        if (t.isMemberExpression(callee)) {
            return this.getMemberExpressionInfo2(callee);
        }

        return 'unknown';
    }
    
    static getCalleeInfo3(callee) {
        if (t.isIdentifier(callee)) {
            return callee.name;
        }

        if (t.isMemberExpression(callee)) {
            return this.getMemberExpressionName(callee);
        }

        return 'unknown';
    }

    static getMemberExpressionInfo(memberExp) {
        const parts = [];

        const traverse = (node) => {
            if (t.isIdentifier(node)) {
                parts.unshift(node.name);
            } else if (t.isMemberExpression(node)) {
                if (t.isIdentifier(node.property)) {
                    parts.unshift(node.property.name);
                }
                traverse(node.object);
            }
        };

        traverse(memberExp);
        return parts.join('.');
    }

    static getMemberExpressionInfo2(memberExp) {
        const parts = [];

        const traverse = (node) => {
            if (t.isMemberExpression(node)) {
                const { object, property, computed, optional } = node;

                parts.unshift({
                    property,
                    computed,
                    optional
                });

                traverse(object);
            } else if (t.isThisExpression(node)) {
                parts.unshift({ raw: 'this' });
            } else if (t.isSuper(node)) {
                parts.unshift({ raw: 'super' })
            } else if (t.isIdentifier(node)) {
                parts.unshift({ raw: node.name });
            } else {
                parts.unshift({ raw: '?' });
            }
        };

        traverse(memberExp);

        let codePath = '';
        for (const part of parts) {
            if (part.raw !== undefined) {
                codePath += part.raw;
                continue;
            }

            const { property, computed, optional } = part;

            const opt = optional ? '?.' : '.';

            if (computed) {
                if (t.isStringLiteral(property)) {
                    codePath += `${opt}[${JSON.stringify(property.value)}]`;
                } else {
                    codePath += `${opt}[${generate(property).code}]`;
                }
            } else {
                if (t.isIdentifier(property)) {
                    codePath += `${opt}${property.name}`;
                } else {
                    codePath += `${opt}[${generate(property).code}]`;
                }
            }
        }

        return codePath;
    }

    static getMemberExpressionName(node) {
        if (node.type === 'MemberExpression') {
            const object = node.object.type === 'Identifier' ? node.object.name :
                node.object.type === 'MemberExpression' ? this.getMemberExpressionName(node.object) : '?';
            const property = node.property.type === 'Identifier' ? node.property.name : '?';
            return `${object}.${property}`;
        }
        return node.name || '?';
    }

    static reconstructTemplateLiteral(templateLiteral) {
        let result = '';

        for (let i = 0; i < templateLiteral.quasis.length; i++) {
            result += templateLiteral.quasis[i].value.cooked;

            if (i < templateLiteral.expressions.length) {
                const exp = templateLiteral.expressions[i];
                if (t.isIdentifier(exp)) {
                    result += `{${exp.name}}`;
                } else {
                    result += '{expression}';
                }
            }
        }
        return result;
    }

    static isHTTPCall(calleeInfo) {
        const lowerCallee = calleeInfo.toLowerCase();

        for (const [category, patterns] of Object.entries(HTTP_PATTERNS)) {
            for (const pattern of patterns) {
                if (lowerCallee.includes(pattern.toLowerCase())) {
                    return true
                }
            }
        }
        return false;
    }

    static categorizeHTTPCall(calleeInfo) {
        const lower = calleeInfo.toLowerCase();

        // JavaScript/TypeScript patterns
        if (lower.includes('fetch')) return 'fetch';
        if (lower.includes('axios')) return 'axios';
        if (lower.includes('ajax') || lower.includes('jquery') || lower.includes('$')) return 'jquery';
        if (lower.includes('xmlhttprequest')) return 'xhr';
        
        // Multi-language HTTP patterns
        if (lower.includes('requests') && lower.includes('get')) return 'python_requests';
        if (lower.includes('curl_exec') || lower.includes('curl')) return 'php_curl';
        if (lower.includes('httpclient') || lower.includes('getasync')) return 'dotnet_httpclient';
        if (lower.includes('net::http') || lower.includes('faraday')) return 'ruby_http';
        if (lower.includes('http.get') || lower.includes('http.post')) return 'go_http';
        if (lower.includes('reqwest') || lower.includes('client::get')) return 'rust_reqwest';
        if (lower.includes('urlsession') || lower.includes('alamofire')) return 'swift_http';
        if (lower.includes('okhttp') || lower.includes('resttemplate')) return 'java_http';

        return null;
    }

    static getCodeSnippet(path) {
        try {
            const code = generate(path.node, { compact: true }).code;
            return code.length > 200 ? code.substring(0, 200) + '...' : code;
        } catch (error) {
            console.log(`error generating code: ${error.message}`);
            return 'Code snippet unavailable';
        }
    }

    static getFunctionName(path) {
        const node = path.node;

        // function f() {}
        if (t.isFunctionDeclaration(node) && t.isIdentifier(node.id)) {
            return node.id.name;
        }

        // class C { m(){} }  OR  const C = class { m(){} }
        if (t.isClassMethod(node)) {
            const cls = path.findParent(p => p.isClassDeclaration() || p.isClassExpression())
            const className = this.getClassIdentifier(cls) || 'AnonymousClass';
            const methodName = this.getPropertyName(node.key);
            return `${className}.${methodName}`;
        }

        // const o = { m(){} }
        if (t.isObjectMethod(node)) {
            const objExpr = path.findParent(p => p.isObjectExpression());
            const carrier = objExpr
                ? objExpr.findParent(p => p.isVariableDeclarator() || p.isAssignmentExpression())
                : null;

            const containerName = this.getAssignmentTarget(carrier);
            const methodName = this.getPropertyName(node.key);

            return containerName ? `${containerName}.${methodName}` : methodName;
        }

        if (t.isArrowFunctionExpression(node) || t.isFunctionExpression(node)) {
            // const f = () => {}
            const declarator = path.findParent(p => p.isVariableDeclarator());
            if (declarator?.node?.id && t.isIdentifier(declarator.node.id)) {
                return declarator.node.id.name;
            }

            // f = function() {}  OR  obj.m = () => {}
            const assignment = path.findParent(p => p.isAssignmentExpression());
            if (assignment?.node?.left) {
                const left = assignment.node.left;
                if (t.isIdentifier(left)) return left.name;
                if (t.isMemberExpression(left)) return this.getMemberExpressionInfo2(left);
            }

            //const o = { m: () => {} }  OR  exports.utils = { m: function() {} }
            const objProp = path.findParent(p => p.isObjectProperty && p.isObjectProperty());
            if (objProp?.node?.value === node) {
                const objExpr = objProp.findParent(p => p.isObjectExpression());
                const carrier = objExpr
                    ? objExpr.findParent(p => p.isVariableDeclarator() || p.isAssignmentExpression())
                    : null;

                const containerName = this.getAssignmentTarget(carrier);
                const keyName = this.getPropertyName(objProp.node.key);
                return containerName ? `${containerName}.${keyName}` : keyName;
            }

            return 'anonymous';
        }

        return 'anonymous';
    }

    static getObjectName(objPath) {
        if (!objPath) return null;

        const parent = objPath.parent;
        if (t.isVariableDeclarator(parent) && t.isIdentifier(parent.id)) {
            return parent.id.name;
        }

        if (t.isAssignmentExpression(parent) && t.isMemberExpression(parent.left)) {
            return this.getMemberExpressionInfo(parent.left);
        }

        return null;
    }

    static getFunctionParams(path) {
        return path.node.params.map(param => {
            if (t.isIdentifier(param)) return param.name;
            if (t.isObjectPattern(param)) return '{object}';
            if (t.isArrayPattern(param)) return '[array]';
            return 'unknown';
        });
    }

    static getPropertyName(keyNode) {
        if (t.isIdentifier(keyNode)) return keyNode.name;
        if (t.isStringLiteral(keyNode) || t.isNumericLiteral(keyNode)) return String(keyNode.value);
        if (t.isPrivateName(keyNode) && t.isIdentifier(keyNode.id)) return `#${keyNode.id.name}`;
        if (t.isExpression(keyNode)) return '[computed]';

        return 'unknown';
    }

    static getClassIdentifier(classPath) {
        if (!classPath || !classPath.node) return 'UnknownClass';

        const classNode = classPath.node;

        let inner = 'AnonymousClass';
        if ((t.isClassDeclaration(classNode) || t.isCallExpression(classNode)) && t.isIdentifier(classNode.id)) {
            inner = classNode.id.name;
        }

        const carrier = classPath.findParent(p => p.isVariableDeclarator() || p.isAssignmentExpression());
        const primary = this.getAssignmentTarget(carrier);
        if (primary) return `${primary}(${inner})`;

        return inner;
    }

    static getAssignmentTarget(path) {
        if (!path) return null;
        const node = path.node;

        if (t.isVariableDeclarator(node) && t.isIdentifier(node.id)) {
            return node.id.name;
        }

        if (t.isAssignmentExpression(node)) {
            const left = node.left;
            if (t.isIdentifier(left)) return left.name;
            if (t.isMemberExpression(left)) return this.getMemberExpressionInfo2(left);
        }

        return null;
    }

    static getLocation(astPath, filePath) {
        const loc = astPath.node.loc;
        return {
            file: path.basename(filePath),
            line: loc ? loc.start.line : 0,
            // column: loc ? loc.start.column : 0
        };
    }
}