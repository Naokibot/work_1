export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  options: { className?: string; text?: string; attrs?: Record<string, string> } = {}
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (options.className) node.className = options.className;
  if (options.text !== undefined) node.textContent = options.text;
  if (options.attrs) for (const [key, value] of Object.entries(options.attrs)) node.setAttribute(key, value);
  return node;
}

export function clear(node: Element): void {
  node.replaceChildren();
}

export function button(text: string, className = 'secondary-button'): HTMLButtonElement {
  return el('button', { className, text, attrs: { type: 'button' } });
}
