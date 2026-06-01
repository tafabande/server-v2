export function createElement(
  tag,
  { className = "", text = undefined, attrs = {}, dataset = {}, children = [] } = {},
) {
  const element = document.createElement(tag);
  if (className) {
    element.className = className;
  }
  if (text !== undefined) {
    element.textContent = text;
  }

  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === null) continue;
    element.setAttribute(key, String(value));
  }

  for (const [key, value] of Object.entries(dataset)) {
    if (value === undefined || value === null) continue;
    element.dataset[key] = String(value);
  }

  for (const child of children) {
    if (!child) continue;
    element.append(child);
  }

  return element;
}

export function replaceChildren(target, children = []) {
  target.replaceChildren(...children.filter(Boolean));
}

export function escapeHtml(str) {
  if (typeof str !== "string") {
    return str;
  }
  return str.replace(/[&<>"']/g, (m) => {
    switch (m) {
      case "&": return "&amp;";
      case "<": return "&lt;";
      case ">": return "&gt;";
      case '"': return "&quot;";
      case "'": return "&#039;";
      default: return m;
    }
  });
}

