# Pixel Agents -- Webview UI

This is the webview UI for the [Pixel Agents](../README.md) VS Code extension. It renders the animated pixel art office, characters, and layout editor inside a VS Code panel using React and Canvas 2D.

## Tech Stack

- React 19, TypeScript, Vite, Canvas 2D
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) for Fast Refresh via [SWC](https://swc.rs/)

## Development

### Browser-based dev server

You can work on the webview UI in your browser without launching the full VS Code extension host:

```bash
cd webview-ui
npm run dev
```

This starts a Vite dev server (usually at `http://localhost:5173`) with Hot Module Replacement. A companion WebSocket backend (`devServer.ts`) provides the missing extension host functionality -- spawning agents, watching transcript files, and forwarding events to the browser.

To preview the production build:

```bash
npm run preview
```

### Local model configuration

When running the dev server, agents are launched via the built-in local agent (`localAgent.js`) which talks to an OpenAI-compatible endpoint (e.g., LM Studio). Configuration is read from the project root `.env` file:

```bash
cp ../.env.example ../.env
# Edit ../.env with your local model settings
```

The dev server reads `PIXEL_AGENTS_BASE_URL`, `PIXEL_AGENTS_API_KEY`, `PIXEL_AGENTS_MODEL`, and `PIXEL_AGENTS_MAX_TOKENS` from this file and passes them to each spawned agent process. See the [Local Models section](../README.md#local-models-lm-studio) in the main README for full setup instructions.

### Building for production

```bash
npm run build
```

The output in `dist/` is bundled into the VS Code extension by the parent project's build step.

## ESLint Configuration

This project uses ESLint with TypeScript support. To enable type-aware lint rules for stricter checking:

```js
export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      tseslint.configs.recommendedTypeChecked,
      // Or for stricter rules:
      // tseslint.configs.strictTypeChecked,
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
])
```

You can also add [eslint-plugin-react-x](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-x) and [eslint-plugin-react-dom](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-dom) for React-specific lint rules.
