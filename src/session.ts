import * as fs from 'fs';

interface SessionData {
  cookies?: string;
}

export class Session {
  public data: SessionData = {};

  public constructor(
    private storagePath: string,
  ) {}

  public load(): void {
    if (fs.existsSync(this.storagePath)) {
      this.data = require(this.storagePath);
    }
  }

  public save(): void {
    const jsonAsStr = JSON.stringify(this.data, null, 2);
    fs.writeFileSync(this.storagePath, jsonAsStr);
  }

}
