import * as t from '@babel/types';

export class ConfigLoadingTracker {
    constructor(scopeResolver, jsonConfigScanner) {
        this.scopeResolver = scopeResolver;
        this.jsonConfigScanner = jsonConfigScanner;

        this.holders = [];
        this.seeds = [];
        this.memberSeeds = [];
        this.seen = new WeakSet();
    }

    textOfTemplate(tpl) {
        return tpl.quasis.map(q => q.value.cooked).join("${}");
    }

    isConfigJsonString(node) {
        if (t.isStringLiteral(node)) return node.value.includes('settings.json');
        if (t.isTemplateLiteral(node)) return this.textOfTemplate(node).includes('settings.json');
        if (t.isBinaryExpression(node) && node.operator === '+') {
            return this.isConfigJsonString(node.left) || this.isConfigJsonString(node.right)
        }
        return false;
    }

    nearestClassName(path) {
        const c = path.findParent(p => p.isClassDeclaration() || p.isClassExpression());
        if (!c) return null;
        if (t.isClassDeclaration(c.node) && c.node.id) return c.node.id.name;

        const vd = c.findParent(p => p.isVariableDeclarator() && p.node.init === c.node);
        return vd && t.isIdentifier(vd.node.id) ? vd.node.id.name : "<anonymous class>";
    }

    nearestClassPath(path) {
        return path.findParent(p => p.isClassDeclaration() || p.isClassExpression());
    }

    displayNameForClassPath(cPath) {
        const vd = cPath.findParent(p => p.isVariableDeclarator() && p.node.init === cPath.node);
        if (vd && vd.node.id && t.isIdentifier(vd.node.id)) return vd.node.id.name;
        return cPath.node.id ? cPath.node.id.name : "<anonymous>";
    }

    classAnchorFromIdentifierRef(refPath) {
        const id = refPath.node; // Identifier
        const binding = refPath.scope.getBinding(id.name);
        if (!binding) return null;

        const bp = binding.path;

        if (bp.isClassExpression() || bp.isClassDeclaration()) {
            return bp.node;
        }
        if (bp.isIdentifier() && bp.parentPath && bp.parentPath.isClassExpression()) {
            return bp.parentPath.node; // ClassExpression node
        }
        if (bp.isVariableDeclarator() && bp.node.init && bp.get('init').isClassExpression()) {
            return bp.node.init; // ClassExpression node
        }

        return null;
    }

    propName(node) {
        return t.isIdentifier(node) ? node.name :
            t.isStringLiteral(node) ? node.value : "<computed>";
    }

    inStaticMehtod(path) {
        const m = path.findParent(p => p.isClassMethod() || p.isClassPrivateMethod());
        return !!(m && m.node.static);
    }

    recordBindingAndTrace(path, name) {
        const binding = path.scope.getBinding(name);
        if (!binding) return;
        this.holders.push({ type: 'binding', name });

        for (const ref of binding.referencePaths) {
            const parent = ref.parentPath && ref.parentPath.node;

            // Object.assign(this, name)
            if (t.isCallExpression(parent) &&
                t.isMemberExpression(parent.callee) &&
                t.isIdentifier(parent.callee.object, { name: "Object" }) &&
                t.isIdentifier(parent.callee.property, { name: 'assign' }) &&
                parent.arguments.length >= 2 &&
                t.isThisExpression(parent.arguments[0]) &&
                parent.arguments.slice(1).includes(ref.node)) {
                this.holders.push({
                    type: 'instance-from-config',
                    className: this.displayNameForClassPath(this.nearestClassPath(ref)),
                    via: name
                })
            }

            // this.prop = name
            if (t.isAssignmentExpression(parent) && parent.right === ref.node &&
                t.isMemberExpression(parent.left) && t.isThisExpression(parent.left.object)) {
                // const prop = t.isIdentifier(parent.left.property) ? parent.left.property.name
                //     : t.isStringLiteral(parent.left.property) ? parent.left.property.value
                //         : '<computed>';
                this.holders.push({
                    type: 'class-field',
                    className: this.nearestClassName(ref) || '<unknown>',
                    property: this.propName(parent.left.property),
                    via: name
                });
            }

            // const alias = name
            if (ref.parentPath.isVariableDeclarator() &&
                ref.parentPath.node.init === ref.node &&
                t.isIdentifier(ref.parentPath.node.id)) {
                const alias = ref.parentPath.node.id.name;
                this.holders.push({ type: 'alias', from: name, to: alias });
                this.recordBindingAndTrace(ref.parentPath, alias);
            }

            // new Ctor(name)
            if (t.isNewExpression(parent) && parent.arguments.includes(ref.node)) {
                const argIndex = parent.arguments.indexOf(ref.node);
                const className = t.isIdentifier(parent.callee) ? parent.callee.name : '<anon>';
                this.holders.push({ type: 'ctor-arg', className, argIndex, via: name });
            }

            // return name
            if (t.isReturnStatement(parent) && parent.argument === ref.node) {
                this.holders.push({ type: 'returned', via: name });
            }
        }
    }

    addSeed(path, bindingNames, kind) {
        this.seeds.push({ kind, at: path.node.loc && path.node.loc.start, bindingName: bindingNames });
        bindingNames.forEach(n => this.recordBindingAndTrace(path, n));
    }

    addSeedMember(path, anchorPath, property, kind) {
        this.memberSeeds.push({
            anchor: anchorPath.node,
            className: this.displayNameForClassPath(anchorPath),
            property,
            isStatic: this.inStaticMehtod(path),
            at: path.node.loc && path.node.loc.start,
            kind
        });
        this.holders.push({
            type: 'class-field',
            className: this.displayNameForClassPath(anchorPath),
            property,
            via: kind,
            isStatic: this.inStaticMehtod(path)
        });
    }

    analyzeConfig(path) {
        // if (!this.isConfigJsonString(path.node)) return;
        const keyNode =
            path.findParent(p => p.isVariableDeclarator() || p.isAssignmentExpression() || p.isCallExpression() || p.isImportDeclaration())?.node
            || path.node;
        if (this.seen.has(keyNode)) return;
        this.seen.add(keyNode);

        const imp = path.findParent(p => p.isImportDeclaration());
        if (imp) {
            const names = imp.node.specifiers.map(s => s.local.name);
            if (imp.node.source?.value?.includes('settings.json') || (imp.node.assertions || []).some(a =>
                (a.key?.name === 'type' || a.key?.value === 'type') && a.value?.value === 'json')) {
                this.addSeed(imp, names, 'esm-import');
                return;
            }
        }

        const importCall = path.findParent(p => p.isCallExpression() && p.node.callee.type === 'Import');
        if (importCall) {
            const vd = importCall.findParent(p => p.isVariableDeclarator());
            if (vd && t.isIdentifier(vd.node.id)) this.addSeed(vd, [vd.node.id.name], 'dynamic-import');
            return;
        }

        const call = path.findParent(p => p.isCallExpression());
        if (call && t.isIdentifier(call.node.callee, { name: 'fetch' })) {
            const asg = call.findParent(p => p.isAssignmentExpression());
            if (asg) {
                const L = asg.node.left;
                if (t.isMemberExpression(L) && t.isThisExpression(L.object)) {
                    const clsPath = this.nearestClassPath(asg);
                    if (clsPath) {
                        this.addSeedMember(asg, clsPath, this.propName(L.property), "fetch('/settings.json')");
                        return;
                    }
                }
                if (t.isIdentifier(L)) {
                    this.addSeed(asg, [L.name], 'fetch(assign)');
                } else if (t.isMemberExpression(L)) {
                    if (t.isThisExpression(L.object)) {
                        this.holders.push({
                            type: 'class-field',
                            className: this.nearestClassName(asg) || '<unknown>',
                            property: this.propName(L.property),
                            via: 'fetch("/settings.json")',
                            isStatic: this.inStaticMehtod(asg)
                        });
                    } else if (t.isIdentifier(L.object)) {
                        this.holders.push({
                            type: 'object-prop',
                            object: L.object.name,
                            property: this.propName(L.property),
                            via: 'fetch("/settings.json")'
                        });
                    }
                }
                return;
            }

            const vd = call.findParent(p => p.isVariableDeclarator());
            if (vd && t.isIdentifier(vd.node.id)) this.addSeed(vd, [vd.node.id.name], 'fetch');
            return;
        }

        const openCall = path.findParent(p => p.isCallExpression() &&
            t.isMemberExpression(p.node.callee) && t.isIdentifier(p.node.callee.property, { name: 'open' }));
        if (openCall) this.addSeed(openCall, [], 'xhr-open');

        const newUrl = path.findParent(p => p.isNewExpression() && t.isIdentifier(p.node.callee, { name: 'URL' }));
        if (newUrl) {
            const vd = newUrl.findParent(p => p.isVariableDeclarator() && t.isIdentifier(p.node.id));
            if (vd) this.addSeed(vd, [vd.node.id.name], 'url-asset');
        }

        const vd = path.findParent(p => p.isVariableDeclarator() && t.isIdentifier(p.node.id));
        if (vd) this.addSeed(vd, [vd.node.id.name], 'literal-in-decl');
    }

    handleImportDeclaration(path) {
        const src = path.node.source?.value || '';
        const hasJsonAssertion = (path.node.assertions || []).some(a =>
            (a.key?.name === 'type' || a.key?.value === 'type') && a.value?.value === 'json');
        if (src.includes('settings.json') || hasJsonAssertion && src.endsWith('.json')) {
            const names = path.node.specifiers.map(s => s.local.name);
            if (names.length) this.addSeed(path, names, 'esm-import');
        }
    }

    handleStringAndTemplate(path) {
        const text = t.isStringLiteral(path.node) ? path.node.value : this.textOfTemplate(path.node);
        if (!text.includes('settings.json')) return;
        this.analyzeConfig(path);
    }

    handleBinaryExpression(path) {
        if (path.node.operator !== '+') return;

        const leftHasWhole = (t.isStringLiteral(path.node.left) && path.node.left.value.includes('settings.json')) ||
            (t.isTemplateLiteral(path.node.left) && this.textOfTemplate(path.node.left).includes('settings.json'));
        const rightHasWhole = (t.isStringLiteral(path.node.right) && path.node.right.value.includes('settings.json')) ||
            (t.isTemplateLiteral(path.node.right) && this.textOfTemplate(path.node.right).includes('settings.json'));
        if (leftHasWhole || rightHasWhole) return;

        if (this.isConfigJsonString(path.node)) {
            this.analyzeConfig(path);
        }
    }

    memberSeedsPassVariableDeclarator(path) {
        const { id, init } = path.node;
        if (!t.isIdentifier(id) || !t.isMemberExpression(init) || !t.isIdentifier(init.object)) return;

        const objRefPath = path.get('init.object'); // Path<Identifier>
        let bindingTest = null;
        let bp = null;
        if (init.property.name === 'config' && init.object.name === 'e' && id.name === 't') {
            bindingTest = objRefPath.scope.getBinding(objRefPath.node.name);
            bp = bindingTest.path;
            if (bp.isClassExpression()) {
                if (bp.node === this.memberSeeds[0].anchor) {
                }
            }
        }
        const anchor = this.classAnchorFromIdentifierRef(objRefPath);
        if (!anchor) return;

        for (const ms of this.memberSeeds) {
            if (anchor === ms.anchor && this.propName(init.property) === ms.property) {
                this.addSeed(path, [id.name], `${ms.className}.${ms.property} alias`);
            }
        }
    }

    memberSeedsPassAssignmentExpression(path) {
        const { left, right } = path.node;
        if (!t.isMemberExpression(right) || !t.isIdentifier(right.object) || !t.isIdentifier(left)) return;

        const objRefPath = path.get('right.object'); // Path<Identifier>
        const anchor = this.classAnchorFromIdentifierRef(objRefPath);
        if (!anchor) return;

        for (const ms of this.memberSeeds) {
            if (anchor === ms.anchor && this.propName(right.property) === ms.property) {
                this.addSeed(path, [left.name], `${ms.className}.${ms.property} assign`);
            }
        }
    }

    getSeeds() {
        return this.seeds;
    }

    getMemberSeeds() {
        return this.memberSeeds;
    }

    getHolders() {
        return this.holders;
    }
}