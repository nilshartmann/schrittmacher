import { execFile } from 'node:child_process';

/** Die größte Ausgabe von Git, die gelesen wird; eine Datei im Workshop ist weit kleiner. */
const MAX_OUTPUT = 64 * 1024 * 1024;

/** Ein Fehler von Git, mit dem, was Git selbst dazu ausgegeben hat. */
export class GitError extends Error {
  constructor(
    message: string,
    readonly output: string,
  ) {
    super(message);
  }
}

/**
 * Führt Git im Verzeichnis aus und liefert die Ausgabe. `--no-optional-locks` sorgt dafür, dass
 * Git beim Lesen nichts am Repo schreibt, auch nicht den Index, wenn Fork parallel läuft. Die
 * Variablen in `env` ergänzen die Umgebung des Servers.
 */
export function runGit(cwd: string, args: string[], env: Record<string, string> = {}): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      'git',
      ['--no-optional-locks', ...args],
      { cwd, maxBuffer: MAX_OUTPUT, encoding: 'utf8', env: { ...process.env, ...env } },
      (error, stdout, stderr) => {
        if (error !== null) {
          const output = stderr.trim() || error.message;
          reject(new GitError(`git ${args.join(' ')} in ${cwd} scheiterte: ${output}`, output));
          return;
        }
        resolve(stdout);
      },
    );
  });
}
