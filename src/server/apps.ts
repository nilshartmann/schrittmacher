import { execFile } from 'node:child_process';

/** Die Programme, in denen sich ein Ordner aus Schrittmacher öffnen lässt. */
export const OPEN_APPS = ['terminal', 'forklift', 'fork'] as const;

export type OpenApp = (typeof OPEN_APPS)[number];

/** Der Name des Programms für `open -a`; das Terminal ist iTerm2. */
const APP_NAMES: Record<OpenApp, string> = {
  terminal: 'iTerm',
  forklift: 'ForkLift',
  fork: 'Fork',
};

export function isOpenApp(value: unknown): value is OpenApp {
  return OPEN_APPS.includes(value as OpenApp);
}

/**
 * Öffnet einen Ordner mit `open -a` im Programm. Das geht, weil der Server auf demselben Mac
 * läuft wie die Programme. Der Pfad kommt ohne Shell als eigenes Argument an.
 */
export function openIn(app: OpenApp, path: string): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile('open', ['-a', APP_NAMES[app], path], (error, _stdout, stderr) => {
      if (error !== null) {
        reject(new Error(`${APP_NAMES[app]} ließ sich nicht öffnen: ${stderr.trim() || error.message}`));
        return;
      }
      resolve();
    });
  });
}
