import * as fs from 'fs';
import * as path from 'path';

export function listJsonlFilesRecursive(rootDir: string): string[] {
	const files: string[] = [];
	const stack = [rootDir];
	while (stack.length > 0) {
		const dir = stack.pop();
		if (!dir) continue;
		let entries: fs.Dirent[];
		try {
			entries = fs.readdirSync(dir, { withFileTypes: true });
		} catch {
			continue;
		}
		for (const entry of entries) {
			const fullPath = path.join(dir, entry.name);
			if (entry.isDirectory()) {
				stack.push(fullPath);
			} else if (entry.isFile() && entry.name.endsWith('.jsonl')) {
				files.push(fullPath);
			}
		}
	}
	return files;
}
