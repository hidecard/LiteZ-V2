// litez.js
const LiteZ = {
  components: {},
  component(name, options) {
    this.components[name] = options;
  },
  createApp(options) {
    return new LiteZApp(options);
  }
};

class LiteZApp {
  constructor(options) {
    this.lifecycleHooks = {
      onInit: options.onInit ? [options.onInit] : [],
      onReady: options.onReady ? [options.onReady] : [],
      onDisplay: options.onDisplay ? [options.onDisplay] : []
    };

    try {
      this.emitLifecycle('onInit');
      this.el = document.querySelector(options.es);
      if (!this.el) throw new Error(`Element selector "${options.es}" not found`);
      this.rawData = options.data ? options.data() : {};
      this.data = this.reactive(this.rawData);
      this.methods = options.methods || {};
      this.template = options.template || this.el.innerHTML;
      this.components = LiteZ.components;
      this.componentInstances = new Map();
      this.emitLifecycle('onReady');
      this.render();
      this.bindEvents();
      this.emitLifecycle('onDisplay');
    } catch (error) {
      this.handleError(error, 'App setup failed');
    }
  }

  reactive(data) {
    const appInstance = this;

    const handler = {
      get(target, key) {
        if (typeof target[key] === 'object' && target[key] !== null) {
          return new Proxy(target[key], handler); // Nested object တွေကို Proxy လုပ်တယ်
        }
        return Reflect.get(target, key);
      },
      set(target, key, value) {
        const result = Reflect.set(target, key, value);
        appInstance.update(); // Property တစ်ခု ပြောင်းတိုင်း update ခေါ်တယ်
        return result;
      }
    };

    return new Proxy(data, handler);
  }

  render() {
    try {
      const parser = new DOMParser();
      const doc = parser.parseFromString(`<div>${this.template}</div>`, 'text/html');
      const root = doc.body.firstChild;
      if (root) {
        Array.from(root.childNodes).forEach(child => this.processNode(child));
        this.el.innerHTML = root.innerHTML;
      }
    } catch (error) {
      this.handleError(error, 'Rendering failed');
    }
  }

  processNode(node, componentData = null) {
    if (!node) return;

    if (node.nodeType === Node.TEXT_NODE) {
      this.processTextContent(node, componentData || this.data);
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;

    if (node.hasAttribute('repeat')) {
      const [itemVar, listVar] = node.getAttribute('repeat').split(' from ').map(s => s.trim());
      const list = this.data[listVar] || [];
      const parent = node.parentNode;
      if (!parent) return;
      const fragment = document.createDocumentFragment();
      list.forEach((item, index) => {
        const clone = node.cloneNode(true);
        clone.removeAttribute('repeat');
        this.replaceTemplate(clone, itemVar, item, index);
        this.processNode(clone);
        fragment.appendChild(clone);
      });
      parent.replaceChild(fragment, node);
      return;
    }

    if (node.hasAttribute('show-when')) {
      const condition = node.getAttribute('show-when');
      const isTrue = this.evaluateCondition(condition, componentData || this.data);
      if (!isTrue && node.parentNode) {
        node.parentNode.removeChild(node);
        return;
      }
      node.removeAttribute('show-when');
    }

    if (node.hasAttribute('set-text')) {
      const key = node.getAttribute('set-text');
      const data = componentData || this.data;
      try {
        const fn = new Function('data', `with (data) { return ${key}; }`);
        node.textContent = fn(data) || '';
      } catch (e) {
        this.handleError(e, `set-text failed: ${key}`);
        node.textContent = '';
      }
      node.removeAttribute('set-text');
    }

    if (node.hasAttribute('set-html')) {
      const key = node.getAttribute('set-html');
      const data = componentData || this.data;
      try {
        const fn = new Function('data', `with (data) { return ${key}; }`);
        node.innerHTML = fn(data) || '';
      } catch (e) {
        this.handleError(e, `set-html failed: ${key}`);
        node.innerHTML = '';
      }
      node.removeAttribute('set-html');
    }

    if (node.hasAttribute('z-component')) {
      this.processComponent(node);
      return;
    }

    this.processAttributes(node);
    Array.from(node.childNodes).forEach(child => this.processNode(child, componentData));
  }

  processComponent(node) {
    const name = node.getAttribute('z-component');
    const component = this.components[name];
    const props = {};
    Array.from(node.attributes).forEach(attr => {
      if (attr.name.startsWith('z-prop:')) {
        const key = attr.name.replace('z-prop:', '');
        props[key] = this.data[attr.value] || attr.value;
      }
    });

    const compData = component.data ? component.data() : {};
    Object.assign(compData, props);
    const reactiveData = this.reactive(compData);
    const instance = { data: reactiveData, methods: component.methods || {} };
    const instanceId = `${name}-${Math.random().toString(36).substr(2, 9)}`;
    this.componentInstances.set(instanceId, instance);

    const compDoc = new DOMParser().parseFromString(component.template, 'text/html');
    const compRoot = compDoc.body.firstChild;
    if (!node.parentNode) return;
    compRoot.setAttribute('data-component', instanceId);
    this.processNode(compRoot, reactiveData);
    node.parentNode.replaceChild(compRoot, node);
  }

  processAttributes(node) {
    Array.from(node.attributes).forEach(attr => {
      if (attr.name.startsWith('bind:')) {
        const attrName = attr.name.replace('bind:', '');
        const value = this.data[attr.value] || attr.value;
        node.setAttribute(attrName, value);
        node.removeAttribute(attr.name);
      }
      if (attr.name === 'bind-class') {
        const classExpr = attr.value;
        try {
          const fn = new Function('data', `with (data) { return ${classExpr}; }`);
          const classes = fn(this.data);
          if (typeof classes === 'string') {
            node.className = classes;
          } else if (Array.isArray(classes)) {
            node.className = classes.join(' ');
          } else if (typeof classes === 'object') {
            Object.entries(classes).forEach(([cls, condition]) => {
              if (condition) node.classList.add(cls);
              else node.classList.remove(cls);
            });
          }
        } catch (e) {
          this.handleError(e, `bind-class failed: ${classExpr}`);
        }
        node.removeAttribute('bind-class');
      }
    });
  }

  processTextContent(node, data) {
    let text = node.textContent;
    const matches = text.match(/\$([a-zA-Z_][a-zA-Z0-9_]*)/g);
    if (matches) {
      matches.forEach(match => {
        const expression = match.slice(1).trim();
        try {
          const fn = new Function('data', `with (data) { return ${expression}; }`);
          text = text.replace(match, fn(data) || '');
        } catch (e) {
          this.handleError(e, `Text binding failed: ${expression}`);
          text = text.replace(match, '');
        }
      });
      node.textContent = text;
    }
  }

  replaceTemplate(node, itemVar, item, index) {
    const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
    let textNode;
    while (textNode = walker.nextNode()) {
      textNode.textContent = textNode.textContent
        .replace(new RegExp(`\\$${itemVar}`, 'g'), item)
        .replace(new RegExp(`\\$${itemVar}\\.index`, 'g'), index);
    }
  }

  evaluateCondition(condition, data) {
    try {
      const fn = new Function('data', `with (data) { return ${condition}; }`);
      return fn(data);
    } catch (e) {
      this.handleError(e, `Condition failed: ${condition}`);
      return false;
    }
  }

  update() {
    this.render();
    this.bindEvents();
  }

  bindEvents() {
    const elements = this.el.querySelectorAll('[on\\:click]');
    elements.forEach(el => {
      const eventAttrs = Array.from(el.attributes).filter(attr => attr.name.startsWith('on:'));
      eventAttrs.forEach(attr => {
        const eventName = attr.name.split(':')[1];
        const methodName = attr.value;
        const parentNode = el.closest('[data-component]');
        if (parentNode) {
          const instanceId = parentNode.getAttribute('data-component');
          const instance = this.componentInstances.get(instanceId);
          if (instance && instance.methods[methodName]) {
            el.removeEventListener(eventName, instance.methods[methodName]);
            el.addEventListener(eventName, () => {
              instance.methods[methodName].call(instance.data);
            });
          }
        } else if (this.methods[methodName]) {
          el.removeEventListener(eventName, this.methods[methodName]);
          el.addEventListener(eventName, () => {
            this.methods[methodName].call(this.data);
          });
        }
      });
    });
  }

  handleError(error, context) {
    console.error(`[${context}]: ${error.message}`);
    this.rawData.error = { message: error.message, context };
  }

  emitLifecycle(hookName) {
    if (this.lifecycleHooks[hookName]) {
      this.lifecycleHooks[hookName].forEach(callback => callback.call(this));
    }
  }
}

window.LiteZ = LiteZ;