import { execFile } from 'node:child_process';

/** Die größte Ausgabe von Git, die gelesen wird; eine Datei im Workshop ist weit kleiner. */
const MAX_OUTPUT = 64 * 1024 * 1024;

/**
 * Führt Git im Verzeichnis aus und liefert die Ausgabe. `--no-optional-locks` sorgt dafür, dass
 * Git beim Lesen nichts am Repo schreibt, auch nicht den Index, wenn Fork parallel läuft.
 */
export function runGit(cwd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      'git',
      ['--no-optional-locks', ...args],
      { cwd, maxBuffer: MAX_OUTPUT, encoding: 'utf8' },
      (error, stdout, stderr) => {
        if (error !== null) {
          reject(new Error(`git ${args.join(' ')} in ${cwd} scheiterte: ${stderr.trim() || error.message}`));
          return;
        }
        resolve(stdout);
      },
    );
  });
}
