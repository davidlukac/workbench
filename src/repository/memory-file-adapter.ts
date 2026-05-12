import type { FileAdapter } from "./file-adapter.js";

export class MemoryFileAdapter implements FileAdapter {
  readonly #files = new Map<string, string>();

  /** Test-only helper — pre-populate a path so readFile returns it. Not part of FileAdapter. */
  seed(path: string, content: string): void {
    this.#files.set(path, content);
  }

  async readFile(path: string, _encoding?: BufferEncoding): Promise<string> {
    const content = this.#files.get(path);
    if (content === undefined) {
      const err = new Error(`ENOENT: no such file or directory, open '${path}'`);
      (err as NodeJS.ErrnoException).code = "ENOENT";
      throw err;
    }
    return content;
  }

  async writeFile(path: string, data: string): Promise<void> {
    this.#files.set(path, data);
  }

  async mkdir(_path: string, _opts?: { recursive?: boolean }): Promise<void> {
    // no-op
  }
}
