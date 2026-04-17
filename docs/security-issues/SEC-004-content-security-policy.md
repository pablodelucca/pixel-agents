# Security Issue: SEC-004 - Missing Content Security Policy

## Finding Details

| Field | Value |
|-------|-------|
| **Finding ID** | SEC-004 |
| **Severity** | Medium |
| **CVSS Score** | 4.0 (estimated) |
| **Category** | Configuration |
| **Status** | Open |
| **Priority** | P1 - Immediate (within 7 days) |

## Description

The webview does not configure an explicit Content Security Policy (CSP). While VS Code provides default CSP restrictions for webviews, explicitly configuring a CSP is a security best practice that provides defense-in-depth against XSS attacks.

The current implementation enables scripts but does not specify allowed sources:

```typescript
// src/PixelAgentsViewProvider.ts:333
webviewView.webview.options = { enableScripts: true };
```

## Affected Files

- `src/PixelAgentsViewProvider.ts:333` - Webview options configuration
- `src/PixelAgentsViewProvider.ts:964-977` - `getWebviewContent()` function

### Current Implementation

```typescript
function getWebviewContent(webview: vscode.Webview, extensionUri: vscode.Uri): string {
  const distPath = vscode.Uri.joinPath(extensionUri, 'dist', 'webview');
  const indexPath = vscode.Uri.joinPath(distPath, 'index.html').fsPath;

  let html = fs.readFileSync(indexPath, 'utf-8');

  html = html.replace(/(href|src)="\.\/([^"]+)"/g, (_match, attr, filePath) => {
    const fileUri = vscode.Uri.joinPath(distPath, filePath);
    const webviewUri = webview.asWebviewUri(fileUri);
    return `${attr}="${webviewUri}"`;
  });

  return html;
  // Note: No CSP meta tag is added
}
```

## Risk Assessment

### Impact
- **Confidentiality**: Low - VS Code sandbox limits data access
- **Integrity**: Medium - Potential XSS could modify webview content
- **Availability**: Low - Limited DoS potential

### Mitigating Factors
- VS Code provides default CSP for webviews
- React's virtual DOM helps prevent many XSS vectors
- No `dangerouslySetInnerHTML` usage found in codebase
- No `innerHTML` with user data found

### Overall Risk
Medium - While VS Code provides defaults, explicit CSP is required for enterprise compliance and defense-in-depth.

## Remediation Steps

### Step 1: Generate CSP Nonce

Update `getWebviewContent()` to include CSP:

```typescript
function getWebviewContent(webview: vscode.Webview, extensionUri: vscode.Uri): string {
  const distPath = vscode.Uri.joinPath(extensionUri, 'dist', 'webview');
  const indexPath = vscode.Uri.joinPath(distPath, 'index.html').fsPath;

  // Generate nonce for inline scripts
  const nonce = getNonce();
  
  // Get CSP source for webview resources
  const cspSource = webview.cspSource;

  let html = fs.readFileSync(indexPath, 'utf-8');

  // Replace asset URLs
  html = html.replace(/(href|src)="\.\/([^"]+)"/g, (_match, attr, filePath) => {
    const fileUri = vscode.Uri.joinPath(distPath, filePath);
    const webviewUri = webview.asWebviewUri(fileUri);
    return `${attr}="${webviewUri}"`;
  });

  // Inject CSP meta tag
  const cspContent = [
    `default-src 'none'`,
    `img-src ${cspSource} data: blob:`,
    `script-src ${cspSource} 'nonce-${nonce}'`,
    `style-src ${cspSource} 'unsafe-inline'`,  // May be required for Tailwind CSS
    `font-src ${cspSource}`,
    `connect-src ${cspSource}`,
  ].join('; ');

  // Insert CSP before closing </head>
  html = html.replace(
    '</head>',
    `<meta http-equiv="Content-Security-Policy" content="${cspContent}">\n</head>`
  );

  // Add nonce to any inline scripts
  html = html.replace(/<script/g, `<script nonce="${nonce}"`);

  return html;
}

function getNonce(): string {
  let text = '';
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}
```

### Step 2: Update Webview Options

Add `localResourceRoots` restriction:

```typescript
webviewView.webview.options = {
  enableScripts: true,
  localResourceRoots: [
    vscode.Uri.joinPath(this.extensionUri, 'dist'),
  ],
};
```

### Step 3: Verify Vite Build Compatibility

Review Vite build output to ensure no CSP-violating patterns:

1. **Check for inline scripts in generated HTML**
   - Vite may inject inline scripts for module preloading
   - Use `build.modulePreload: false` if needed

2. **Review CSS handling**
   - Tailwind CSS is used; may require `'unsafe-inline'` for style-src
   - Or extract all styles to external files

```typescript
// webview-ui/vite.config.ts - Example CSP-friendly config
export default defineConfig({
  build: {
    // Disable module preload to avoid inline scripts
    modulePreload: false,
    cssCodeSplit: false,
  },
});
```

**Note**: Test thoroughly after any build configuration changes.

## Acceptance Criteria

- [ ] CSP meta tag added to webview HTML with:
  - [ ] `default-src 'none'` (deny by default)
  - [ ] `script-src` restricted to webview source + nonce
  - [ ] `style-src` restricted appropriately (may need 'unsafe-inline' for Tailwind)
  - [ ] `img-src` allows webview source, data:, and blob:
  - [ ] `font-src` restricted to webview source
  - [ ] `connect-src` restricted to webview source
- [ ] Nonce generated per webview instance
- [ ] `localResourceRoots` configured to restrict resource loading
- [ ] No CSP violation errors in Developer Tools console
- [ ] All webview functionality works correctly:
  - [ ] Canvas rendering
  - [ ] Fonts load correctly
  - [ ] Asset images display
  - [ ] React components function
- [ ] `docs/SECURITY_ANALYSIS.md` updated to mark as resolved

## Testing Requirements

1. **Manual Testing**
   - Open Developer Tools in the webview
   - Check Console for CSP violation errors
   - Verify all visual elements render correctly
   - Verify all interactive elements work

2. **Automated Testing**
   - Add E2E test to verify webview loads without CSP errors

3. **Regression Testing**
   - All existing E2E tests pass
   - Visual regression testing if available

## CSP Reference

### Directive Meanings

| Directive | Purpose |
|-----------|---------|
| `default-src` | Fallback for other directives |
| `script-src` | Valid script sources |
| `style-src` | Valid stylesheet sources |
| `img-src` | Valid image sources |
| `font-src` | Valid font sources |
| `connect-src` | Valid fetch/XHR targets |

### VS Code Webview CSP

VS Code provides `webview.cspSource` which returns a unique origin for the webview that should be used in CSP directives. This ensures resources are only loaded from the extension's webview context.

## References

- [VS Code Webview Security](https://code.visualstudio.com/api/extension-guides/webview#security)
- [MDN Content Security Policy](https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP)
- [OWASP CSP Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Content_Security_Policy_Cheat_Sheet.html)
- [CWE-693: Protection Mechanism Failure](https://cwe.mitre.org/data/definitions/693.html)

---

**Labels**: `security`, `compliance`, `priority: high`
