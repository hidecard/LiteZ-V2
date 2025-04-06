/**
 * @typedef {Object} VNode
 * @property {string} tag
 * @property {Object} props
 * @property {VNode[] | string[]} children
 * @property {string | number | null} key
 * @property {number} flags
 */

/**
 * @typedef {Object} ComponentInstance
 * @property {() => VNode} template
 * @property {any} state
 * @property {any} props
 * @property {Object} methods
 * @property {Object} computed
 * @property {Object} on
 * @property {HTMLElement | null} dom
 */

/**
 * @typedef {Object} ComponentDefinition
 * @property {string} name
 * @property {(props?: Object, slots?: Object) => ComponentInstance} createInstance
 */

/**
 * @typedef {Object} Signal
 * @property {any} value
 * @property {(callback: () => void) => () => void} subscribe
 * @property {(newVal: any) => Signal} update
 * @property {(num: number) => Signal} add
 * @property {(item: any) => Signal} push
 * @property {string[] | null} errors
 */

/**
 * @typedef {Object} App
 * @property {(selector: string) => void} mount
 * @property {(plugin: any, options?: Object) => App} use
 * @property {(name: string, handler: Function) => App} directive
 * @property {(handler: (e: Error) => void) => App} configErrorHandler
 */

const LiteZ = {
    components: {},
    routes: {},
    store: null,
    directives: {},
    events: new Map(),
    errorHandler: null,
    eventMap: new WeakMap(),
    plugins: new Set(),
    updateQueue: new Map(),
    updateScheduled: false,
    _di: new Map(),
    PATCH_FLAGS: {
      TEXT: 1 << 0,
      CLASS: 1 << 1,
      STYLE: 1 << 2,
      PROPS: 1 << 3,
      FULL_PROPS: 1 << 4,
      HYDRATE: 1 << 5,
    },
  
    // Evaluate expressions
    evaluate(expression, state) {
      try {
        const parts = expression.split('.');
        let value = state;
        for (const part of parts) {
          if (value === null || typeof value !== 'object') return undefined;
          value = value?.[part.trim()];
          if (value === undefined) return undefined;
        }
        return this.unref(value);
      } catch (e) {
        if (this.errorHandler) this.errorHandler(e);
        else console.warn(`Invalid expression: ${expression}`, e);
        return undefined;
      }
    },
  
    // Validation logic
    validate(value, rules) {
      const errors = [];
      try {
        for (const [rule, param] of Object.entries(rules)) {
          if (rule === 'required' && !value) errors.push('Required');
          if (rule === 'min' && value !== undefined) {
            const numParam = Number(param);
            if (typeof value === 'number' && value < numParam) errors.push(`Minimum value: ${numParam}`);
            else if ((typeof value === 'string' || Array.isArray(value)) && value.length < numParam) errors.push(`Min length: ${numParam}`);
          }
          if (rule === 'max' && value !== undefined) {
            const numParam = Number(param);
            if (typeof value === 'number' && value > numParam) errors.push(`Maximum value: ${numParam}`);
            else if ((typeof value === 'string' || Array.isArray(value)) && value.length > numParam) errors.push(`Max length: ${numParam}`);
          }
        }
        return errors.length ? errors : null;
      } catch (e) {
        if (this.errorHandler) this.errorHandler(e);
        else console.error('Validation error:', e);
        return null;
      }
    },
  
    // Signal for reactive state management
    signal(initial, options = {}) {
      let value = initial;
      const subscribers = new Set();
      const signal = new Proxy(
        {
          errors: options.validate ? LiteZ.validate(initial, options.validate) : null,
          subscribe: (fn) => {
            subscribers.add(fn);
            return () => subscribers.delete(fn);
          },
          update: (newVal) => {
            value = newVal;
            if (options.validate) signal.errors = LiteZ.validate(value, options.validate);
            subscribers.forEach(fn => fn(value));
            return signal;
          },
          add: (num) => (value += num, signal.update(value)),
          push: (item) => Array.isArray(value) && (value.push(item), signal.update(value)),
        },
        {
          get(target, prop) {
            if (prop in target) return target[prop];
            if (typeof prop === 'string' && !isNaN(prop)) return value[prop];
            return value;
          },
          set(target, prop, val) {
            if (prop === 'value') {
              target.update(val);
              return true;
            }
            if (Array.isArray(value) && !isNaN(prop)) {
              value[prop] = val;
              target.update(value);
              return true;
            }
            target.update(val);
            return true;
          },
        }
      );
      return signal;
    },
  
    // Ref implementation
    ref(initial) {
      const state = this.signal(initial);
      return {
        get value() { return state.value; },
        set value(newVal) { state.update(newVal); },
        watch: state.subscribe,
        onChange: state.subscribe,
      };
    },
  
    // Shallow ref
    shallowRef(initial) {
      const state = this.signal(initial);
      return {
        get value() { return state.value; },
        set value(newVal) { state.update(newVal); },
        watch: state.subscribe,
        onChange: state.subscribe,
      };
    },
  
    // Custom ref
    customRef(factory) {
      let value;
      const listeners = new Set();
      const { get, set } = factory(
        () => listeners.forEach(cb => cb(value)),
        (newVal) => { value = newVal; listeners.forEach(cb => cb(value)); }
      );
      return {
        get value() { return get(); },
        set value(newVal) { set(newVal); },
        watch: (callback) => {
          listeners.add(callback);
          return () => listeners.delete(callback);
        },
        onChange: (listener) => {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
      };
    },
  
    // Reactive state
    reactive(initial) {
      return this.state(initial);
    },
  
    // Convert reactive object to refs
    toRefs(reactiveObj) {
      const refs = {};
      for (const key in reactiveObj.get()) {
        refs[key] = {
          get value() { return reactiveObj.get()[key]; },
          set value(newVal) { reactiveObj.set(key, newVal); },
          watch: (callback) => reactiveObj.watch(key, callback),
          onChange: (listener) => reactiveObj.onChange(() => listener(reactiveObj.get()[key])),
        };
      }
      return refs;
    },
  
    // Mark object as raw (non-reactive)
    markRaw(obj) {
      Object.defineProperty(obj, '__litez_raw__', { value: true, writable: false });
      return obj;
    },
  
    // Check if value is a ref
    isRef(value) {
      return value && typeof value === 'object' && 'value' in value && (
        value.watch !== undefined || value.onChange !== undefined
      );
    },
  
    // Check if value is reactive
    isReactive(value) {
      return value && typeof value === 'object' && !this.isRef(value) && Object.getPrototypeOf(value) === Proxy.prototype;
    },
  
    // Unwrap ref or return value
    unref(value) {
      return this.isRef(value) ? value.value : value;
    },
  
    // Trigger ref update
    triggerRef(ref) {
      if (ref && 'value' in ref) {
        const current = ref.value;
        ref.value = current;
      }
    },
  
    // Watch source changes
    watch(source, callback) {
      if (typeof source === 'function') {
        const state = this.signal(source());
        const unwatch = state.subscribe(callback);
        state.subscribe(() => state.update(source()));
        return unwatch;
      } else if (source.subscribe) {
        return source.subscribe(callback);
      }
    },
  
    // State management with deep reactivity
    state(initial = {}) {
      const listeners = new Set();
      const watchers = new Map();
      const seen = new WeakMap();
  
      const deepProxy = (obj) => {
        if (obj === null || typeof obj !== 'object' || obj.__litez_raw__ || !Object.isExtensible(obj)) return obj;
        if (seen.has(obj)) return seen.get(obj);
  
        const proxy = new Proxy(obj, {
          set(target, key, value) {
            const oldValue = target[key];
            target[key] = deepProxy(value);
            listeners.forEach(cb => cb(proxy));
            watchers.forEach((cb, watchedKey) => {
              if (watchedKey === key || watchedKey === '*') cb(value, oldValue);
            });
            return true;
          },
          get(target, key) {
            return deepProxy(target[key]);
          },
        });
        seen.set(obj, proxy);
        return proxy;
      };
  
      const proxy = deepProxy(initial);
      return {
        get: () => proxy,
        set: (key, value) => {
          if (typeof key === 'object') Object.assign(proxy, deepProxy(key));
          else proxy[key] = deepProxy(value);
        },
        onChange: (listener) => {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
        watch: (key, callback) => {
          watchers.set(key, callback);
          return () => watchers.delete(key);
        },
      };
    },
  
    // Computed properties
    computed(fn) {
      const state = this.signal(null);
      const dependencies = new Set();
      let isDirty = true;
  
      const tracker = new Proxy({}, {
        get(_, key) {
          dependencies.add(key);
          return LiteZ.evaluate(key, state);
        },
        set(_, key, value) {
          state.update(key, value);
          return true;
        },
      });
  
      const compute = () => {
        if (!isDirty) return state.value;
        const newValue = fn.call(null, tracker);
        state.update(newValue);
        isDirty = false;
        return newValue;
      };
  
      return {
        get value() { return compute(); },
        onChange: (listener) => state.subscribe(() => listener(compute())),
      };
    },
  
    // VNode creation
    h(tag, props = {}, children = [], key = null) {
      try {
        if (!tag || typeof tag !== 'string') throw new Error('Tag must be a non-empty string');
        children = Array.isArray(children) ? children : [children];
        return { tag, props, children, key, flags: 0 };
      } catch (e) {
        if (this.errorHandler) this.errorHandler(e);
        else console.error('VNode creation error:', e);
        return { tag: 'div', props: {}, children: [], key: null, flags: 0 };
      }
    },
  
    // Parse Single File Component (SFC)
    parseSFC(sfcString) {
      const templateMatch = sfcString.match(/<template>([\s\S]*?)<\/template>/);
      const scriptMatch = sfcString.match(/<script>([\s\S]*?)<\/script>/);
      const styleMatch = sfcString.match(/<style(?:\s+scoped)?>([\s\S]*?)<\/style>/);
  
      const template = templateMatch ? templateMatch[1].trim() : '';
      let script = {};
      if (scriptMatch) {
        try {
          const scriptContent = scriptMatch[1].trim();
          if (scriptContent) script = new Function(`return ${scriptContent}`)();
        } catch (e) {
          if (this.errorHandler) this.errorHandler(e);
          else console.error('SFC script parsing error:', e);
        }
      }
      const styles = styleMatch ? styleMatch[1].trim() : '';
      const isScoped = sfcString.includes('scoped');
  
      return { template, ...script, styles, scoped: isScoped };
    },
  
    // Template compiler
    compileTemplate(templateString, context) {
      try {
        const parser = new DOMParser();
        const doc = parser.parseFromString(`<template>${templateString}</template>`, 'text/html');
        const root = doc.querySelector('template')?.content;
        if (!root) throw new Error('Invalid template: no content found');
  
        const staticNodes = new Map();
  
        const parseNode = (node, scopeId, parentDirectives = {}) => {
          if (node.nodeType === Node.TEXT_NODE) {
            const text = node.textContent.trim();
            if (!text) return null;
            if (parentDirectives['z-pre']) return { type: 'staticText', value: text };
  
            const exprMatch = text.match(/{{(.+?)}}|\${(.+?)}/g);
            if (exprMatch) {
              return {
                type: 'dynamicText',
                value: () => {
                  let result = text;
                  exprMatch.forEach(match => {
                    const expr = match.startsWith('{{') ? match.slice(2, -2).trim() : match.slice(1).trim();
                    result = result.replace(match, this.evaluate(expr, context.state.get()) || '');
                  });
                  return result;
                },
                flags: this.PATCH_FLAGS.TEXT,
              };
            }
            if (!staticNodes.has(text)) staticNodes.set(text, text);
            return { type: 'staticText', value: text };
          }
  
          if (node.nodeType === Node.ELEMENT_NODE) {
            const props = { 'data-litez-scope': scopeId };
            const attrs = Array.from(node.attributes);
            const directives = {};
            let flags = 0;
  
            attrs.forEach(attr => {
              if (attr.name.startsWith('z-bind:') || attr.name.startsWith(':')) {
                const key = attr.name.startsWith('z-bind:') ? attr.name.slice(7) : attr.name.slice(1);
                props[key] = () => this.evaluate(attr.value, context.state.get());
                flags |= key === 'class' ? this.PATCH_FLAGS.CLASS : this.PATCH_FLAGS.PROPS;
              } else if (attr.name.startsWith('bind:')) {
                const key = attr.name.slice(5);
                props[key] = () => this.evaluate(attr.value, context.state.get());
                flags |= key === 'class' ? this.PATCH_FLAGS.CLASS : this.PATCH_FLAGS.PROPS;
              } else if (attr.name.startsWith('@') || attr.name.startsWith('z-on:')) {
                const event = attr.name.startsWith('@') ? attr.name.slice(1) : attr.name.slice(5);
                props[`@${event}`] = context.methods[attr.value] || (() => {});
              } else if (attr.name === 'z-if' || attr.name === 'show-when') {
                directives['z-if'] = () => this.evaluate(attr.value, context.state.get());
              } else if (attr.name === 'z-for' || attr.name === 'repeat') {
                const [item, list] = attr.value.split(attr.name === 'z-for' ? ' in ' : ' from ').map(s => s.trim());
                directives['z-for'] = { item, list };
              } else if (attr.name === 'z-model') {
                directives['z-model'] = attr.value;
                flags |= this.PATCH_FLAGS.FULL_PROPS;
              } else if (attr.name === 'z-show') {
                directives['z-show'] = () => this.evaluate(attr.value, context.state.get());
              } else if (attr.name === 'z-html' || attr.name === 'set-html') {
                directives['z-html'] = () => this.evaluate(attr.value, context.state.get());
                flags |= this.PATCH_FLAGS.TEXT;
              } else if (attr.name === 'set-text') {
                directives['set-text'] = () => this.evaluate(attr.value, context.state.get());
                flags |= this.PATCH_FLAGS.TEXT;
              } else if (attr.name === 'z-once') {
                directives['z-once'] = true;
              } else if (attr.name === 'z-pre') {
                directives['z-pre'] = true;
              } else {
                props[attr.name] = attr.value;
              }
            });
  
            const children = Array.from(node.childNodes).map(child => parseNode(child, scopeId, directives)).filter(Boolean);
  
            if (directives['z-if']) {
              return { type: 'if', condition: directives['z-if'], children, flags };
            }
            if (directives['z-for']) {
              return { type: 'for', item: directives['z-for'].item, list: directives['z-for'].list, children, flags };
            }
            if (directives['z-once']) {
              const staticVNode = this.h(node.tagName.toLowerCase(), props, children.map(child => buildVNode(child)));
              staticNodes.set(`${scopeId}-${node.tagName}-${children.length}`, staticVNode);
              return { type: 'once', key: `${scopeId}-${node.tagName}-${children.length}`, flags: 0 };
            }
  
            const vnode = this.h(node.tagName.toLowerCase(), props, children);
            if (directives['z-show']) props['data-z-show'] = directives['z-show'];
            if (directives['z-model']) props['data-z-model'] = directives['z-model'];
            if (directives['z-html']) return { type: 'html', value: directives['z-html'], flags: this.PATCH_FLAGS.TEXT };
            if (directives['set-text']) return { type: 'dynamicText', value: directives['set-text'], flags: this.PATCH_FLAGS.TEXT };
            vnode.flags = flags;
            return vnode;
          }
          return null;
        };
  
        const buildVNode = (node) => {
          if (!node) return null;
          if (node.type === 'staticText') return staticNodes.get(node.value) || node.value;
          if (node.type === 'dynamicText') return node.value();
          if (node.type === 'if') return node.condition() ? node.children.map(buildVNode).flat() : [];
          if (node.type === 'for') {
            const list = this.evaluate(node.list, context.state.get()) || [];
            return list.map((item, i) => {
              const childContext = { ...context, state: this.state({ ...context.state.get(), [node.item]: item, index: i }) };
              return node.children.map(child => buildVNode({ ...child, context: childContext }));
            }).flat();
          }
          if (node.type === 'once') return staticNodes.get(node.key);
          if (node.type === 'html') return { type: 'html', value: node.value(), flags: node.flags };
  
          const props = Object.fromEntries(
            Object.entries(node.props).map(([k, v]) => [k, typeof v === 'function' ? v() : v])
          );
          const children = node.children.map(buildVNode).flat();
          const vnode = this.h(node.tag, props, children);
          vnode.flags = node.flags;
          return vnode;
        };
  
        const scopeId = `litez-${Math.random().toString(36).slice(2)}`;
        const rootNode = parseNode(root.firstChild, scopeId);
        return {
          render: () => buildVNode(rootNode) || this.h('div', {}, ''),
          scopeId,
        };
      } catch (e) {
        if (this.errorHandler) this.errorHandler(e);
        else console.error('Template compilation error:', e);
        return { render: () => this.h('div', {}, 'Error compiling template'), scopeId: '' };
      }
    },
  
    // Component definition
    component(name, { template, data = () => ({}), methods = {}, computed = {}, on = {}, props = {}, slots = {}, styles, scoped = false } = {}) {
      if (!name || typeof name !== 'string') throw new Error('Component name must be a non-empty string');
      if (!template) throw new Error(`Component "${name}" must have a template`);
  
      const styleId = `litez-${name}-${Math.random().toString(36).slice(2)}`;
  
      const componentDef = {
        name,
        createInstance: (inputProps = {}, slotContent = {}) => {
          on.beforeCreate?.();
          const state = this.reactive(data());
          const propsState = this.reactive(inputProps);
          const computedState = {};
          const boundMethods = {
            emit: this.emit.bind(this),
            on: this.on.bind(this),
          };
  
          for (const [key, fn] of Object.entries(methods)) {
            boundMethods[key] = fn.bind({ state, props: propsState, methods: boundMethods });
          }
  
          for (const [key, fn] of Object.entries(computed)) {
            computedState[key] = this.computed(fn);
          }
  
          const instanceSlots = {};
          for (const [slotName, fn] of Object.entries(slots)) {
            instanceSlots[slotName] = slotContent[slotName] || fn || (() => this.h('span', {}, ''));
          }
  
          const applyStyles = () => {
            if (styles && typeof document !== 'undefined') {
              const styleEl = document.createElement('style');
              styleEl.setAttribute('data-litez-style', styleId);
              styleEl.textContent = scoped ? `[data-litez-scope="${styleId}"] ${styles}` : styles;
              document.head.appendChild(styleEl);
            }
          };
  
          const context = { state, props: propsState, methods: boundMethods, computed: computedState, slots: instanceSlots };
          const { render, scopeId } = this.compileTemplate(template, context);
  
          const instance = {
            template: () => {
              const vnode = render();
              vnode.props = { ...vnode.props, 'data-litez-component': styleId };
              return vnode;
            },
            state,
            props: propsState,
            methods: boundMethods,
            computed: computedState,
            on,
            dom: null,
          };
  
          applyStyles();
          on.created?.(state.get(), propsState.get());
          if (this.devtools.enabled) this.devtools.inspect(instance);
          return instance;
        },
      };
  
      this.components[name] = componentDef;
  
      customElements.define(`litez-${name.toLowerCase()}`, class extends HTMLElement {
        constructor() {
          super();
          this.instance = componentDef.createInstance();
          this.shadow = this.attachShadow({ mode: 'open' });
        }
        connectedCallback() {
          const node = this.instance.template();
          this.instance.dom = this.render(node, this.shadow);
          this.instance.on.mount?.(this.instance.state.get(), this.instance.props.get());
        }
      });
    },
  
    // DOM rendering
    render(node, container, nonce = null) {
      if (typeof document === 'undefined') return null;
      try {
        if (typeof node === 'string') {
          const textNode = document.createTextNode(node);
          container.appendChild(textNode);
          return textNode;
        }
        if (node.type === 'html') {
          const el = document.createElement('div');
          el.innerHTML = node.value || '';
          container.appendChild(el);
          return el;
        }
        if (Array.isArray(node)) {
          return node.map(child => this.render(child, container)).filter(Boolean);
        }
  
        const el = document.createElement(node.tag);
        el._key = node.key;
        for (const [key, value] of Object.entries(node.props || {})) {
          if (key.startsWith('@')) {
            el.addEventListener(key.slice(1), value);
          } else if (key === 'style' && nonce) {
            el.setAttribute('style', value);
            el.setAttribute('nonce', nonce);
          } else {
            el.setAttribute(key, value);
          }
        }
        node.children.forEach(child => this.render(child, el));
        container.appendChild(el);
        return el;
      } catch (e) {
        if (this.errorHandler) this.errorHandler(e);
        else console.error('Render error:', e);
        return null;
      }
    },
  
    // DOM updating
    update(container, newNode, oldNode) {
      if (typeof document === 'undefined') return;
      try {
        if (typeof newNode === 'string' && typeof oldNode === 'string') {
          if (newNode !== oldNode) container.firstChild.textContent = newNode;
          return;
        }
  
        if (Array.isArray(newNode)) {
          newNode.forEach((child, i) => {
            const oldChild = oldNode[i];
            if (oldChild) this.update(container.childNodes[i].parentNode, child, oldChild);
            else this.render(child, container);
          });
          while (container.childNodes.length > newNode.length) {
            container.removeChild(container.lastChild);
          }
          return;
        }
  
        if (!newNode?.tag || newNode.tag !== oldNode.tag) {
          const newEl = this.render(newNode, document.createElement('div'));
          container.replaceChild(newEl, container.firstChild);
          return;
        }
  
        const el = container.firstChild;
        const newProps = newNode.props || {};
        const oldProps = oldNode.props || {};
  
        for (const key in oldProps) {
          if (!(key in newProps) && !key.startsWith('@')) el.removeAttribute(key);
        }
        for (const [key, value] of Object.entries(newProps)) {
          if (key.startsWith('@')) {
            el.removeEventListener(key.slice(1), oldProps[key]);
            el.addEventListener(key.slice(1), value);
          } else if (oldProps[key] !== value) {
            el.setAttribute(key, value);
          }
        }
  
        const newChildren = newNode.children || [];
        const oldChildren = oldNode.children || [];
        newChildren.forEach((child, i) => {
          const oldChild = oldChildren[i];
          if (oldChild) this.update(el.childNodes[i].parentNode, child, oldChild);
          else this.render(child, el);
        });
        while (el.childNodes.length > newChildren.length) {
          el.removeChild(el.lastChild);
        }
      } catch (e) {
        if (this.errorHandler) this.errorHandler(e);
        else console.error('Update error:', e);
      }
    },
  
    // Render to string for SSR
    renderToString(node) {
      try {
        if (!node) return '';
        if (typeof node === 'string') return node;
        const propsStr = Object.entries(node.props || {})
          .map(([key, value]) => (key.startsWith('@') ? '' : `${key}="${String(value)}"`))
          .join(' ');
        const childrenStr = node.children.map(child => this.renderToString(child)).join('');
        return `<${node.tag}${propsStr ? ' ' + propsStr : ''}>${childrenStr}</${node.tag}>`;
      } catch (e) {
        if (this.errorHandler) this.errorHandler(e);
        else console.error('renderToString error:', e);
        return '<div>Error rendering to string</div>';
      }
    },
  
    // Hydration for SSR
    hydrate(node, container) {
      if (typeof document === 'undefined') throw new Error('hydrate is only available in browser');
      try {
        const comp = this.components[node.tag]?.createInstance();
        if (comp) {
          comp.dom = container.querySelector(node.tag) || container;
          comp.on.mount?.(comp.state.get(), comp.props.get());
          this.applyDirectives(container, comp.state);
          container._component = comp;
        }
      } catch (e) {
        if (this.errorHandler) this.errorHandler(e);
        else console.error('Hydrate error:', e);
      }
    },
  
    // Static site generation
    generateStatic(routes, outputDir) {
      if (typeof require === 'undefined') throw new Error('SSG requires Node.js environment');
      try {
        const fs = require('fs');
        const path = require('path');
        for (const [route, config] of Object.entries(routes)) {
          const comp = this.components[config.component].createInstance(config.props || {});
          const html = this.renderToString(comp.template());
          const fullPath = path.join(outputDir, `${route === '/' ? 'index' : route}.html`);
          fs.mkdirSync(path.dirname(fullPath), { recursive: true });
          fs.writeFileSync(fullPath, `<!DOCTYPE html><html><body>${html}</body></html>`);
        }
      } catch (e) {
        if (this.errorHandler) this.errorHandler(e);
        else console.error('Static generation error:', e);
      }
    },
  
    // Router
    router(routes, target = '#app', middlewares = []) {
      if (typeof document === 'undefined') return { go: () => {}, link: () => this.h('a', {}) };
      this.routes = routes;
      const container = document.querySelector(target);
  
      const normalizePath = path => '/' + path.split('/').filter(Boolean).join('/');
      const parseRoute = path => {
        const paramPattern = /:([^\/]+)/g;
        const regex = new RegExp('^' + path.replace(paramPattern, '([^/]+)') + '$');
        return { regex, params: (path.match(paramPattern) || []).map(p => p.slice(1)) };
      };
      const matchRoute = (pathname, routesObj = routes) => {
        for (const [routePath, config] of Object.entries(routesObj)) {
          const { regex, params } = parseRoute(routePath);
          const match = pathname.match(regex);
          if (match) {
            const paramValues = match.slice(1);
            const routeParams = {};
            params.forEach((param, i) => (routeParams[param] = paramValues[i]));
            return { config, params: routeParams };
          }
        }
        return null;
      };
  
      const showRoute = () => {
        const path = normalizePath(window.location.pathname);
        const matchedRoute = matchRoute(path);
        const route = matchedRoute ? matchedRoute.config : this.routes['/'];
        const comp = this.components[route.component].createInstance({ ...route.props, params: matchedRoute?.params || {} });
  
        for (const middleware of middlewares) {
          if (!middleware(path, route, comp.state.get())) return;
        }
  
        const node = comp.template();
        if (!comp.dom) comp.dom = this.render(node, container);
        else this.update(container, node, comp.dom);
        container._component = comp;
        this.applyDirectives(container, comp.state);
      };
  
      window.addEventListener('popstate', showRoute);
      showRoute();
  
      return {
        go: path => {
          window.history.pushState({}, '', path);
          showRoute();
        },
        link: (path, text) => this.h('a', { href: path, '@click': e => { e.preventDefault(); this.router().go(path); } }, text),
      };
    },
  
    // Store
    store({ state = {}, mutations = {}, actions = {}, getters = {}, modules = {} }) {
      const data = this.reactive(state);
      const computedGetters = {};
      for (const [key, fn] of Object.entries(getters)) {
        computedGetters[key] = this.computed(fn);
      }
  
      const moduleStores = {};
      for (const [moduleName, module] of Object.entries(modules)) {
        moduleStores[moduleName] = this.store(module);
      }
  
      this.store = {
        state: data,
        getters: computedGetters,
        modules: moduleStores,
        commit: (type, payload) => mutations[type]?.(data.get(), payload),
        dispatch: (type, payload) => actions[type]?.({ state: data, commit: this.store.commit }, payload),
      };
      return this.store;
    },
  
    // Lazy loading
    lazy(name, loader) {
      this.components[name] = {
        createInstance: () => {
          const instance = { template: () => this.h('div', {}, 'Loading...'), state: this.state({ loading: true }), props: this.state({}) };
          loader().then(def => {
            this.component(name, def);
            instance.state.set('loading', false);
          });
          return instance;
        },
      };
    },
  
    // Directives
    directive(name, handler) {
      this.directives[name] = handler;
      return this;
    },
  
    applyDirectives(container, state) {
      if (typeof document === 'undefined') return;
      Object.entries(this.directives).forEach(([name, fn]) => {
        container.querySelectorAll(`[data-${name}]`).forEach(el => fn(el, el.dataset[name], state));
      });
    },
  
    // Event handling
    emit(event, data) {
      const listeners = this.events.get(event) || [];
      listeners.forEach(cb => cb(data));
    },
  
    on(event, callback) {
      if (!this.events.has(event)) this.events.set(event, []);
      this.events.get(event).push(callback);
      return () => this.off(event, callback);
    },
  
    off(event, callback) {
      const listeners = this.events.get(event);
      if (listeners) this.events.set(event, listeners.filter(cb => cb !== callback));
    },
  
    // Plugins
    install(plugin, options = {}) {
      if (!this.plugins.has(plugin)) {
        this.plugins.add(plugin);
        plugin.install?.(this, options) || plugin(this, options);
      }
      return this;
    },
  
    // Error handling
    setErrorHandler(handler) {
      this.errorHandler = handler;
      return this;
    },
  
    // Dependency Injection
    provide(key, value) {
      this._di.set(key, value);
    },
  
    inject(key) {
      return this._di.get(key);
    },
  
    // Create App
    createApp(rootComponent) {
      const app = {
        mount(selector) {
          if (typeof document === 'undefined') return;
          const container = document.querySelector(selector);
          if (!container) throw new Error(`No element found for selector: ${selector}`);
          
          const compName = rootComponent.name || 'App';
          if (!LiteZ.components[compName]) {
            LiteZ.component(compName, rootComponent);
          }
          
          const instance = LiteZ.components[compName].createInstance();
          container.innerHTML = '';
          const node = instance.template();
          instance.dom = LiteZ.render(node, container);
          instance.on.mount?.(instance.state.get(), instance.props.get());
          container._component = instance;
          LiteZ.applyDirectives(container, instance.state);
        },
        use(plugin, options) {
          LiteZ.install(plugin, options);
          return app;
        },
        directive(name, handler) {
          LiteZ.directive(name, handler);
          return app;
        },
        configErrorHandler(handler) {
          LiteZ.setErrorHandler(handler);
          return app;
        },
      };
      return app;
    },
  
    // Devtools
    devtools: {
      enabled: typeof window !== 'undefined',
      init() {
        if (this.enabled && !window.__LITEZ_DEVTOOLS__) {
          window.__LITEZ_DEVTOOLS__ = {
            components: new Map(),
            events: [],
            inspect: instance => {
              window.__LITEZ_DEVTOOLS__.components.set(instance.name, instance);
            },
          };
        }
      },
    },
  };
  
  // Register directives
  LiteZ.directive('z-model', (el, value, state) => {
    el.value = LiteZ.evaluate(value, state.get()) || '';
    el.addEventListener('input', () => state.set(value, el.value));
    state.onChange(() => el.value = LiteZ.evaluate(value, state.get()) || '');
  });
  
  LiteZ.directive('z-show', (el, value, state) => {
    el.style.display = LiteZ.evaluate(value, state.get()) ? '' : 'none';
    state.onChange(() => el.style.display = LiteZ.evaluate(value, state.get()) ? '' : 'none');
  });
  
  // Initialize devtools
  if (typeof window !== 'undefined') {
    LiteZ.devtools.init();
    window.LiteZ = LiteZ;
  }
  
  export default LiteZ;