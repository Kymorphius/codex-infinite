export class Node {
  constructor(tag) { this.tag = tag; this.children = []; this.style = {}; this.value = ''; this.attributes = {}; }
  setAttribute(name, value) { this.attributes[name] = value; } addEventListener(name, callback) { (this.listeners ||= new Map()).set(name, callback); }
  get parentNode() { return this.parent || null; }
  removeAttribute(name) { delete this.attributes[name]; }
  hasAttribute(name) { return name in this.attributes; } toggleAttribute(name, on) { if (on) this.attributes[name] = ''; else delete this.attributes[name]; }
  append(...nodes) { for (const node of nodes) { node.remove(); node.parent = this; this.children.push(node); } }
  prepend(...nodes) { for (const node of nodes.reverse()) { node.remove(); node.parent = this; this.children.unshift(node); } }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter(node => node !== this); this.parent = null; }
  replaceChildren() { this.children = []; }
  attachShadow() { this.shadowRoot = new Node('shadow'); return this.shadowRoot; }
}
