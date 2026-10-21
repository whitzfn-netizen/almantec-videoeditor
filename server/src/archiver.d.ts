declare module "archiver" {
  import type { Readable } from "node:stream";
  export class ZipArchive extends Readable {
    constructor(options?: { zlib?: { level?: number } });
    file(path: string, data: { name: string }): this;
    append(source: string | Buffer, data: { name: string }): this;
    finalize(): Promise<void>;
  }
}
