import * as t from '@babel/types';
import path from 'path';
import { AstUtils } from '../ast/ast-utils.js';
import { JsonConfigScanner } from './json-config-scanner.js';

export class ScopeResolver {
    constructor() {
        this.configTraces = [];
        this.skipNextTest = false;
        this.scopeStorage = new Map();
    }

    addConfigTrace(name, value, file, line) {
        this.configTraces.push({ name, value, file, line });
    }

    resolveVariable(varName, scope) {
        if (!scope) return `{unresolved: ${varName}}`;

        const binding = scope.getBinding(varName);
        if (!binding) {
            let currentScope = scope.parent;
            while (currentScope) {
                const parentBinding = currentScope.getBinding(varName);
                if (parentBinding) {
                    return this.extractValueFromBinding(parentBinding);
                }
                currentScope = currentScope.parent;
            }
            return `{unresolved: ${varName}}`;
        }

        return this.extractValueFromBinding(binding);
    }

    getChainSegments(path) {
        const segs = [];
        let p = path;

        while (p && (p.isMemberExpression?.() || p.isOptionalMemberExpression?.())) {
            const n = p.node;
            let key = null;
            if (n.computed) {
                if (t.isStringLiteral(n.property)) key = n.property.value;
            } else if (t.isIdentifier(n.property)) {
                key = n.property.name;
            }
            if (!key) return null;
            segs.unshift(key);
            p = p.get('object');
        }
        const base = p?.isThisExpression?.() ? "this" : p?.isIdentifier?.() ? p.node.name : null;
        
        if (!base) return null;
        return { base, segments: segs };
    }

    collectClassChainWrites(classPath, segments) {
        const out = []
        const first = segments[0];
        const tail = segments.slice(1);
        const bodyPaths = classPath.get("body.body");

        const traverseFunction = (funcPath, methodName, kindDefault) => {
            const thisAliases = new Set();
            const isThisish = (obj) =>
                t.isThisExpression(obj) ||
                (t.isIdentifier(obj) && thisAliases.has(obj.name));

            funcPath.traverse({
                VariableDeclarator(p) {
                    if (t.isThisExpression(p.node.init) && t.isIdentifier(p.node.id)) {
                        thisAliases.add(p.node.id.name);
                    }
                },

                AssignmentExpression: (p) => {
                    const { left, operator, right } = p.node;

                    // A) Direct deep write: this.obj.prop = RHS (or computed with string)
                    if (this.isChainOnThis(left, segments, isThisish)) {
                        out.push({ kind: "deep-assign", node: p.node, path: p, rhs: right, operator, funcPath, methodName });
                        return;
                    }

                    // B) Prefix write
                    if (this.isChainOnThis(left, [first], isThisish) && right) {

                    }

                    // D) Object.assign(this.obj, { prop: expr }) or this.obj = Object.assign({}, this.obj, { prop: expr })
                    if (this.isChainOnThis(left, [first], isThisish) && t.isCallExpression(right) && this.isObjectAssign(right.callee)) {
                        const rhsForTail = this.findFromObjectAssignSources(right.arguments.slice(1), tail);
                        if (rhsForTail) {
                            out.push({ kind: "merge-assign", node: p.node, path: p, rhs: rhsForTail, operator, funcPath, methodName });
                        }
                    }
                },

                CallExpression: (p) => {
                    const { callee, arguments: args } = p.node;

                    // E) Object.assign(this.obj, { prop: expr }, ...)
                    if (this.isObjectAssign(callee) && args.length >= 2 && this.isChainTarget(args[0], [first], isThisish)) {
                        const rhsForTail = this.findFromObjectAssignSources(args.slice(1), tail);
                        if (rhsForTail) {
                            out.push({ kind: "merge-assign", node: p.node, path: p, rhs: rhsForTail, operator: "=", funcPath, methodName });
                        }
                    }

                    // F) Object.defineProperty(this.obj, 'prop', { value: expr })
                    if (this.isDefineProperty(callee) && args.length >= 3 && this.isChainTarget(args[0], [first], isThisish)) {
                        const keyOk =
                            (t.isStringLiteral(args[1]) && args[1].value === tail[0]) ||
                            (t.isIdentifier(args[1]) && args[1].name === tail[0]);
                        if (keyOk && t.isObjectExpression(args[2])) {
                            const valNode = this.findValueProp(args[2]);
                            if (valNode) {
                                out.push({ kind: "defineProperty", node: p.node, path: p, rhs: valNode, operator: "=", funcPath, methodName });
                            }
                        }
                    }
                },
            }, funcPath.scope);
        };

        // 1) Class field
        for (const el of bodyPaths) {
            if (t.isClassProperty?.(el.node) || t.isPropertyDefinition?.(el.node)) {
                const { key, value } = el.node;
                if (!value) continue;
                const keyName =
                    t.isIdentifier(key) ? key.name :
                        t.isPrivateName(key) ? key.id?.name : null;
                if (keyName === first) {
                    const testValue = this.evaluateNode(value, classPath.scope)
                    // const rhsForTail = this.propFromExpr(value, tail, classPath.scope);
                    // console.log('rhsForTail: ', rhsForTail)
                    // if (rhsForTail) out.push({ kind: 'class-field', node: el.node, path: el, rhs: rhsForTail });
                }
            }
        }

        // 2) Constructor
        const ctor = bodyPaths.find(p => p.isClassMethod?.({ kind: "constructor" }) || p.isClassPrivateMethod?.({ kind: "constructor" }));
        if (ctor) traverseFunction(ctor, null, "ctor-assign");

        // 3) Other methods
        for (const m of bodyPaths) {
            if (m === ctor) continue;
            if (m.isClassMethod?.() || m.isClassPrivateMethod?.()) {
                const name = this.getMethodName(m);
                traverseFunction(m, name, "method-assign");
            }
        }

        return out;
    }

    propFromExpr(expr, tail, scope, seen = new Set(), argEnv = Object.create(null)) {
        if (!expr) return null; 

        // param substitution
        if (t.isIdentifier(expr) && Object.prototype.hasOwnProperty.call(argEnv, expr.name)) {
            return this.propFromExpr(argEnv[expr.name], tail, scope, seen, argEnv);
        }

        // A) Object literal
        if (t.isObjectExpression(expr)) {
            return this.findNestedInObjectLiteral(expr, tail) ?? this.findLastExplicitProperty(expr, tail);
        }

        // B) new Class(...)
        if (t.isNewExpression(expr)) {

        }

        // C) Identifier
        if (t.isIdentifier(expr)) {
            const key = `id:${expr.name}`;
            if (seen.has(key)) return null;
            seen.add(key);

            const binding = scope.getBinding(expr.name);
            if (!binding) return null;

            const bp = binding.path;

            if (bp.isVariableDeclarator() && bp.node.init) {
                return this.propFromExpr(bp.node.init, tail, bp.scope, seen, argEnv);
            }

            if ((bp.isClassDeclaration() || bp.isClassExpression()) && tail.length >= 1) {
                // handle...
            }

            if (bp.isFunctionDeclaration() || bp.isFunctionExpression() || bp.isArrowFunctionExpression()) {
                return this.propFromFactoryFunction(bp, tail, seen, argEnv);
            }
            return null;
        }

        // D) Call expression: trace factory returns
        if (t.isCallExpression(expr)) {
            return this.propFromFactoryCall(expr, tail, scope, seen, argEnv);
        }

        // E) Conditional / logical / sequence: try both/last
        if (t.isConditionalExpression(expr)) {
            return this.propFromExpr(expr.consequent, tail, scope, seen, argEnv) ||
                this.propFromExpr(expr.alternate, tail, scope, seen, argEnv);
        }
        if (t.isLogicalExpression(expr)) {
            // heuristics: for `a || b` / `a ?? b` / `a && b` prefer RHS
            return this.propFromExpr(expr.right, tail, scope, seen, argEnv) ||
                this.propFromExpr(expr.left, tail, scope, seen, argEnv);
        }
        if (t.isSequenceExpression(expr)) {
            const last = expr.expressions[expr.expressions.length - 1];
            return this.propFromExpr(last, tail, scope, seen, argEnv);
        }

        // F) Object.assign(target, sources...) used as expression RHS
        if (t.isCallExpression(expr) && this.isObjectAssign(expr.callee)) {
            const rhs = this.findFromObjectAssignSources(expr.arguments.slice(1), tail);
            if (rhs) return rhs;
        }

        // Unknown / dynamic
        return null;
    }

    propFromClassInstance(classBinding, tail, scope, seen) {
        const classPath = classBinding.path;
        const [head, ...rest] = tail;
        // handle...
    }

    propFromFactoryCall(callExpr, tail, scope, seen = new Set(), outerEnv = Object.create(null)) {
        const providers = this.functionsFromCallee(callExpr.callee, scope, seen);
        for (const fnPath of providers) {
            const argEnv = this.buildArgEnv(callExpr, fnPath, outerEnv, scope);
            return this.propFromFactoryFunction(fnPath, tail, seen, argEnv);
        }

        const { callee } = callExpr;
       
        if (t.isLogicalExpression(callee)) {
            let v = this.propFromExpr(callee.left, tail, scope, seen, outerEnv)
            if (v) return v;
            if (t.isCallExpression(callee.right)) {
                this.propFromExpr(callee.right, tail, scope, seen, outerEnv)
            } else if (t.isIdentifier(callee.right)) {
                const binding = scope.getBinding(callee.right.name);
                if (binding && (binding.path.isFunctionDeclaration() || binding.path.isFunctionExpression() || binding.path.isArrowFunctionExpression())) {
                    const argEnv = this.buildArgEnv(callExpr, binding.path, outerEnv, scope);
                    return this.propFromFactoryFunction(binding.path, tail, seen, argEnv);
                }
            }
        }
        return null;
    }

    propFromFactoryFunction(fnPath, tail, seen = new Set(), argEnv = Object.create(null)) {
        let found = null;
        fnPath.traverse({
            ReturnStatement: (p) => {
                if (found) return;
                const v = p.node.argument;
                found = this.propFromExpr(v, tail, p.scope, seen, argEnv);
            }
        }, fnPath.scope);
        return found;
    }

    buildArgEnv(callExpr, fnPath, outerEnv = Object.create(null), scope) {
        const env = Object.create(null);
        const params = fnPath.node?.params || fnPath.params || [];
        const args = callExpr.arguments || [];

        for (let i = 0; i < params.length; i++) {
            const rawArg = args[i]; 
            const normArg = this.substituteArgs(rawArg, outerEnv, scope);

            const p = params[i];
            if (t.isIdentifier(p)) {
                env[p.name] = normArg;
            } else if (t.isAssignmentPattern(p) && t.isIdentifier(p.left)) {
                let enumProp = null;
                if (t.isMemberExpression(p.right)) {
                    const objectName = p.right.object.name;
                    const propertyName = p.right.property.name;
                    const binding = scope.getBinding(objectName);
                    if (binding && binding.path.isVariableDeclarator()) {
                        const initNode = binding.path.node.init;
                        if (t.isCallExpression(initNode)) {
                            const fn = initNode.callee;
                            if (t.isFunctionExpression(fn)) {
                                const enumObj = this.evaluateEnumFunction(fn);
                                enumProp = enumObj[propertyName];
                            }
                        }
                    }
                }
                env[p.left.name] = normArg ?? enumProp ?? p.right;
            } else if (t.isRestElement(p) && t.isIdentifier(p.argument)) {
                env[p.argument.name] = t.arrayExpression(args.slice(i).map(a => this.substituteArgs(a, outerEnv, scope)));
                break;
            }
        }
        return env;
    }

    evaluateEnumFunction(fn) {
        const result = {}
        const param = fn.params[0].name;

        const stmt = fn.body.body[0];
        if (t.isReturnStatement(stmt) && t.isSequenceExpression(stmt.argument)) {
            for (const expr of stmt.argument.expressions) {
                if (t.isAssignmentExpression(expr) && t.isMemberExpression(expr.left)) {
                    const left = expr.left;
                    const right = expr.right;

                    if (t.isIdentifier(left.object, { name: param })) {
                        const computedKey = left.property;
                        if (t.isAssignmentExpression(computedKey)) {
                            const keyName = computedKey.left.name ?? computedKey.left.property.name;
                            const keyValue = computedKey.right.value;
                            result[keyName] = keyValue;
                        }
                    }
                }
            }
        }
        return result;
    }

    substituteArgs(expr, outerEnv, scope) {
        if (!expr) return expr;

        if (t.isIdentifier(expr) && Object.prototype.hasOwnProperty.call(outerEnv, expr.name)) {
            return outerEnv[expr.name];
        }
        if (t.isIdentifier(expr)) {
            const binding = scope.getBinding(expr.name);
            if (binding.path.isVariableDeclarator()) {
                if (t.isClassExpression(binding.path.node.init)) {
                    const classPath = binding.path.get('init')
                    this.scopeStorage.set(binding.path.node.init, classPath.scope);
                   
                    return binding.path.node.init;
                }
                const result = this.evaluateNode(binding.path.node.init, binding.scope);
                return result;
            }
            return binding.path.node;
        }
        if (t.isCallExpression(expr)) {
            const providers = this.functionsFromCallee(expr.callee, scope);
            for (const fnPath of providers) {
                const argEnv = this.buildArgEnv(expr, fnPath, outerEnv, scope);
                
                for (const stmt of fnPath.node.body.body) {
                    if (t.isReturnStatement(stmt)) {
                        return this.evaluateNode(stmt.argument, fnPath.scope, argEnv)
                    }
                }
            }
        }
        if (t.isObjectExpression(expr)) {
            return this.evaluateNode(expr, scope, outerEnv)
        }

        return expr;
    }

    functionsFromCallee(callee, scope, seen = new Set()) {
        if (!callee) return [];

        if (t.isIdentifier(callee)) {
            const key = `callee-id:${callee.name}`; 
            if (seen.has(key)) return [];
            seen.add(key);

            const b = scope.getBinding(callee.name);
            if (!b) return [];

            const p = b.path;
            if (p.isFunctionDeclaration() || p.isFunctionExpression() || p.isArrowFunctionExpression()) {
                return [p];
            }
            if (p.isVariableDeclarator() && p.node.init) {
                return this.functionsFromCallee(p.node.init, p.scope, seen);
            }
            return [];
        }

        if (this.isFunctionLike(callee)) {
            // fake path
            return [{ node: callee, isFunctionExpression: () => true, traverse: () => { }, scope }];
        }

        if (t.isLogicalExpression(callee)) {
            // fake path
            return [{ node: this.evaluateNode(callee, scope), isFunctionExpression: () => true, traverse: () => { }, scope }];
        }

        return [];
    }

    evaluateNode(node, scope, paramMap = Object.create(null), nodePath) {
        if (!node) return undefined;

        switch (node.type) {
            case "NumericLiteral":
            case "BooleanLiteral":
            case "StringLiteral":
                return node.value;

            case "Identifier":
                if (t.isIdentifier(node) && Object.prototype.hasOwnProperty.call(paramMap, node.name)) {
                    return paramMap[node.name];
                }
                const binding = scope.getBinding(node.name);
                if (binding) {
                    if (binding.path.isVariableDeclarator()) {
                        return this.evaluateNode(binding.path.node.init, binding.scope, paramMap);
                    } else {
                        return binding.path.node;
                    }
                }
                return undefined;

            case "LogicalExpression": {
                const left = this.evaluateNode(node.left, scope, paramMap);

                if (node.operator === "&&") {
                    if (!left) return left;
                    return this.evaluateNode(node.right, scope, paramMap);
                }
                if (node.operator === "||") {
                    if (left) return left;
                    return this.evaluateNode(node.right, scope, paramMap);
                }
                if (node.operator === "??") {
                    if (left !== null && left !== undefined) return left;
                    return this.evaluateNode(node.right, scope, paramMap);
                }
                break;
            }

            case "BinaryExpression": {
                const left = this.evaluateNode(node.left, scope, paramMap);
                const right = this.evaluateNode(node.right, scope, paramMap);
    
                switch (node.operator) {
                    case "+": return left + right;
                    case "-": return left - right;
                    case "*": return left * right;
                    case "/": return left / right;
                    case "%": return left % right;
                    case "|": return left | right;
                    case "&": return left & right;
                    case "^": return left ^ right;
                    case "==": return left == right;
                    case "===": return left === right;
                    case "!=": return left != right;
                    case "!==": return left !== right;
                    case ">": return left > right;
                    case "<": return left < right;
                    case ">=": return left >= right;
                    case "<=": return left <= right;
                }
                break;
            }

            case "ConditionalExpression": {
                return this.evaluateNode(node.test, scope, paramMap)
                    ? this.evaluateNode(node.consequent, scope, paramMap)
                    : this.evaluateNode(node.alternate, scope, paramMap);
            }

            case "UnaryExpression": {
                const arg = this.evaluateNode(node.argument, scope, paramMap);
                switch (node.operator) {
                    case "typeof":
                        if (t.isClassExpression(arg) || t.isClassDeclaration(arg)) return "function"
                        return typeof arg;
                    case "!": return !arg;
                    case "~": return ~arg;
                    case "+": return +arg;
                    case "-": return -arg;
                    case "void": return undefined;
                }
                break;
            }

            case "ObjectExpression": {
                const obj = {};
                node.properties.forEach(p => {
                    const key = t.isIdentifier(p.key) ? p.key.name : this.evaluateNode(p.key, scope, paramMap);
                    obj[key] = this.evaluateNode(p.value, scope, paramMap);
                });
                return obj;
            }

            case "MemberExpression": {
                const obj = this.evaluateNode(node.object, scope, paramMap);
                const prop = node.computed ? this.evaluateNode(node.property, scope, paramMap) : node.property.name;
                if (t.isClassExpression(obj)) {
                    let classScope;
                    if (this.scopeStorage.has(obj)) {
                        classScope = this.scopeStorage.get(obj)
                    }
                    for (const el of obj.body.body) {
                        if (t.isClassProperty(el)) {
                            if (t.isIdentifier(el.key, { name: prop })) {
                                if (classScope) {
                                    const test = this.evaluateNode(el.value, classScope)
                                    return test;
                                }
                                return this.evaluateNode(el.value, scope);
                            }
                            if (t.isStringLiteral(el.key, { value: prop })) return this.evaluateNode(el.value, scope);
                        }
                    }
                }
                if (t.isNode(obj[prop])) {                  
                    const val = this.evaluateNode(obj[prop], scope, paramMap)
                    if (val) return val;
                }
                return obj?.[prop];
            }

            case "AssignmentExpression": {
                const value = this.evaluateNode(node.right, scope, paramMap);
                if (t.isIdentifier(node.left)) {
                    const name = node.left.name;
                    paramMap[name] = value;
                }
                return value;
            }

            case "UpdateExpression": {
                if (t.isIdentifier(node.argument)) {
                    const name = node.argument.name;
                    const oldVal = paramMap[name] ?? 0;
                    const newVal = node.operator === "++" ? oldVal + 1 : oldVal - 1;
                    paramMap[name] = newVal;
                    return newVal;
                }
                break;
            }

            case "SequenceExpression":
                return this.evaluateNode(node.expressions[node.expressions.length - 1], scope, paramMap);

            case "CallExpression": {
                const callee = node.callee;
                const calleePath = nodePath?.get('callee');
                if (t.isMemberExpression(callee)) {
                    const calleeObjPath = calleePath?.get('object')
                    const obj = this.evaluateNode(callee.object, scope, paramMap, calleeObjPath);
                    let objPath;
                    if (t.isNewExpression(callee.object) && t.isIdentifier(callee.object.callee)) {
                        const binding = scope.getBinding(callee.object.callee.name)
                        if (binding && binding.path.isVariableDeclarator()) {
                            const initPath = binding.path.get('init')
                            if (initPath.isClassExpression()) {
                                objPath = initPath;
                            }
                        }
                    }
                    const prop = callee.property.name;

                    if (prop === "hasOwnProperty" && typeof obj === "object" && obj !== null) {
                        const arg = this.evaluateNode(node.arguments[0], scope, paramMap);
                        if (t.isClassExpression(obj)) {
                            for (const el of obj.body.body) {
                                if (t.isClassProperty(el)) {
                                    if (t.isIdentifier(el.key, { name: arg })) return true;
                                    if (t.isStringLiteral(el.key, { value: arg })) return true;
                                }
                            }
                            return false;
                        }
                        return Object.prototype.hasOwnProperty.call(obj, arg);

                    } else if (t.isClassExpression(obj) || t.isClassDeclaration(obj)) {
                        if (objPath) {
                            const bodyPaths = objPath.get('body.body')
                            for (const el of bodyPaths) {
                                if (el.isClassMethod()) {
                                    if (t.isIdentifier(el.node.key, { name: prop })) {
                                        const argEnv = this.buildArgEnv(node, el, paramMap, scope)
                                        const elBody = el.get('body.body')
                                        return this.evaluateStatements(el.node.body.body, scope, argEnv, elBody);
                                    }
                                }
                            }
                        } else {
                            for (const el of obj.body.body) {
                                if (t.isClassProperty(el)) {
                                    if (t.isIdentifier(el.key, { name: prop })) {
                                        const test = this.evaluateNode(el.value, scope);
                                        return test;
                                    }
                                }
                                if (t.isClassMethod(el)) {
                                    if (t.isIdentifier(el.key, { name: prop })) {
                                        const fakePath = { node: el, isFunctionExpression: () => true, traverse: () => { }, scope };
                                        const argEnv = this.buildArgEnv(node, fakePath, paramMap, scope)
                                        return this.evaluateStatements(el.body.body, scope, argEnv);
                                    }
                                }
                            }
                        }
                    } else {
                        const funcNode = this.evaluateNode(callee, scope, paramMap)
                        const fakePath = { node: funcNode, isFunctionExpression: () => true, traverse: () => { }, scope };
                        const argEnv = this.buildArgEnv(node, fakePath, paramMap, scope)
                        return this.evaluateStatements(funcNode.body.body, scope, argEnv);
                    }
                }


                const providers = this.functionsFromCallee(callee, scope);
                for (const fnPath of providers) {
                    const argEnv = this.buildArgEnv(node, fnPath, paramMap, scope);                  
                    return this.evaluateStatements(fnPath.node.body.body, fnPath.scope, argEnv);
                }
            }

            case "NewExpression": {
                // should support a case where it passes arguments to constructor
                return this.evaluateNode(node.callee, scope);
            }

            case "ThisExpression": {
                const classPath = nodePath.findParent(p => p.isClassDeclaration() || p.isClassExpression())
                return classPath?.node;
            }

            case "NullLiteral":
                return null;
        }

        return node;
    }

    evaluateStatements(stmts, scope, paramMap, stmtsPaths) {
        if (!stmts || stmts.length === 0) return undefined;
        let lastVal;

        for (let i = 0; i < stmts.length; i++) {
            const stmt = stmts[i] 
            const stmtPath = stmtsPaths && stmtsPaths.length > 0 ? stmtsPaths[i] : null;

            if (t.isReturnStatement(stmt)) {
                const argumentPath = stmtPath?.get('argument')
                return this.evaluateNode(stmt.argument, scope, paramMap, argumentPath);
            }

            if (t.isVariableDeclaration(stmt)) {
                stmt.declarations.forEach((decl) => {
                    const name = decl.id.name;
                    const val = this.evaluateNode(decl.init, scope, paramMap);
                    paramMap[name] = val;
                });
                continue;
            }

            if (t.isExpressionStatement(stmt)) {
                lastVal = this.evaluateNode(stmt.expression, scope, paramMap);
                continue;
            }

            if (t.isIfStatement(stmt)) {
                if (this.skipNextTest) {
                    this.skipNextTest = false;
                    const branch = stmt.consequent;
                    if (branch) {
                        const val = t.isBlockStatement(branch)
                            ? this.evaluateStatements(branch.body, scope, paramMap)
                            : this.evaluateStatements([branch], scope, paramMap);
                        if (val !== undefined) return val;
                    }
                    continue;
                }
                const test = this.evaluateNode(stmt.test, scope, paramMap);
                const branch = test ? stmt.consequent : stmt.alternate;
                if (branch) {
                    const val = t.isBlockStatement(branch)
                        ? this.evaluateStatements(branch.body, scope, paramMap)
                        : this.evaluateStatements([branch], scope, paramMap);
                    if (val !== undefined) return val;
                }
                continue;
            }

            if (t.isWhileStatement(stmt)) {
                while (this.evaluateNode(stmt.test, scope, paramMap)) {
                    const val = this.evaluateStatements(stmt.body.body, scope, paramMap);
                    if (val !== undefined) return val;
                }
                continue;
            }

            if (t.isForStatement(stmt)) {
                if (stmt.init) this.evaluateNode(stmt.init, scope, paramMap);
                while (!stmt.test || this.evaluateNode(stmt.test, scope, paramMap)) {
                    const val = this.evaluateStatements(stmt.body.body, scope, paramMap);
                    if (val !== undefined) return val;
                    if (stmt.update) this.evaluateNode(stmt.update, scope, paramMap);
                }
                continue;
            }

            if (t.isForInStatement(stmt)) {
                const right = this.evaluateNode(stmt.right, scope, paramMap);

                if (right && typeof right === 'object') {
                    for (const key in right) {
                        if (Object.prototype.hasOwnProperty.call(right, key)) {
                            if (t.isVariableDeclaration(stmt.left)) {
                                const decl = stmt.left.declarations[0];
                                paramMap[decl.id.name] = key;
                            } else if (t.isIdentifier(stmt.left)) {
                                paramMap[stmt.left.name] = key;
                            }

                            let val;
                            if (t.isBlockStatement(stmt.body)) {
                                val = this.evaluateStatements(stmt.body.body, scope, paramMap);
                            } else {
                                val = this.evaluateStatements([stmt.body], scope, paramMap);
                            }
                            if (val !== undefined) return val;
                        }
                    }
                }
                continue;
            }

            if (t.isThrowStatement(stmt)) {
                this.skipNextTest = true;
                continue;
            }
        }
        return lastVal;
    }

    isFunctionLike(n) {
        return t.isFunctionExpression(n) || t.isArrowFunctionExpression(n) || t.isFunctionDeclaration(n);
    }

    isObjectAssign(callee) {
        return t.isMemberExpression(callee) &&
            t.isIdentifier(callee.object, { name: 'Object' }) &&
            t.isIdentifier(callee.property, { name: 'assign' });
    }
    isDefineProperty(callee) {
        return t.isMemberExpression(callee) &&
            t.isIdentifier(callee.object, { name: 'Object' }) &&
            t.isIdentifier(callee.property, { name: 'defineProperty' });
    }
    findValueProp(objExpr) {
        if (!t.isObjectExpression(objExpr)) return null;
        const prop = objExpr.properties.find(p => t.isObjectProperty(p) && t.isIdentifier(p.key, { name: "value" }));
        return prop ? prop.value : null;
    }

    isChainOnThis(node, segments, isThisish) {
        if (!t.isMemberExpression(node) && !t.isOptionalMemberExpression?.(node)) return false;
        const segs = [];
        let n = node;
        while (t.isMemberExpression(n) || t.isOptionalMemberExpression?.(n)) {
            let key = null;
            if (n.computed) {
                if (t.isStringLiteral(n.property)) key = n.property.value;
            } else if (t.isIdentifier(n.property)) {
                key = n.property.name;
            }
            if (!key) return false;
            segs.unshift(key);
            n = n.object;
        }
        if (!isThisish(n)) return false;
        if (segs.length !== segments.length) return false;
        for (let i = 0; i < segs.length; i++) {
            if (segs[i] !== segments[i]) return false;
        }
        return true;
    }

    isChainTarget(expr, segments, isThisish) {
        if (t.isMemberExpression(expr) || t.isOptionalMemberExpression?.(expr)) {
            return this.isChainOnThis(expr, segments, isThisish);
        }
        return false;
    }

    findNestedInObjectLiteral(objExpr, pathSegs) {
        if (!t.isObjectExpression(objExpr)) return null;
        const [head, ...rest] = pathSegs;
        const prop = this.findLastOwnProp(objExpr, head);
        if (!prop) return null;
        if (rest.length === 0) return prop.value;
        return this.findNestedInObjectLiteral(prop.value, rest);
    }

    findLastOwnProp(objExpr, keyName) {
        let found = null;
        for (const p of objExpr.properties) {
            if (!t.isObjectProperty(p)) continue;
            const matches =
                (!p.computed && t.isIdentifier(p.key, { name: keyName })) ||
                (p.computed && t.isStringLiteral(p.key, { value: keyName }));
            if (matches) found = p;
        }
        return found;
    }

    findLastExplicitProperty(objExpr, tail) {
        const [head, ...rest] = tail;
        if (!t.isObjectExpression(objExpr)) return null;
        const prop = this.findLastOwnProp(objExpr, head);
        if (!prop) return null;
        if (rest.length === 0) return prop.value;
        return this.findLastExplicitProperty(prop.value, rest);
    }

    findFromObjectAssignSources(sources, tail) {
        let rhs = null;
        for (const arg of sources) {
            if (!t.isObjectExpression(arg)) continue;
            const v = this.findNestedInObjectLiteral(arg, tail) ?? this.findLastExplicitProperty(arg, tail);
            if (v) rhs = v;
        }
        return rhs;
    }

    getMethodName(m) {
        const key = m.node.key;
        if (t.isIdentifier(key)) return key.name;
        if (t.isStringLiteral(key)) return key.value;
        return null;
    }

    resolveMemberExpression(memberExpr, scope, astPath) {

        const chain = this.getChainSegments(astPath);
        if (chain && chain.base === "this" && chain.segments.length > 0) {
            const segments = chain.segments;
            const readStart = astPath.node.start ?? -1;

            const classPath = astPath.findParent(p => p.isClassDeclaration() || p.isClassExpression());

            if (classPath) {
                const candidates = this.collectClassChainWrites(classPath, segments);

                const funcParent = astPath.getFunctionParent();
                const sameMethod = (p) => p.funcPath && funcParent && p.funcPath === funcParent;
                const beforeRead = (p) => (p.node?.start ?? -1) < readStart;

                const ranked = [
                    ...candidates.filter(c => sameMethod(c) && beforeRead(c))
                        .sort((a, b) => (b.node.start ?? 0) - (a.node.start ?? 0)),
                    ...candidates.filter(c => (c.kind === "class-field" || c.kind === "ctor-assign" || c.kind === "merge-assign" || c.kind === "defineProperty")
                        && !(sameMethod(c) && beforeRead(c))),
                    ...candidates.filter(c => !sameMethod(c) || !beforeRead(c))
                ];

                const result = ranked.map(c => ({
                    kind: c.kind,
                    method: c.methodName ?? null,
                    operator: c.operator ?? "=",
                    rhs: c.rhs ?? null,
                    loc: c.node?.loc ?? null,
                    path: c.path
                }));
                // handle...
            }
        }

        // to remove:
        if (t.isThisExpression(memberExpr.object.object)) {
            const data = JsonConfigScanner.getJsonData();
            if (data[memberExpr.property.name]) return data[memberExpr.property.name]
        }

        if (t.isMemberExpression(memberExpr)) {
            const objectName = t.isIdentifier(memberExpr.object) ? memberExpr.object.name : null;
            const propertyName = t.isIdentifier(memberExpr.property) ? memberExpr.property.name : null;

            if (objectName && propertyName) {
                const objetValue = this.resolveVariable(objectName, scope);

                if (typeof objetValue === 'object' && objetValue && objetValue[propertyName]) {
                    return objetValue[propertyName];
                }
            }
        }

        const memberInfo = AstUtils.getMemberExpressionInfo(memberExpr);
        return `{unresolved: ${memberInfo}}`;
    }

    extractValueFromBinding(binding) {
        if (!binding.path || !binding.path.node) {
            return '{unresolved}';
        }

        const node = binding.path.node;

        if (t.isVariableDeclarator(node) && node.init) {
            return this.extractValueFromNode(node.init, binding.scope);
        }

        if (t.isIdentifier(node)) {
            return `{parameter: ${node.name}}`;
        }
        return '{complex_binding}';
    }

    extractValueFromNode(node, scope, astPath) {
        if (t.isStringLiteral(node)) {
            return node.value;
        }

        if (t.isNumericLiteral(node)) {
            return node.value;
        }

        if (t.isBooleanLiteral(node)) {
            return node.value;
        }

        if (t.isNullLiteral(node)) {
            return null;
        }

        if (t.isObjectExpression(node)) {
            return this.extractObjectProperties(node, scope);
        }

        if (t.isArrayExpression(node)) {
            return node.elements.map(el => el ? this.extractValueFromNode(el, scope) : null);
        }

        if (t.isTemplateLiteral(node)) {
            return this.reconstructTemplateLiteral(node, scope);
        }

        if (t.isIdentifier(node)) {
            if (scope) {
                const resolved = this.resolveVariable(node.name, scope);
                return resolved !== `{unresolved: ${node.name}}` ? resolved : `{variable: ${node.name}}`;
            }
            return `{variable: ${node.name}}`;
        }

        if (t.isMemberExpression(node)) {
            if (scope) {
                const resolved = this.resolveMemberExpression(node, scope, astPath);
                const memberInfo = AstUtils.getMemberExpressionInfo2(node);
                return resolved !== `{unresolved: ${memberInfo}}` ? resolved : `{member: ${memberInfo}}`;
            }
            return `{member: ${AstUtils.getMemberExpressionInfo2(node)}}`;
        }

        if (t.isBinaryExpression(node)) {
            const left = this.extractValueFromNode(node.left, scope);
            const right = this.extractValueFromNode(node.right, scope);
            if (node.operator === '+' && typeof left === 'string' && typeof right === 'string') {
                return left + right;
            }
            return `{${left} ${node.operator} ${right}}`;
        }

        if (t.isCallExpression(node)) {
            return '{function_call}';
        }

        return '{complex_expression}';
    }

    extractObjectProperties(objectExpr, scope) {
        const obj = {};

        if (!objectExpr.properties) return obj;

        objectExpr.properties.forEach(prop => {
            if (t.isObjectProperty(prop) || t.isObjectMethod(prop)) {
                let key = 'unknown';

                if (t.isIdentifier(prop.key)) {
                    key = prop.key.name;
                } else if (t.isStringLiteral(prop.key)) {
                    key = prop.key.value;
                }

                if (t.isObjectProperty(prop) && prop.value) {
                    obj[key] = this.extractValueFromNode(prop.value, scope);
                } else if (t.isObjectMethod(prop)) {
                    obj[key] = '{method}';
                }
            }
        });
        return obj;
    }

    reconstructTemplateLiteral(templateLiteral, scope, templatePath) {
        const quasis = templatePath ? templatePath.get('quasis') : null;
        const exprPaths = templatePath ? templatePath.get('expressions') : null;
        let result = '';

        for (let i = 0; i < templateLiteral.quasis.length; i++) {
            result += templateLiteral.quasis[i].value.cooked || templateLiteral.quasis[i].value.raw;

            if (i < templateLiteral.expressions.length) {
                const exp = templateLiteral.expressions[i];
                const expPath = exprPaths ? exprPaths[i] : null;
                const resolvedValue = this.extractValueFromNode(exp, scope, expPath);

                if (typeof resolvedValue === 'string' && !resolvedValue.startsWith('{')) {
                    result += resolvedValue
                } else if (t.isIdentifier(exp)) {
                    result += `{${exp.name}}`;
                } else {
                    result += '{expression}';
                }
            }
        }
        return result;
    }

    trackConfigAssignment(astPath, filePath) {
        let name, value, assignmentNode;

        if (t.isVariableDeclarator(astPath.node)) {
            if (!t.isIdentifier(astPath.node.id) || !astPath.node.init) return;
            name = astPath.node.id.name;
            assignmentNode = astPath.node.init;
        } else if (t.isAssignmentExpression(astPath.node)) {
            if (t.isMemberExpression(astPath.node.left)) {
                name = AstUtils.getMemberExpressionInfo(astPath.node.left);
            } else if (t.isIdentifier(astPath.node.left)) {
                name = astPath.node.left.name;
            } else {
                return;
            }
            assignmentNode = astPath.node.right;
        } else {
            return;
        }

        if (!AstUtils.isConfigRelated(name)) return;

        value = this.extractValueFromNode(assignmentNode, astPath.scope);

        this.configTraces.push({
            name: name,
            value: value,
            file: path.basename(filePath),
            line: astPath.node.loc?.start?.line,
            type: t.isVariableDeclarator(astPath.node) ? 'config_variable' : 'config_property',
            scope: astPath.scope
        })
    }

    getConfigTraces() {
        return this.configTraces;
    }

    clearConfigTraces() {
        this.configTraces = [];
    }
}