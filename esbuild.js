const esbuild = require("esbuild");
const fs = require("fs");
const path = require("path");

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');
const cliBuild = process.argv.includes('--cli');

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

async function buildExtension() {
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
	if (watch) {
		await ctx.watch();
	} else {
		await ctx.rebuild();
		await ctx.dispose();
		// Copy assets after build
		copyAssets();
	}
}

async function buildCli() {
	console.log('Building CLI...');
	const ctx = await esbuild.context({
		entryPoints: ['cli/main.ts'],
		bundle: true,
		format: 'cjs',
		minify: production,
		sourcemap: !production,
		sourcesContent: false,
		platform: 'node',
		outfile: 'dist/cli.js',
		alias: {
			'vscode': './cli/vscode-stub.ts',
		},
		banner: {
			js: '#!/usr/bin/env node',
		},
		logLevel: 'silent',
		plugins: [esbuildProblemMatcherPlugin],
	});
	if (watch) {
		await ctx.watch();
	} else {
		await ctx.rebuild();
		await ctx.dispose();
		// Copy assets for CLI too
		copyAssets();
		// Make CLI executable
		try {
			fs.chmodSync(path.join(__dirname, 'dist', 'cli.js'), '755');
		} catch { /* ignore on Windows */ }
		console.log('✓ CLI built → dist/cli.js');
	}
}

async function main() {
	if (cliBuild) {
		await buildCli();
	} else {
		await buildExtension();
	}
}

main().catch(e => {
	console.error(e);
	process.exit(1);
});
