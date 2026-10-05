// Accurate typings for @neslinesli93/qpdf-wasm (its bundled ones omit FS.writeFile and the
// factory options we use). Wired up via `paths` in tsconfig.base.json.

export interface QpdfInstance {
  callMain: (args: string[]) => number;
  FS: {
    writeFile: (path: string, data: Uint8Array) => void;
    readFile: (path: string) => Uint8Array;
  };
}

export interface QpdfOptions {
  locateFile: (path: string) => string;
  thisProgram?: string;
}

export default function createModule(options: QpdfOptions): Promise<QpdfInstance>;
