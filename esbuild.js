const esbuild = require("esbuild");
const fs = require("fs");
const path = require("path");

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

/**
 * Copy assets folder to dist/assets
 */
function copyAssets() {
	const srcDir = path.join(__dirname, 'webview-ui', 'public', 'assets');
	const dstDir = path.join(__dirname, 'dist', 'assets');

	if (fs.existsSync(srcDir)) {
		// Remove existing dist/assets if present
		if (fs.existsSync(dstDir)) {
			fs.rmSync(dstDir, { recursive: true });
		}

		// Copy recursively
		fs.cpSync(srcDir, dstDir, { recursive: true });
		console.log('✓ Copied assets/ → dist/assets/');
	} else {
		console.log('ℹ️  assets/ folder not found (optional)');
	}
}

/**
 * @type {import('esbuild').Plugin}
 */
const esbuildProblemMatcherPlugin = {
	name: 'esbuild-problem-matcher',

	setup(build) {
		build.onStart(() => {
			console.log('[watch] build started');
		});
		build.onEnd((result) => {
			result.errors.forEach(({ text, location }) => {
				console.error(`✘ [ERROR] ${text}`);
				console.error(`    ${location.file}:${location.line}:${location.column}:`);
			});
			console.log('[watch] build finished');
		});
	},
};

async function main() {
	// Build the VS Code extension
	const ctx = await esbuild.context({
		entryPoints: [
			'src/extension.ts'
		],
		bundle: true,
		format: 'cjs',
		minify: production,
		sourcemap: !production,
		sourcesContent: false,
		platform: 'node',
		outfile: 'dist/extension.js',
		external: ['vscode'],
		logLevel: 'silent',
		plugins: [
			/* add to the end of plugins array */
			esbuildProblemMatcherPlugin,
		],
	});

	// Build the local agent script (standalone Node.js)
	const agentCtx = await esbuild.context({
		entryPoints: ['src/localAgent.ts'],
		bundle: true,
		format: 'cjs',
		minify: production,
		sourcemap: !production,
		sourcesContent: false,
		platform: 'node',
		outfile: 'dist/localAgent.js',
		logLevel: 'silent',
		plugins: [esbuildProblemMatcherPlugin],
	});

	// Build the dev server (standalone Node.js)
	const devCtx = await esbuild.context({
		entryPoints: ['webview-ui/devServer.ts'],
		bundle: true,
		format: 'cjs',
		minify: production,
		sourcemap: !production,
		sourcesContent: false,
		platform: 'node',
		outfile: 'dist/devServer.js',
		logLevel: 'silent',
		plugins: [esbuildProblemMatcherPlugin],
	});

	if (watch) {
		await ctx.watch();
		await agentCtx.watch();
		await devCtx.watch();
	} else {
		await ctx.rebuild();
		await agentCtx.rebuild();
		await devCtx.rebuild();
		await ctx.dispose();
		await agentCtx.dispose();
		await devCtx.dispose();
		// Copy assets after build
		copyAssets();
	}
}

main().catch(e => {
	console.error(e);
	process.exit(1);
});
