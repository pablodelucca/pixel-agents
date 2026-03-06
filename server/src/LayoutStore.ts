import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

export class LayoutStore {
  private json = '{}';
  private etag = '';
  private readonly layoutFile: string;

  constructor(private readonly dataDir: string) {
    this.layoutFile = path.join(dataDir, 'layout.json');
  }

  getJson(): string { return this.json; }
  getEtag(): string { return this.etag; }

  load(): void {
    try {
      if (fs.existsSync(this.layoutFile)) {
        this.json = fs.readFileSync(this.layoutFile, 'utf-8');
        this.etag = this.computeEtag(this.json);
      }
    } catch { /* ignore load errors */ }
  }

  update(json: string): string {
    JSON.parse(json); // validate
    this.json = json;
    this.etag = this.computeEtag(json);
    this.save();
    return this.etag;
  }

  private save(): void {
    try {
      if (!fs.existsSync(this.dataDir)) {
        fs.mkdirSync(this.dataDir, { recursive: true });
      }
      const tmp = this.layoutFile + '.tmp';
      fs.writeFileSync(tmp, this.json, 'utf-8');
      fs.renameSync(tmp, this.layoutFile);
    } catch { /* ignore save errors */ }
  }

  private computeEtag(json: string): string {
    return crypto.createHash('md5').update(json).digest('hex');
  }
}
