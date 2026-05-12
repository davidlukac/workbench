import { mkdir, readFile, writeFile } from "node:fs/promises";
import type { FileAdapter } from "./file-adapter.js";

export class FileSystemFileAdapter implements FileAdapter {
  async readFile(path: string, encoding: BufferEncoding = "utf-8"): Promise<string> {
    return readFile(path, encoding);
  }

  async writeFile(path: string, data: string): Promise<void> {
    await writeFile(path, data, "utf-8");
  }

  async mkdir(path: string, opts?: { recursive?: boolean }): Promise<void> {
    await mkdir(path, opts);
  }
}
