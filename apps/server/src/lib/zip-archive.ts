import * as archiverModule from 'archiver';

export interface ZipArchive {
  append(source: unknown, options?: unknown): this;
  file(source: string, options?: unknown): this;
  directory(source: string, destination?: string): this;
  pipe(destination: NodeJS.WritableStream): this;
  finalize(): Promise<void>;
  abort(): void;
  on(event: string, listener: (...args: any[]) => void): this;
}

const ZipArchiveCtor = (archiverModule as unknown as {
  ZipArchive: new (options?: unknown) => ZipArchive;
}).ZipArchive;

/** Archiver 8 is ESM-only and the older @types package has no ZipArchive type. */
export function createZipArchive(): ZipArchive {
  return new ZipArchiveCtor({ zlib: { level: 6 } });
}
