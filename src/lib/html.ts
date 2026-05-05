const ALLOWED_TAGS = new Set([
  'a',
  'blockquote',
  'br',
  'code',
  'em',
  'h1',
  'h2',
  'h3',
  'hr',
  'img',
  'li',
  'ol',
  'p',
  'pre',
  'strong',
  'u',
  'ul',
]);

const ALLOWED_PROTOCOLS = ['http:', 'https:', 'mailto:', 'tel:'];

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function isSafeUrl(value: string): boolean {
  try {
    const url = new URL(value, window.location.origin);
    return ALLOWED_PROTOCOLS.includes(url.protocol);
  } catch {
    return false;
  }
}

export function safePostHtml(content: string): string {
  if (typeof window === 'undefined' || typeof DOMParser === 'undefined') {
    return escapeHtml(content);
  }

  const parser = new DOMParser();
  const document = parser.parseFromString(content, 'text/html');

  const sanitizeNode = (node: Node) => {
    if (node.nodeType === Node.COMMENT_NODE) {
      node.parentNode?.removeChild(node);
      return;
    }

    if (node.nodeType !== Node.ELEMENT_NODE) return;

    const element = node as HTMLElement;
    const tagName = element.tagName.toLowerCase();

    if (!ALLOWED_TAGS.has(tagName)) {
      const text = document.createTextNode(element.textContent ?? '');
      element.replaceWith(text);
      return;
    }

    Array.from(element.attributes).forEach((attribute) => {
      const name = attribute.name.toLowerCase();
      const value = attribute.value;
      const isAllowedLink = tagName === 'a' && name === 'href' && isSafeUrl(value);
      const isAllowedImage = tagName === 'img' && (name === 'src' || name === 'alt') && (name !== 'src' || isSafeUrl(value));
      const isAllowedClass = name === 'class';

      if (!isAllowedLink && !isAllowedImage && !isAllowedClass) {
        element.removeAttribute(attribute.name);
      }
    });

    if (tagName === 'a') {
      element.setAttribute('target', '_blank');
      element.setAttribute('rel', 'noopener noreferrer');
    }
  };

  Array.from(document.body.querySelectorAll('*')).forEach(sanitizeNode);
  return document.body.innerHTML;
}
