/**
 * Shared ESLint plugin for pixel-agents project conventions.
 *
 * Rules:
 *   no-inline-colors  — flag hex/rgb/rgba/hsl/hsla color literals (centralize in constants)
 *   pixel-shadow      — flag box-shadow values not using var(--pixel-shadow) or 2px 2px 0px
 *   pixel-font        — flag font-family values not referencing FS Pixel Sans
 */

const HEX_COLOR = /#[0-9a-fA-F]{3,8}\b/;
const RGB_FUNC = /\brgba?\s*\(/;
const HSL_FUNC = /\bhsla?\s*\(/;
const COLOR_PATTERNS = [HEX_COLOR, RGB_FUNC, HSL_FUNC];

/** Check whether a raw string value contains a color literal. */
function containsColor(value) {
  return COLOR_PATTERNS.some((p) => p.test(value));
}

/** Check whether the node is inside a comment-like context (template literal tag, etc.) */
function isCommentOnly(value) {
  const trimmed = value.trim();
  return trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*');
}

const noInlineColors = {
  meta: {
    type: 'suggestion',
    docs: {
      description:
        'Disallow inline color literals (hex, rgb, rgba, hsl, hsla). Use shared constants or --pixel-* CSS tokens.',
    },
    schema: [],
    messages: {
      found: 'Use shared constants or `--pixel-*` tokens instead of inline color literals.',
    },
  },
  create(context) {
    return {
      Literal(node) {
        if (typeof node.value !== 'string') return;
        if (isCommentOnly(node.value)) return;
        if (containsColor(node.value)) {
          context.report({ node, messageId: 'found' });
        }
      },
      TemplateLiteral(node) {
        for (const quasi of node.quasis) {
          if (containsColor(quasi.value.raw)) {
            context.report({ node: quasi, messageId: 'found' });
          }
        }
      },
    };
  },
};

/**
 * Helper: check if an AST Property node has a key matching `boxShadow` or `box-shadow`.
 */
function isBoxShadowProperty(node) {
  if (node.type !== 'Property') return false;
  const key = node.key;
  if (key.type === 'Identifier' && key.name === 'boxShadow') return true;
  if (key.type === 'Literal' && key.value === 'box-shadow') return true;
  return false;
}

const pixelShadow = {
  meta: {
    type: 'suggestion',
    docs: {
      description:
        'Require box-shadow values to use var(--pixel-shadow) or the 2px 2px 0px pattern.',
    },
    schema: [],
    messages: {
      found: 'Use `var(--pixel-shadow)` or a hard offset `2px 2px 0px` shadow.',
    },
  },
  create(context) {
    return {
      Property(node) {
        if (!isBoxShadowProperty(node)) return;
        const value = node.value;
        if (value.type !== 'Literal' || typeof value.value !== 'string') return;
        const text = value.value;
        if (text.includes('var(--pixel-shadow)') || text.includes('2px 2px 0px')) return;
        context.report({ node: value, messageId: 'found' });
      },
    };
  },
};

/**
 * Helper: check if an AST Property node has a key matching `fontFamily` or `font-family`.
 */
function isFontFamilyProperty(node) {
  if (node.type !== 'Property') return false;
  const key = node.key;
  if (key.type === 'Identifier' && key.name === 'fontFamily') return true;
  if (key.type === 'Literal' && key.value === 'font-family') return true;
  return false;
}

const pixelFont = {
  meta: {
    type: 'suggestion',
    docs: {
      description: 'Require font-family values to reference FS Pixel Sans.',
    },
    schema: [],
    messages: {
      found: 'Use the FS Pixel Sans font for UI styling.',
    },
  },
  create(context) {
    return {
      Property(node) {
        if (!isFontFamilyProperty(node)) return;
        const value = node.value;
        if (value.type !== 'Literal' || typeof value.value !== 'string') return;
        if (value.value.includes('FS Pixel Sans')) return;
        context.report({ node: value, messageId: 'found' });
      },
    };
  },
};

const plugin = {
  meta: {
    name: 'eslint-plugin-pixel-agents',
    version: '1.0.0',
  },
  rules: {
    'no-inline-colors': noInlineColors,
    'pixel-shadow': pixelShadow,
    'pixel-font': pixelFont,
  },
};

export default plugin;
