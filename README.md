# LiteZ.js

LiteZ.js is a lightweight JavaScript framework for building reactive UI components with a simple and intuitive syntax. It provides data reactivity, component-based architecture, and template binding without requiring a virtual DOM.

## Features

- **Reactive Data Binding**: Automatically updates the UI when data changes.
- **Component-Based**: Supports reusable components.
- **Lightweight**: Minimal footprint and dependencies.
- **Template Directives**: Includes `repeat`, `show-when`, `set-text`, `set-html`, and event bindings.
- **Event Handling**: Supports event bindings with `on:click`, `on:input`, etc.
- **Automatic Rendering**: Updates DOM elements dynamically based on changes in the data model.

## Installation

LiteZ.js is a standalone script. You can include it in your project via:

```html
<script src="litez.js"></script>
```

## Getting Started

### Creating an App

To create an app instance, use `LiteZ.createApp()` and provide an options object with `es`, `data`, `methods`, and `template`.

```javascript
const app = LiteZ.createApp({
  es: '#app',
  data: () => ({
    message: 'Hello, LiteZ!'
  }),
  methods: {
    changeMessage() {
      this.data.message = 'You clicked the button!';
    }
  },
  template: `
    <h1 set-text="message"></h1>
    <button on:click="changeMessage">Click Me</button>
  `
});
```

### Components

Components can be registered using `LiteZ.component()` and used inside templates with `z-component`.

```javascript
LiteZ.component('my-component', {
  data: () => ({ text: 'This is a component' }),
  template: `<p set-text="text"></p>`
});
```

Usage:

```html
<div z-component="my-component"></div>
```

### Directives

#### Data Binding
- **set-text**: Updates text content dynamically.
  ```html
  <p set-text="message"></p>
  ```
- **set-html**: Inserts HTML dynamically.
  ```html
  <div set-html="content"></div>
  ```

#### Loops
- **repeat**: Loops over an array and generates elements.
  ```html
  <ul>
    <li repeat="item from items" set-text="item"></li>
  </ul>
  ```

#### Conditional Rendering
- **show-when**: Conditionally shows elements.
  ```html
  <p show-when="isVisible">This is visible</p>
  ```

#### Event Binding
- **on:click**, **on:input**: Attach event handlers.
  ```html
  <button on:click="changeMessage">Click Me</button>
  ```

## Lifecycle Hooks

- `onInit()`: Called before the app is initialized.
- `onReady()`: Called after data and DOM are set up.
- `onDisplay()`: Called after the first render.

```javascript
const app = LiteZ.createApp({
  es: '#app',
  onInit() { console.log('App is initializing'); },
  onReady() { console.log('App is ready'); },
  onDisplay() { console.log('App is displayed'); }
});
```

## Error Handling

Errors are caught and logged to the console with meaningful messages.

## Conclusion

LiteZ.js is a simple yet powerful framework for building reactive applications with minimal setup. Start building your LiteZ.js app today!

---

### License
This project is open-source under the MIT License.

