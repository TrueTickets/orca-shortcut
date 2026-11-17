// The one Node built-in the worker uses. Orca's plugin typings leave Node out, and Node resolves
// `node:` builtins in a worker as it would for any module (see plugin-authoring.md), so this
// declares only what the worker calls rather than pulling in all of @types/node.
declare module 'node:child_process' {
  export type ExecFileError = Error & { code?: number | string }
  export function execFile(
    file: string,
    args: readonly string[],
    options: { cwd?: string; timeout?: number },
    callback: (error: ExecFileError | null, stdout: string, stderr: string) => void
  ): unknown
}
