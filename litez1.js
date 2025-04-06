// Type Definitions for JSDoc
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
  
    evaluate(expression, state) {
      try {
        const parts = expression.split(".");
        let value = state;
        for (const part of parts) {
          if (value === null || typeof value !== "object") return undefined;
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
  
    validate(value, rules) {
      const errors = [];
      try {
        for (const [rule, param] of Object.entries(rules)) {
          if (rule === "required" && !value) errors.push("Required");
          if (rule === "min" && value !== undefined) {
            const numParam = Number(param);
            if (typeof value === "number" && value < numParam) errors.push(`Minimum value: ${numParam}`);
            else if ((typeof value === "string" || Array.isArray(value)) && value.length < numParam) errors.push(`Min length: ${numParam}`);
          }
          if (rule === "max" && value !== undefined) {
            const numParam = Number(param);
            if (typeof value === "number" && value > numParam) errors.push(`Maximum value: ${numParam}`);
            else if ((typeof value === "string" || Array.isArray(value)) && value.length > numParam) errors.push(`Max length: ${numParam}`);
          }
        }
        return errors.length ? errors : null;
      } catch (e) {
        if (this.errorHandler) this.errorHandler(e);
        else console.error("Validation error:", e);
        return null;
      }
    },
  
    i18n: {
      locale: "en",
      messages: {},
      t(key) {
        try {
          return this.messages[this.locale]?.[key] || key;
        } catch (e) {
          if (LiteZ.errorHandler) LiteZ.errorHandler(e);
          else console.warn("i18n error:", e);
          return key;
        }
      },
      setLocale(locale, messages) {
        try {
          this.locale = locale;
          this.messages[locale] = messages;
        } catch (e) {
          if (LiteZ.errorHandler) LiteZ.errorHandler(e);
          else console.error("setLocale error:", e);
        }
      },
    },
  
    ref(initial) {
      const state = this.state({ value: initial });
      return {
        get value() {
          return state.get().value;
        },
        set value(newVal) {
          state.set("value", newVal);
        },
        watch: (callback) => state.watch("value", callback),
        onChange: (listener) => state.onChange(() => listener(state.get().value)),
      };
    },
  
    shallowRef(initial) {
      const state = this.state({ value: initial });
      return {
        get value() {
          return state.get().value;
        },
        set value(newVal) {
          state.set("value", newVal);
        },
        watch: (callback) => state.watch("value", callback),
        onChange: (listener) => state.onChange(() => listener(state.get().value)),
      };
    },
  
    customRef(factory) {
      let value;
      const listeners = new Set();
      const { get, set } = factory(
        () => listeners.forEach((cb) => cb(value)),
        (newVal) => {
          value = newVal;
          listeners.forEach((cb) => cb(value));
        }
      );
  
      return {
        get value() {
          return get();
        },
        set value(newVal) {
          set(newVal);
        },
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
  
    reactive(initial) {
      return this.state(initial);
    },
  
    toRefs(reactiveObj) {
      const refs = {};
      for (const key in reactiveObj.get()) {
        refs[key] = {
          get value() {
            return reactiveObj.get()[key];
          },
          set value(newVal) {
            reactiveObj.set(key, newVal);
          },
          watch: (callback) => reactiveObj.watch(key, callback),
          onChange: (listener) => reactiveObj.onChange(() => listener(reactiveObj.get()[key])),
        };
      }
      return refs;
    },
  
    markRaw(obj) {
      Object.defineProperty(obj, "__litez_raw__", { value: true, writable: false });
      return obj;
    },
  
    isRef(value) {
      return (
        value &&
        typeof value === "object" &&
        "value" in value &&
        (value.watch !== undefined || value.onChange !== undefined)
      );
    },
  
    isReactive(value) {
      return value && typeof value === "object" && !this.isRef(value) && Object.getPrototypeOf(value) === Proxy.prototype;
    },
  
    unref(value) {
      return this.isRef(value) ? value.value : value;
    },
  
    triggerRef(ref) {
      if (ref && "value" in ref) {
        const current = ref.value;
        ref.value = current;
      }
    },
  
    watch(source, callback) {
      if (typeof source === "function") {
        const state = this.state({ value: source() });
        const unwatch = state.watch("value", callback);
        state.onChange(() => state.set("value", source()));
        return unwatch;
      } else if (source.get && source.watch) {
        return source.watch("*", callback);
      }
    },
  
    state(initial = {}) {
      const listeners = new Set();
      const watchers = new Map();
      const seen = new WeakMap();
  
      const deepProxy = (obj) => {
        if (obj === null || typeof obj !== "object" || obj.__litez_raw__ || !Object.isExtensible(obj)) return obj;
        if (seen.has(obj)) return seen.get(obj);
  
        try {
          const proxy = new Proxy(obj, {
            set(target, key, value) {
              const oldValue = target[key];
              target[key] = deepProxy(value);
              listeners.forEach((cb) => cb(proxy));
              watchers.forEach((cb, watchedKey) => {
                if (watchedKey === key || watchedKey === "*") cb(value, oldValue);
              });
              return true;
            },
            get(target, key) {
              return deepProxy(target[key]);
            },
          });
          seen.set(obj, proxy);
          return proxy;
        } catch (e) {
          if (this.errorHandler) this.errorHandler(e);
          else console.warn("Failed to create reactive proxy:", e);
          return obj;
        }
      };
  
      const proxy = deepProxy(initial);
      return {
        get: () => proxy,
        set: (key, value) => {
          try {
            if (typeof key === "object") Object.assign(proxy, deepProxy(key));
            else proxy[key] = deepProxy(value);
          } catch (e) {
            if (this.errorHandler) this.errorHandler(e);
            else console.error("State set error:", e);
          }
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
  
    computed(fn) {
      const state = this.state({ value: null });
      const dependencies = new Set();
      let isDirty = true;
  
      const tracker = new Proxy(
        {},
        {
          get(_, key) {
            dependencies.add(key);
            return LiteZ.evaluate(key, state.get());
          },
          set(_, key, value) {
            state.set(key, value);
            return true;
          },
        }
      );
  
      const compute = () => {
        if (!isDirty) return state.get().value;
        const newValue = fn.call(null, tracker);
        state.set("value", newValue);
        isDirty = false;
        return newValue;
      };
  
      return {
        get value() {
          return compute();
        },
        onChange: (listener) => {
          const unwatch = state.onChange(() => {
            isDirty = true;
            listener(compute());
          });
          return unwatch;
        },
      };
    },
  
    h(tag, props = {}, children = [], key = null) {
      try {
        if (!tag || typeof tag !== "string") {
          throw new Error("Tag must be a non-empty string");
        }
        children = Array.isArray(children) ? children : [children];
        return { tag, props, children, key, flags: 0 };
      } catch (e) {
        if (this.errorHandler) this.errorHandler(e);
        else console.error("VNode creation error:", e);
        return { tag: "div", props: {}, children: [], key: null, flags: 0 };
      }
    },
  
    parseSFC(sfcString) {
      const templateMatch = sfcString.match(/<template>([\s\S]*?)<\/template>/);
      const scriptMatch = sfcString.match(/<script>([\s\S]*?)<\/script>/);
      const styleMatch = sfcString.match(/<style(?:\s+scoped)?>([\s\S]*?)<\/style>/);
  
      const template = templateMatch ? templateMatch[1].trim() : "";
      let script = {};
      if (scriptMatch) {
        try {
          const scriptContent = scriptMatch[1].trim();
          if (!scriptContent) return {};
          script = new Function(`return ${scriptContent}`)();
        } catch (e) {
          const err = new Error(`SFC script parsing failed: ${e.message}`);
          if (LiteZ.errorHandler) LiteZ.errorHandler(err);
          else console.error("SFC script parsing error:", err);
        }
      }
      const styles = styleMatch ? styleMatch[1].trim() : "";
      const isScoped = sfcString.includes("scoped");
  
      return { template, ...script, styles, scoped: isScoped };
    },
  
    compileTemplate(templateString, context) {
      try {
        const parser = new DOMParser();
        const doc = parser.parseFromString(`<template>${templateString}</template>`, "text/html");
        const root = doc.querySelector("template")?.content;
        if (!root) throw new Error("Invalid template: no content found");
  
        const staticNodes = new Map();
  
        const unwrap = (val) => this.unref(val);
  
        const parseNode = (node, scopeId, parentDirectives = {}) => {
          if (node.nodeType === Node.TEXT_NODE) {
            const text = node.textContent.trim();
            if (!text) return null;
            if (parentDirectives["z-pre"]) return { type: "staticText", value: text };
            if (text.match(/^{{(.+?)}}$/)) {
              const expr = text.slice(2, -2).trim();
              return { type: "dynamicText", value: () => unwrap(this.evaluate(expr, context.state.get())), flags: this.PATCH_FLAGS.TEXT };
            }
            const dollarMatches = text.match(/\$([a-zA-Z_][a-zA-Z0-9_]*)/g);
            if (dollarMatches) {
              let dynamicText = text;
              dollarMatches.forEach((match) => {
                const expr = match.slice(1).trim();
                dynamicText = dynamicText.replace(match, unwrap(this.evaluate(expr, context.state.get())) || "");
              });
              return {
                type: "dynamicText",
                value: () => {
                  let result = text;
                  dollarMatches.forEach((match) => {
                    const expr = match.slice(1).trim();
                    result = result.replace(match, unwrap(this.evaluate(expr, context.state.get())) || "");
                  });
                  return result;
                },
                flags: this.PATCH_FLAGS.TEXT,
              };
            }
            if (!staticNodes.has(text)) staticNodes.set(text, text);
            return { type: "staticText", value: text };
          }
  
          if (node.nodeType === Node.ELEMENT_NODE) {
            if (parentDirectives["z-pre"]) {
              const props = {};
              const attrs = node.attributes ? Array.from(node.attributes) : [];
              attrs.forEach((attr) => (props[attr.name] = attr.value));
              return this.h(node.tagName.toLowerCase(), props, Array.from(node.childNodes).map((child) => parseNode(child, scopeId, parentDirectives)).filter(Boolean));
            }
  
            const props = { "data-litez-scope": scopeId };
            const attrs = node.attributes ? Array.from(node.attributes) : [];
            const directives = {};
            let flags = 0;
  
            attrs.forEach((attr) => {
              if (attr.name.startsWith("z-bind:") || attr.name.startsWith(":")) {
                const key = attr.name.startsWith("z-bind:") ? attr.name.slice(7) : attr.name.slice(1);
                props[key] = () => unwrap(this.evaluate(attr.value, context.state.get()));
                flags |= key === "class" ? this.PATCH_FLAGS.CLASS : this.PATCH_FLAGS.PROPS;
              } else if (attr.name.startsWith("bind:")) {
                const key = attr.name.slice(5);
                if (key === "class") {
                  props["class"] = () => {
                    const classVal = unwrap(this.evaluate(attr.value, context.state.get()));
                    return typeof classVal === "string"
                      ? classVal
                      : Array.isArray(classVal)
                      ? classVal.join(" ")
                      : typeof classVal === "object"
                      ? Object.entries(classVal)
                          .filter(([, v]) => v)
                          .map(([k]) => k)
                          .join(" ")
                      : "";
                  };
                  flags |= this.PATCH_FLAGS.CLASS;
                } else {
                  props[key] = () => unwrap(this.evaluate(attr.value, context.state.get()));
                  flags |= this.PATCH_FLAGS.PROPS;
                }
              } else if (attr.name === ":class") {
                props["class"] = () => {
                  const classObj = unwrap(this.evaluate(attr.value, context.state.get()));
                  return classObj ? Object.entries(classObj).filter(([, v]) => v).map(([k]) => k).join(" ") : "";
                };
                flags |= this.PATCH_FLAGS.CLASS;
              } else if (attr.name === "bind-class") {
                props["class"] = () => {
                  const classVal = unwrap(this.evaluate(attr.value, context.state.get()));
                  return typeof classVal === "string"
                    ? classVal
                    : Array.isArray(classVal)
                    ? classVal.join(" ")
                    : typeof classVal === "object"
                    ? Object.entries(classVal)
                        .filter(([, v]) => v)
                        .map(([k]) => k)
                        .join(" ")
                    : "";
                };
                flags |= this.PATCH_FLAGS.CLASS;
              } else if (attr.name.startsWith("z-on:") || attr.name.startsWith("@")) {
                const [eventPart, ...modifiers] = (attr.name.startsWith("z-on:") ? attr.name.slice(5) : attr.name.slice(1)).split(".");
                const handler = context.methods[attr.value] || (() => {});
                props[`@${eventPart}`] = (e) => {
                  if (modifiers.includes("prevent")) e.preventDefault();
                  if (modifiers.includes("stop")) e.stopPropagation();
                  handler(e);
                };
              } else if (attr.name === "z-if") {
                directives["z-if"] = () => unwrap(this.evaluate(attr.value, context.state.get()));
              } else if (attr.name === "show-when") {
                directives["show-when"] = () => unwrap(this.evaluate(attr.value, context.state.get()));
              } else if (attr.name === "z-show") {
                directives["z-show"] = () => unwrap(this.evaluate(attr.value, context.state.get()));
              } else if (attr.name === "z-for") {
                const [item, list] = attr.value.split(" in ").map((s) => s.trim());
                directives["z-for"] = { item, list };
              } else if (attr.name === "repeat") {
                const [item, list] = attr.value.split(" from ").map((s) => s.trim());
                directives["z-for"] = { item, list };
              } else if (attr.name === "z-model") {
                directives["z-model"] = attr.value;
                flags |= this.PATCH_FLAGS.FULL_PROPS;
              } else if (attr.name === "z-once") {
                directives["z-once"] = true;
              } else if (attr.name === "z-pre") {
                directives["z-pre"] = true;
              } else if (attr.name === "z-html") {
                directives["z-html"] = () => unwrap(this.evaluate(attr.value, context.state.get()));
                flags |= this.PATCH_FLAGS.TEXT;
              } else if (attr.name === "set-html") {
                directives["set-html"] = () => unwrap(this.evaluate(attr.value, context.state.get()));
                flags |= this.PATCH_FLAGS.TEXT;
              } else if (attr.name === "set-text") {
                directives["set-text"] = () => unwrap(this.evaluate(attr.value, context.state.get()));
                flags |= this.PATCH_FLAGS.TEXT;
              } else if (attr.name === "z-transition") {
                directives["z-transition"] = attr.value;
              } else {
                props[attr.name] = attr.value;
              }
            });
  
            const children = Array.from(node.childNodes)
              .map((child) => parseNode(child, scopeId, directives))
              .filter(Boolean);
  
            if (directives["z-if"]) {
              return { type: "if", condition: directives["z-if"], children, flags };
            }
            if (directives["show-when"]) {
              return { type: "if", condition: directives["show-when"], children, flags };
            }
            if (directives["z-for"]) {
              return { type: "for", item: directives["z-for"].item, list: directives["z-for"].list, children, flags };
            }
            if (directives["z-once"]) {
              const staticVNode = this.h(node.tagName.toLowerCase(), props, children.map((child) => buildVNode(child)));
              staticNodes.set(`${scopeId}-${node.tagName}-${children.length}`, staticVNode);
              return { type: "once", key: `${scopeId}-${node.tagName}-${children.length}`, flags: 0 };
            }
  
            const vnode = this.h(node.tagName.toLowerCase(), props, children);
            if (directives["z-show"]) props["data-z-show"] = directives["z-show"];
            if (directives["z-model"]) props["data-z-model"] = directives["z-model"];
            if (directives["z-html"]) {
              return { type: "html", value: directives["z-html"], flags: this.PATCH_FLAGS.TEXT };
            }
            if (directives["set-html"]) {
              return { type: "html", value: directives["set-html"], flags: this.PATCH_FLAGS.TEXT };
            }
            if (directives["set-text"]) {
              return { type: "dynamicText", value: directives["set-text"], flags: this.PATCH_FLAGS.TEXT };
            }
            if (directives["z-transition"]) props["data-z-transition"] = directives["z-transition"];
            if (!Object.keys(directives).length && !children.some((c) => c.type !== "staticText")) {
              staticNodes.set(vnode, vnode);
            }
            vnode.flags = flags;
            return vnode;
          }
          return null;
        };
  
        const buildVNode = (node, isRoot = false) => {
          if (!node) return null;
          if (node.type === "staticText") return staticNodes.get(node.value) || node.value;
          if (node.type === "dynamicText") return node.value();
          if (node.type === "if") return node.condition() ? node.children.map((child) => buildVNode(child)).flat() : [];
          if (node.type === "for") {
            const list = unwrap(this.evaluate(node.list, context.state.get())) || [];
            return list.length > 0
              ? list
                  .map((item, index) => {
                    const childContext = { ...context, state: this.state({ ...context.state.get(), [node.item]: item, index }) };
                    return node.children.map((child) => buildVNode({ ...child, context: childContext }));
                  })
                  .flat()
              : [];
          }
          if (node.type === "once") return staticNodes.get(node.key);
          if (node.type === "html") return { type: "html", value: node.value(), flags: node.flags };
          if (staticNodes.has(node)) return staticNodes.get(node);
  
          const props = Object.fromEntries(Object.entries(node.props).map(([k, v]) => [k, typeof v === "function" ? v() : v]));
          const children = node.children.map((child) => buildVNode(child)).flat();
          const vnode = this.h(node.tag, props, children);
          vnode.flags = node.flags;
          return vnode;
        };
  
        const scopeId = `litez-${Math.random().toString(36).slice(2)}`;
        const rootNode = parseNode(root.firstChild, scopeId);
        let cachedRender = null;
  
        return {
          render: () => {
            if (cachedRender && !rootNode.flags) return cachedRender;
            const result = buildVNode(rootNode, true);
            cachedRender = result || this.h("div", {}, "");
            return cachedRender;
          },
          scopeId,
        };
      } catch (e) {
        if (LiteZ.errorHandler) LiteZ.errorHandler(e);
        else console.error("Template compilation error:", e);
        return { render: () => LiteZ.h("div", {}, "Error compiling template"), scopeId: "" };
      }
    },
  
    component(
      name,
      { template, data = () => ({}), methods = {}, computed = {}, on = {}, props = {}, slots = {}, styles, scoped = false } = {}
    ) {
      if (!name || typeof name !== "string") throw new Error("Component name must be a non-empty string");
      if (!template) throw new Error(`Component "${name}" must have a template`);
  
      let styleId;
      try {
        if (typeof require !== "undefined") styleId = `litez-${name}-${require("crypto").randomUUID()}`;
        else if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") styleId = `litez-${name}-${crypto.randomUUID()}`;
        else styleId = `litez-${name}-${Math.random().toString(36).substr(2, 9)}`;
      } catch (e) {
        styleId = `litez-${name}-${Date.now().toString(36)}`;
      }
  
      const componentDef = {
        name,
        createInstance: function (inputProps = {}, slotContent = {}) {
          try {
            on.beforeCreate?.();
            const instanceState = LiteZ.reactive(data());
            const propsState = LiteZ.reactive({});
            const computedState = {};
            const boundMethods = {
              emit: LiteZ.emit.bind(LiteZ),
              on: LiteZ.on.bind(LiteZ),
            };
  
            const validatedProps = {};
            for (const [key, def] of Object.entries(props)) {
              const value = inputProps[key];
              validatedProps[key] = value !== undefined ? value : def.default !== undefined ? def.default : null;
              if (def.required && value === undefined) throw new Error(`Prop "${key}" is required`);
              if (value !== undefined && typeof def.type === "function" && !(value instanceof def.type)) {
                throw new Error(`Prop "${key}" must be of type ${def.type.name}`);
              }
            }
            propsState.set(validatedProps);
  
            for (const [key, fn] of Object.entries(methods)) {
              boundMethods[key] = fn.bind({ state: instanceState, props: propsState, methods: boundMethods });
            }
  
            for (const [key, fn] of Object.entries(computed)) {
              computedState[key] = LiteZ.computed(fn);
              computedState[key].context = { state: instanceState };
            }
  
            const instanceSlots = {};
            for (const [slotName, fn] of Object.entries(slots)) {
              instanceSlots[slotName] = slotContent[slotName] || fn || (() => LiteZ.h("span", {}, ""));
            }
  
            const applyStyles = () => {
              if (styles && typeof document !== "undefined") {
                const styleEl = document.createElement("style");
                styleEl.setAttribute("data-litez-style", styleId);
                const css =
                  typeof styles === "string"
                    ? styles
                    : Object.entries(styles)
                        .map(([key, val]) => `${key} { ${Object.entries(val).map(([k, v]) => `${k}: ${v};`).join(" ")} }`)
                        .join(" ");
                styleEl.textContent = scoped ? `[data-litez-scope="${styleId}"] ${css}` : css;
                document.head.appendChild(styleEl);
              }
            };
  
            const context = {
              state: instanceState,
              props: propsState,
              methods: boundMethods,
              computed: computedState,
              slots: instanceSlots,
            };
  
            const { render: renderTemplate, scopeId } =
              typeof template === "string" ? LiteZ.compileTemplate(template, context) : { render: template, scopeId: styleId };
  
            const instance = {
              template: () => {
                try {
                  const vnode = renderTemplate(context);
                  if (!vnode) return LiteZ.h("div", {}, "");
                  if (vnode.props) vnode.props["data-litez-component"] = styleId;
                  else vnode.props = { "data-litez-component": styleId };
                  return vnode;
                } catch (err) {
                  if (LiteZ.errorHandler) LiteZ.errorHandler(err);
                  else console.error(`Rendering error in ${name}: ${err.message}`);
                  return LiteZ.h("div", {}, "Error rendering component");
                }
              },
              state: instanceState,
              props: propsState,
              methods: boundMethods,
              computed: computedState,
              on: {
                beforeCreate: on.beforeCreate || null,
                created: on.created || null,
                beforeMount: on.beforeMount || null,
                mount: () => {
                  applyStyles();
                  on.mount?.(instanceState.get(), propsState.get());
                },
                beforeUpdate: on.beforeUpdate || null,
                update: on.update || null,
                updated: on.updated || null,
                beforeDestroy: on.beforeDestroy || null,
                destroyed: on.destroyed || null,
                error: on.error || null,
              },
              dom: null,
            };
  
            on.created?.(instanceState.get(), propsState.get());
            return instance;
          } catch (e) {
            if (LiteZ.errorHandler) LiteZ.errorHandler(e);
            else console.error(`Component creation error for ${name}:`, e);
            return {
              template: () => LiteZ.h("div", {}, "Error"),
              state: LiteZ.state({}),
              props: LiteZ.state({}),
              methods: {},
              computed: {},
              on: {},
              dom: null,
            };
          }
        }.bind(LiteZ),
      };
  
      this.components[name] = componentDef;
  
      const kebabName = name.replace(/([A-Z])/g, "-$1").toLowerCase();
      if (typeof customElements !== "undefined" && !customElements.get(kebabName)) {
        customElements.define(
          kebabName,
          class extends HTMLElement {
            constructor() {
              super();
              const propsFromDataset = {};
              for (const [key, value] of Object.entries(this.dataset)) {
                const camelCaseKey = key.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
                propsFromDataset[camelCaseKey] = value;
              }
              this.instance = componentDef.createInstance(propsFromDataset);
              this.shadow = this.attachShadow({ mode: "open" });
            }
            connectedCallback() {
              const node = this.instance.template();
              this.instance.dom = LiteZ.render(node, this.shadow);
              this.instance.on.mount?.(this.instance.state.get(), this.instance.props.get());
            }
            disconnectedCallback() {
              this.instance.on.beforeDestroy?.(this.instance.state.get(), this.instance.props.get());
              this.instance.on.destroyed?.(this.instance.state.get(), this.instance.props.get());
            }
            attributeChangedCallback(name, oldValue, newValue) {
              if (this.instance) {
                const camelCaseName = name.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
                this.instance.props.set(camelCaseName, newValue);
                const newNode = this.instance.template();
                LiteZ.update(this.shadow, newNode, this.instance.dom);
                this.instance.dom = newNode;
              }
            }
            static get observedAttributes() {
              return Object.keys(props).map((prop) => prop.replace(/([A-Z])/g, "-$1").toLowerCase());
            }
          }
        );
      }
  
      return componentDef;
    },
  
    render(node, container, nonce = null) {
      if (typeof document === "undefined") {
        console.warn("render called in non-browser environment; use renderToString for SSR");
        return null;
      }
      try {
        if (!node) {
          console.warn("Render called with undefined node");
          return null;
        }
  
        if (typeof node === "string") {
          const textNode = document.createTextNode(node);
          container.appendChild(textNode);
          return textNode;
        }
  
        if (!node.tag && !node.type) {
          console.warn("Invalid node structure:", node);
          return null;
        }
  
        if (node.type === "html") {
          const el = document.createElement("div");
          el.innerHTML = node.value || "";
          container.appendChild(el);
          return el;
        }
  
        const el = document.createElement(node.tag);
        el._key = node.key;
        el._component = container._component;
        el._flags = node.flags || 0;
  
        for (const [key, value] of Object.entries(node.props || {})) {
          if (key.startsWith("@")) {
            const eventName = key.slice(1);
            if (typeof value === "function") {
              const oldListeners = this.eventMap.get(el) || {};
              if (oldListeners[eventName]) el.removeEventListener(eventName, oldListeners[eventName]);
              this.eventMap.set(el, { ...oldListeners, [eventName]: value });
              el.addEventListener(eventName, value);
            }
          } else if (key === "style" && nonce) {
            el.setAttribute("style", value);
            el.setAttribute("nonce", nonce);
          } else if (key.startsWith("data-")) {
            const dataKey = key.slice(5).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
            el.dataset[dataKey] = value;
          } else {
            el.setAttribute(key, value);
          }
        }
  
        const children = Array.isArray(node.children) ? node.children : [];
        children.forEach((child) => {
          if (child !== undefined && child !== null) {
            this.render(child, el, nonce);
          }
        });
  
        container.appendChild(el);
        return el;
      } catch (e) {
        console.error("Render error:", {
          error: e,
          node: node,
          container: container?.outerHTML,
        });
        return null;
      }
    },
  
    renderToString(node) {
      const sanitize = (html) => (typeof DOMPurify !== "undefined" ? DOMPurify.sanitize(html) : html);
      try {
        if (!node) return "";
        if (typeof node === "string") return sanitize(node);
        const propsStr = Object.entries(node.props || {})
          .map(([key, value]) => (key.startsWith("@") ? "" : `${key}="${sanitize(String(value))}"`))
          .join(" ");
        const childrenStr = (Array.isArray(node.children) ? node.children : []).map((child) => this.renderToString(child)).join("");
        return `<${node.tag}${propsStr ? " " + propsStr : ""}>${childrenStr}</${node.tag}>`;
      } catch (e) {
        if (this.errorHandler) this.errorHandler(e);
        else console.error("renderToString error:", e);
        return "<div>Error rendering to string</div>";
      }
    },
  
    hydrate(node, container) {
      if (typeof document === "undefined") throw new Error("hydrate is only available in browser");
      try {
        const comp = container._component || this.components[node.tag]?.createInstance();
        if (comp) {
          comp.dom = container.querySelector(node.tag) || container;
          comp.on.mount?.(comp.state.get(), comp.props.get());
          this.applyDirectives(container, comp.state);
          container._component = comp;
        }
      } catch (e) {
        if (this.errorHandler) this.errorHandler(e);
        else console.error("Hydrate error:", e);
      }
    },
  
    generateStatic(routes, outputDir) {
      if (typeof require === "undefined") throw new Error("SSG requires Node.js environment");
      try {
        const fs = require("fs");
        const path = require("path");
        for (const [route, config] of Object.entries(routes)) {
          const comp = this.components[config.component].createInstance(config.props || {});
          const html = this.renderToString(comp.template());
          const fullPath = path.join(outputDir, `${route === "/" ? "index" : route}.html`);
          fs.mkdirSync(path.dirname(fullPath), { recursive: true });
          fs.writeFileSync(fullPath, `<!DOCTYPE html><html><body>${html}</body></html>`);
        }
      } catch (e) {
        if (this.errorHandler) this.errorHandler(e);
        else console.error("Static generation error:", e);
      }
    },
  
    scheduleUpdate(parent, newNode, oldNode, index = 0) {
      if (typeof document === "undefined") return;
      try {
        const key = `${parent._key || parent.nodeName}-${index}`;
        this.updateQueue.set(key, { parent, newNode, oldNode, index });
        if (!this.updateScheduled) {
          this.updateScheduled = true;
          requestAnimationFrame(() => {
            this.updateQueue.forEach(({ parent, newNode, oldNode, index }) => this.update(parent, newNode, oldNode, index));
            this.updateQueue.clear();
            this.updateScheduled = false;
          });
        }
      } catch (e) {
        if (this.errorHandler) this.errorHandler(e);
        else console.error("Schedule update error:", e);
      }
    },
  
    update(parent, newNode, oldNode, index = 0) {
      if (typeof document === "undefined") return;
      try {
        const child = parent.childNodes[index];
        if (!child) return;
        const comp = child._component || parent._component;
  
        if (!newNode && child) {
          comp?.on.beforeDestroy?.(comp.state.get(), comp.props.get());
          if (child._litez_cleanup) child._litez_cleanup();
          parent.removeChild(child);
          this.eventMap.delete(child);
          comp?.on.destroyed?.(comp.state.get(), comp.props.get());
          return;
        }
        if (newNode && !child) {
          const newEl = this.render(newNode, parent);
          comp?.on.mount?.(comp.state.get(), comp.props.get());
          return newEl;
        }
  
        if (typeof newNode === "string" && typeof oldNode === "string") {
          if (newNode !== oldNode) child.textContent = newNode.trim();
          return;
        }
  
        if (!newNode?.tag || !oldNode?.tag || newNode.tag !== oldNode.tag) {
          comp?.on.beforeDestroy?.(comp.state.get(), comp.props.get());
          if (child._litez_cleanup) child._litez_cleanup();
          const newEl = this.render(newNode, document.createElement("div"));
          parent.replaceChild(newEl, child);
          this.eventMap.delete(child);
          comp?.on.destroyed?.(comp.state.get(), comp.props.get());
          comp?.on.mount?.(comp.state.get(), comp.props.get());
          return;
        }
  
        comp?.on.beforeUpdate?.(comp.state.get(), comp.props.get());
        const newFlags = newNode.flags || 0;
        const oldFlags = oldNode.flags || 0;
  
        if (newFlags || oldFlags) {
          const newProps = newNode.props || {};
          const oldProps = oldNode.props || {};
          if (newFlags & this.PATCH_FLAGS.TEXT && newNode.type === "html") {
            child.innerHTML = newNode.value || "";
          }
          if (newFlags & this.PATCH_FLAGS.CLASS || oldFlags & this.PATCH_FLAGS.CLASS) {
            if (newProps.class !== oldProps.class) child.setAttribute("class", newProps.class || "");
          }
          if (newFlags & this.PATCH_FLAGS.PROPS || newFlags & this.PATCH_FLAGS.FULL_PROPS) {
            for (const key in oldProps) if (!(key in newProps) && !key.startsWith("@")) child.removeAttribute(key);
            for (const [key, value] of Object.entries(newProps)) {
              if (key.startsWith("@")) {
                const eventName = key.slice(1);
                const oldListeners = this.eventMap.get(child) || {};
                if (oldListeners[eventName]) child.removeEventListener(eventName, oldListeners[eventName]);
                this.eventMap.set(child, { ...oldListeners, [eventName]: value });
                child.addEventListener(eventName, value);
              } else if (key.startsWith("data-")) {
                const dataKey = key.slice(5).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
                child.dataset[dataKey] = value;
              } else if (oldProps[key] !== value) {
                child.setAttribute(key, value);
              }
            }
          }
        }
  
        const newChildren = Array.isArray(newNode.children) ? newNode.children : [];
        const oldChildren = Array.isArray(oldNode.children) ? oldNode.children : [];
        const keyMap = new Map();
        oldChildren.forEach((child, i) => {
          if (child?.key !== undefined) keyMap.set(child.key, { node: child, index: i });
        });
  
        let i = 0,
          j = 0;
        while (i < newChildren.length || j < oldChildren.length) {
          const newChild = newChildren[i];
          const oldChild = oldChildren[j];
          const currentChild = parent.childNodes[j];
  
          if (!newChild) {
            comp?.on.beforeDestroy?.(comp.state.get(), comp.props.get());
            if (currentChild._litez_cleanup) currentChild._litez_cleanup();
            parent.removeChild(currentChild);
            this.eventMap.delete(currentChild);
            comp?.on.destroyed?.(comp.state.get(), comp.props.get());
            j++;
          } else if (!oldChild) {
            this.render(newChild, parent);
            i++;
          } else if (newChild.key && keyMap.has(newChild.key)) {
            const { node: matchedOldChild, index: oldIdx } = keyMap.get(newChild.key);
            if (oldIdx !== j) parent.insertBefore(parent.childNodes[oldIdx], currentChild);
            this.update(parent, newChild, matchedOldChild, j);
            keyMap.delete(newChild.key);
            i++;
            j++;
          } else {
            parent.replaceChild(this.render(newChild, document.createElement("div")), currentChild);
            if (currentChild._litez_cleanup) currentChild._litez_cleanup();
            this.eventMap.delete(currentChild);
            i++;
            j++;
          }
        }
        comp?.on.updated?.(comp.state.get(), comp.props.get());
      } catch (e) {
        if (this.errorHandler) this.errorHandler(e);
        else console.error("Update error:", e);
      }
    },
  
    router(routes, target = "#app", middlewares = []) {
      if (typeof document === "undefined") return { go: () => {}, link: () => this.h("a", {}) };
      try {
        if (!routes || typeof routes !== "object") throw new Error("Routes must be an object");
        this.routes = routes;
        const container = document.querySelector(target);
        if (!container) {
          console.warn(`Target "${target}" not found; router disabled`);
          return { go: () => {}, link: () => this.h("a", {}) };
        }
  
        const normalizePath = (path) => {
          const parts = path.split("/").filter(Boolean);
          const stack = [];
          for (const part of parts) {
            if (part === "..") stack.pop();
            else if (part !== ".") stack.push(part);
          }
          return "/" + stack.join("/");
        };
  
        const parseRoute = (path) => {
          const paramPattern = /:([^\/]+)/g;
          const regex = new RegExp("^" + path.replace(paramPattern, "([^/]+)") + "$");
          return { regex, params: (path.match(paramPattern) || []).map((p) => p.slice(1)) };
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
            if (config.children) {
              const nestedMatch = matchRoute(pathname, config.children);
              if (nestedMatch) return nestedMatch;
            }
          }
          return null;
        };
  
        const showRoute = () => {
          const path = window.location ? normalizePath(window.location.pathname) : "/";
          const matchedRoute = matchRoute(path);
          const route = matchedRoute ? matchedRoute.config : this.routes["/"] || { component: "NotFound" };
          const compDef =
            this.components[route.component] || this.components["NotFound"] || {
              createInstance: () => ({
                template: () => this.h("div", {}, "404 - Page Not Found"),
                state: this.state({}),
                props: this.state({}),
                on: {},
              }),
            };
          const comp = compDef.createInstance({ ...route.props, params: matchedRoute?.params || {} });
  
          let next = true;
          for (const middleware of middlewares) {
            next = middleware(path, route, comp.state.get());
            if (!next) return;
          }
  
          try {
            const node = comp.template();
            if (!comp.dom) {
              comp.on.beforeMount?.(comp.state.get(), comp.props.get());
              comp.dom = this.render(node, container);
              comp.on.mount?.(comp.state.get(), comp.props.get());
            } else {
              comp.on.beforeUpdate?.(comp.state.get(), comp.props.get());
              this.update(container, node, comp.dom);
              comp.dom = node;
              comp.on.update?.(comp.state.get(), comp.props.get());
              comp.on.updated?.(comp.state.get(), comp.props.get());
            }
            container._component = comp;
            this.applyDirectives(container, comp.state);
          } catch (err) {
            if (comp.on.error) comp.on.error(err);
            else if (this.errorHandler) this.errorHandler(err);
            else console.error("Route rendering error:", err);
          }
        };
  
        window.addEventListener("popstate", () => {
          const oldComp = container._component;
          if (oldComp?.dom && oldComp.on.beforeDestroy) oldComp.on.beforeDestroy(oldComp.state.get(), oldComp.props.get());
          showRoute();
          if (oldComp?.dom && oldComp.on.destroyed) oldComp.on.destroyed(oldComp.state.get(), oldComp.props.get());
        });
        showRoute();
  
        return {
          go: (path) => {
            window.history.pushState({}, "", path);
            showRoute();
          },
          link: (path, text) =>
            this.h("a", {
              href: path,
              "@click": (e) => {
                e.preventDefault();
                this.router().go(path);
              },
            }, text),
        };
      } catch (e) {
        if (this.errorHandler) this.errorHandler(e);
        else console.error("Router error:", e);
        return { go: () => {}, link: () => this.h("a", {}) };
      }
    },
  
    store({ state = {}, mutations = {}, actions = {}, getters = {}, modules = {}, middlewares = [] }) {
      try {
        const data = this.state(state);
        const computedGetters = {};
        const history = [];
        let historyIndex = -1;
        const maxHistory = 50;
  
        const clone = (obj) => (typeof structuredClone === "function" ? structuredClone(obj) : JSON.parse(JSON.stringify(obj)));
  
        const moduleStores = {};
        for (const [moduleName, module] of Object.entries(modules)) {
          moduleStores[moduleName] = this.store({
            state: module.state || {},
            mutations: module.mutations || {},
            actions: module.actions || {},
            getters: module.getters || {},
            middlewares: module.middlewares || [],
          });
        }
  
        for (const [key, fn] of Object.entries(getters)) {
          computedGetters[key] = this.computed(fn);
        }
  
        const commit = (type, payload) => {
          const mutation = mutations[type];
          if (mutation) {
            const oldState = clone(data.get());
            mutation(data.get(), payload);
            history.splice(Math.min(historyIndex + 1, history.length));
            history.push({ type, payload, before: oldState, after: clone(data.get()) });
            historyIndex++;
            if (history.length > maxHistory) {
              history.shift();
              historyIndex = Math.max(0, historyIndex - 1);
            }
            return true;
          }
          for (const [moduleName, mod] of Object.entries(moduleStores)) {
            if (mod.commit(type, payload)) return true;
          }
          return false;
        };
  
        const runMiddleware = (action, ctx, payload, next) => {
          let index = 0;
          const run = (i) => {
            if (i >= middlewares.length) return next();
            middlewares[i](action, ctx, payload, () => run(i + 1));
          };
          run(index);
        };
  
        this.store = {
          state: data,
          getters: computedGetters,
          modules: moduleStores,
          commit,
          dispatch: (type, payload) => {
            const action = actions[type];
            if (action) {
              const ctx = { state: data, commit, modules: moduleStores };
              runMiddleware(type, ctx, payload, () => action(ctx, payload));
              return true;
            }
            for (const [moduleName, mod] of Object.entries(moduleStores)) {
              if (mod.dispatch(type, payload)) return true;
            }
            return false;
          },
          undo: () => {
            if (historyIndex >= 0) {
              const prev = history[historyIndex];
              data.set(prev.before);
              historyIndex--;
              return true;
            }
            return false;
          },
          redo: () => {
            if (historyIndex < history.length - 1) {
              historyIndex++;
              const next = history[historyIndex];
              data.set(next.after);
              return true;
            }
            return false;
          },
        };
        return this.store;
      } catch (e) {
        if (this.errorHandler) this.errorHandler(e);
        else console.error("Store creation error:", e);
        return {};
      }
    },
  
    lazy(name, loader) {
      try {
        const placeholder =
          this.components["lite-suspense"]?.createInstance() || {
            template: () => this.h("div", {}, "Loading..."),
            state: this.state({ loading: true }),
            props: this.state({}),
          };
        this.components[name] = {
          createInstance: (props, slots) => {
            const instance = placeholder.createInstance(props, slots);
            loader()
              .then((def) => {
                this.component(name, def);
                const newInstance = this.components[name].createInstance(props, slots);
                instance.state.set("loading", false);
                if (instance.dom && typeof document !== "undefined") {
                  const newNode = newInstance.template();
                  this.update(instance.dom.parentNode, newNode, instance.dom);
                  instance.dom = newNode;
                }
              })
              .catch((err) => {
                if (this.errorHandler) this.errorHandler(err);
                else console.error(`Lazy loading failed for ${name}: ${err.message}`);
                instance.state.set("loading", false);
              });
            return instance;
          },
        };
      } catch (e) {
        if (this.errorHandler) this.errorHandler(e);
        else console.error("Lazy loading setup error:", e);
      }
    },
  
    directive(name, handler) {
      try {
        this.directives[name] = handler;
      } catch (e) {
        if (this.errorHandler) this.errorHandler(e);
        else console.error("Directive registration error:", e);
      }
    },
  
    applyDirectives(container, state) {
      if (typeof document === "undefined") return;
      try {
        Object.entries(this.directives).forEach(([name, fn]) => {
          container.querySelectorAll(`[data-${name}]`).forEach((el) => {
            const value = el.dataset[name];
            if (value) fn(el, value, state);
          });
        });
      } catch (e) {
        if (this.errorHandler) this.errorHandler(e);
        else console.error("Apply directives error:", e);
      }
    },
  
    emit(event, data) {
      try {
        const listeners = this.events.get(event) || [];
        listeners.forEach((cb) => cb(data));
      } catch (e) {
        if (this.errorHandler) this.errorHandler(e);
        else console.error("Emit error:", e);
      }
    },
  
    on(event, callback) {
      try {
        if (!this.events.has(event)) this.events.set(event, []);
        this.events.get(event).push(callback);
        return () => this.off(event, callback);
      } catch (e) {
        if (this.errorHandler) this.errorHandler(e);
        else console.error("On error:", e);
        return () => {};
      }
    },
  
    off(event, callback) {
      try {
        const listeners = this.events.get(event);
        if (listeners) this.events.set(event, listeners.filter((cb) => cb !== callback));
      } catch (e) {
        if (this.errorHandler) this.errorHandler(e);
        else console.error("Off error:", e);
      }
    },
  
    install(plugin, options = {}) {
      try {
        if (this.plugins.has(plugin)) return;
        this.plugins.add(plugin);
        if (typeof plugin.install === "function") {
          plugin.install(this, options);
        } else if (typeof plugin === "function") {
          plugin(this, options);
        }
        return this;
      } catch (e) {
        if (this.errorHandler) this.errorHandler(e);
        else console.error("Plugin install error:", e);
        return this;
      }
    },
  
    use(plugin, options) {
      return this.install(plugin, options);
    },
  
    setErrorHandler(handler) {
      try {
        this.errorHandler = handler;
      } catch (e) {
        console.error("Set error handler error:", e);
      }
    },
  
    init(selector = "[data-litez]") {
      if (typeof document === "undefined") return;
      const el = document.querySelector(selector);
      if (!el) return;
  
      const state = this.state(JSON.parse(el.dataset.litez || "{}"));
      this.applyDirectives(el, state);
  
      el.querySelectorAll("[data-on]").forEach((child) => {
        const [event, method] = child.dataset.on.split(":");
        child.addEventListener(event, () => state.set(method, child.value || true));
      });
    },
  
    provide(key, value) {
      try {
        this._di.set(key, value);
      } catch (e) {
        if (this.errorHandler) this.errorHandler(e);
        else console.error("Provide error:", e);
      }
    },
  
    inject(key) {
      try {
        return this._di.get(key);
      } catch (e) {
        if (this.errorHandler) this.errorHandler(e);
        else console.error("Inject error:", e);
      }
    },
  
    // Back-end Server Integration
    server: {
      routes: {},
      middlewares: [],
      listen(port, callback) {
        if (typeof require === "undefined") throw new Error("Server requires Node.js environment");
        const http = require("http");
        const server = http.createServer((req, res) => {
          let next = true;
          for (const middleware of this.middlewares) {
            next = middleware(req, res, () => {});
            if (!next) return;
          }
  
          const key = `${req.method} ${req.url}`;
          const routeHandler = this.routes[key];
          if (routeHandler) {
            res.setHeader("Content-Type", "application/json");
            try {
              const result = routeHandler(req);
              res.statusCode = 200;
              if (result instanceof Promise) {
                result
                  .then((data) => res.end(JSON.stringify(data)))
                  .catch((e) => {
                    res.statusCode = 500;
                    res.end(JSON.stringify({ error: e.message }));
                    if (LiteZ.errorHandler) LiteZ.errorHandler(e);
                  });
              } else {
                res.end(JSON.stringify(result));
              }
            } catch (e) {
              res.statusCode = 500;
              res.end(JSON.stringify({ error: e.message }));
              if (LiteZ.errorHandler) LiteZ.errorHandler(e);
            }
          } else {
            res.statusCode = 404;
            res.end(JSON.stringify({ error: "Not Found" }));
          }
        });
        server.listen(port, callback);
        return server;
      },
      route(method, path, handler) {
        this.routes[`${method} ${path}`] = handler;
      },
      use(middleware) {
        this.middlewares.push(middleware);
      },
    },
  
    // Database Integration
    db: {
      store: {}, // In-memory store
      db: null, // SQLite connection
      connect(file) {
        if (typeof require === "undefined") throw new Error("Database requires Node.js environment");
        const sqlite3 = require("sqlite3").verbose();
        this.db = new sqlite3.Database(file);
      },
      run(query, params = []) {
        if (!this.db) return this.inMemoryRun(query, params);
        return new Promise((resolve, reject) => {
          this.db.run(query, params, function (err) {
            if (err) reject(err);
            else resolve(this);
          });
        });
      },
      get(query, params = []) {
        if (!this.db) return this.inMemoryGet(query, params);
        return new Promise((resolve, reject) => {
          this.db.get(query, params, (err, row) => {
            if (err) reject(err);
            else resolve(row);
          });
        });
      },
      all(query, params = []) {
        if (!this.db) return this.inMemoryAll(query, params);
        return new Promise((resolve, reject) => {
          this.db.all(query, params, (err, rows) => {
            if (err) reject(err);
            else resolve(rows);
          });
        });
      },
      // In-memory fallback methods
      inMemoryRun(query, params) {
        if (query.startsWith("INSERT INTO")) {
          const [_, table, values] = query.match(/INSERT INTO (\w+)\s*\((.+?)\)\s*VALUES\s*\((.+?)\)/) || [];
          if (!table) return;
          if (!this.store[table]) this.store[table] = [];
          const fields = values.split(",").map((f) => f.trim());
          const data = {};
          fields.forEach((field, i) => (data[field] = params[i]));
          this.store[table].push(data);
          return data;
        }
      },
      inMemoryGet(query, params) {
        if (query.startsWith("SELECT")) {
          const [_, table, where] = query.match(/SELECT \* FROM (\w+)(?: WHERE (.+))?/) || [];
          if (!table || !this.store[table]) return null;
          if (!where) return this.store[table][0];
          const conditions = where.split(" AND ").map((c) => c.split("=").map((s) => s.trim()));
          return this.store[table].find((item) =>
            conditions.every(([key, val]) => item[key] === (val.startsWith("?") ? params.shift() : val))
          );
        }
      },
      inMemoryAll(query, params) {
        if (query.startsWith("SELECT")) {
          const [_, table, where] = query.match(/SELECT \* FROM (\w+)(?: WHERE (.+))?/) || [];
          if (!table || !this.store[table]) return [];
          if (!where) return this.store[table];
          const conditions = where.split(" AND ").map((c) => c.split("=").map((s) => s.trim()));
          return this.store[table].filter((item) =>
            conditions.every(([key, val]) => item[key] === (val.startsWith("?") ? params.shift() : val))
          );
        }
      },
    },
  
    createApp({ template, data = () => ({}), methods = {}, computed = {}, on = {}, props = {}, slots = {} }) {
      try {
        const appState = this.state(data());
        const appProps = this.state(props);
        const appComputed = {};
        const appMethods = {};
  
        for (const [key, fn] of Object.entries(methods)) {
          appMethods[key] = fn.bind({ state: appState, props: appProps, methods: appMethods });
        }
  
        for (const [key, fn] of Object.entries(computed)) {
          appComputed[key] = this.computed(fn);
          appComputed[key].context = { state: appState };
        }
  
        const appSlots = {};
        for (const [slotName, fn] of Object.entries(slots)) {
          appSlots[slotName] = fn || (() => this.h("span", {}, ""));
        }
  
        const context = {
          state: appState,
          props: appProps,
          methods: appMethods,
          computed: appComputed,
          slots: appSlots,
        };
  
        const { render: renderTemplate, scopeId } =
          typeof template === "string"
            ? this.compileTemplate(template, context)
            : { render: template, scopeId: `app-${Math.random().toString(36).slice(2)}` };
  
        const app = {
          template: renderTemplate,
          state: appState,
          props: appProps,
          methods: appMethods,
          computed: appComputed,
          on,
          dom: null,
          mount(selector) {
            if (typeof document === "undefined") {
              console.warn("Mount called in non-browser environment");
              return this;
            }
            const container = document.querySelector(selector);
            if (!container) throw new Error(`Mount point "${selector}" not found`);
  
            on.beforeMount?.(appState.get(), appProps.get());
            const node = this.template();
            this.dom = this.render(node, container);
            container._component = this;
            this.applyDirectives(container, appState);
            on.mount?.(appState.get(), appProps.get());
            appState.onChange(() => {
              on.beforeUpdate?.(appState.get(), appProps.get());
              const newNode = this.template();
              this.update(container, newNode, this.dom);
              this.dom = newNode;
              on.updated?.(appState.get(), appProps.get());
            });
            return this;
          },
        };
  
        on.created?.(appState.get(), appProps.get());
        return app;
      } catch (e) {
        if (this.errorHandler) this.errorHandler(e);
        else console.error("createApp error:", e);
        return { mount: () => {} };
      }
    },
  };
  
  // Register Built-in Directives
  LiteZ.directive("z-model", function (el, value, state) {
    try {
      el.value = LiteZ.evaluate(value, state.get()) || "";
      el.addEventListener("input", () => state.set(value, el.value));
      const unsubscribe = state.onChange(() => {
        const newVal = LiteZ.evaluate(value, state.get());
        if (el.value !== newVal) el.value = newVal || "";
      });
      el._litez_cleanup = unsubscribe;
    } catch (e) {
      if (LiteZ.errorHandler) LiteZ.errorHandler(e);
      else console.error("z-model directive error:", e);
    }
  });
  
  LiteZ.directive("z-show", function (el, value, state) {
    try {
      el.style.display = LiteZ.evaluate(value, state.get()) ? "" : "none";
      const unsubscribe = state.onChange(() => {
        el.style.display = LiteZ.evaluate(value, state.get()) ? "" : "none";
      });
      el._litez_cleanup = unsubscribe;
    } catch (e) {
      if (LiteZ.errorHandler) LiteZ.errorHandler(e);
      else console.error("z-show directive error:", e);
    }
  });
  
  LiteZ.directive("show-when", function (el, value, state) {
    try {
      el.style.display = LiteZ.evaluate(value, state.get()) ? "" : "none";
      const unsubscribe = state.onChange(() => {
        el.style.display = LiteZ.evaluate(value, state.get()) ? "" : "none";
      });
      el._litez_cleanup = unsubscribe;
    } catch (e) {
      if (LiteZ.errorHandler) LiteZ.errorHandler(e);
      else console.error("show-when directive error:", e);
    }
  });
  
  LiteZ.directive("set-text", function (el, value, state) {
    try {
      el.textContent = LiteZ.evaluate(value, state.get()) || "";
      const unsubscribe = state.onChange(() => {
        el.textContent = LiteZ.evaluate(value, state.get()) || "";
      });
      el._litez_cleanup = unsubscribe;
    } catch (e) {
      if (LiteZ.errorHandler) LiteZ.errorHandler(e);
      else console.error("set-text directive error:", e);
    }
  });
  
  LiteZ.directive("set-html", function (el, value, state) {
    try {
      el.innerHTML = LiteZ.evaluate(value, state.get()) || "";
      const unsubscribe = state.onChange(() => {
        el.innerHTML = LiteZ.evaluate(value, state.get()) || "";
      });
      el._litez_cleanup = unsubscribe;
    } catch (e) {
      if (LiteZ.errorHandler) LiteZ.errorHandler(e);
      else console.error("set-html directive error:", e);
    }
  });
  
  LiteZ.directive("bind", function (el, value, state, attrName) {
    try {
      const [prefix, attr] = attrName.split(":");
      if (prefix !== "bind" || !attr) return;
      const val = LiteZ.evaluate(value, state.get());
      if (attr === "class") {
        if (typeof val === "string") el.className = val;
        else if (Array.isArray(val)) el.className = val.join(" ");
        else if (typeof val === "object") {
          Object.entries(val).forEach(([cls, condition]) => {
            if (condition) el.classList.add(cls);
            else el.classList.remove(cls);
          });
        }
      } else {
        el.setAttribute(attr, val || "");
      }
      const unsubscribe = state.onChange(() => {
        const newVal = LiteZ.evaluate(value, state.get());
        if (attr === "class") {
          if (typeof newVal === "string") el.className = newVal;
          else if (Array.isArray(newVal)) el.className = newVal.join(" ");
          else if (typeof newVal === "object") {
            Object.entries(newVal).forEach(([cls, condition]) => {
              if (condition) el.classList.add(cls);
              else el.classList.remove(cls);
            });
          }
        } else {
          el.setAttribute(attr, newVal || "");
        }
      });
      el._litez_cleanup = unsubscribe;
    } catch (e) {
      if (LiteZ.errorHandler) LiteZ.errorHandler(e);
      else console.error("bind directive error:", e);
    }
  });
  
  // Built-in Suspense Component
  LiteZ.component("lite-suspense", {
    template: `
      <div>
        <slot v-if="!state.loading"></slot>
        <slot name="fallback" v-else></slot>
      </div>
    `,
    data: () => ({ loading: true }),
  });
  
  if (typeof window !== "undefined") {
    window.LiteZ = LiteZ;
  }
  
  export default LiteZ;