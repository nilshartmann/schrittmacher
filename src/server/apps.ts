import { execFile } from 'node:child_process';

/** Die Programme, in denen sich ein Ordner aus Schrittmacher öffnen lässt. */
export const OPEN_APPS = ['terminal', 'claude', 'forklift', 'fork'] as const;

export type OpenApp = (typeof OPEN_APPS)[number];

/** Der Name des Programms für `open -a`; das Terminal ist iTerm2, Claude Code läuft darin. */
const APP_NAMES: Record<OpenApp, string> = {
  terminal: 'iTerm',
  claude: 'iTerm',
  forklift: 'ForkLift',
  fork: 'Fork',
};

export function isOpenApp(value: unknown): value is OpenApp {
  return OPEN_APPS.includes(value as OpenApp);
}

/**
 * Öffnet einen Ordner mit `open -a` im Programm, Claude Code über `osascript` in iTerm. Das geht,
 * weil der Server auf demselben Mac läuft wie die Programme. Der Pfad kommt ohne Shell als eigenes
 * Argument an; nur für Claude Code steht er gequotet im Befehl, den iTerm in die Shell schreibt.
 */
export function openIn(app: OpenApp, path: string): Promise<void> {
  return app === 'claude'
    ? run('osascript', claudeScript(`cd ${quoted(path)} && claude`), app)
    : run('open', ['-a', APP_NAMES[app], path], app);
}

/**
 * Startet Claude Code im Ordner wie `openIn` und schickt gleich einen Prompt ab. Der Prompt steht
 * in einer Datei, weil iTerm jeden Zeilenumbruch im Befehl als Return tippen würde. Mit `addDir`
 * darf Claude auch dort lesen, etwa die Hinweise im Speicher.
 */
export function openClaude(path: string, start: { promptFile: string; addDir: string }): Promise<void> {
  // Der Prompt steht vor `--add-dir`, weil die Option mehrere Ordner nimmt und ihn sonst als Ordner liest.
  const command = `cd ${quoted(path)} && claude "$(cat ${quoted(start.promptFile)})" --add-dir ${quoted(start.addDir)}`;
  return run('osascript', claudeScript(command), 'claude');
}

/** Ein Text in einfachen Anführungszeichen für die Shell. */
function quoted(text: string): string {
  return `'${text.replaceAll("'", "'\\''")}'`;
}

function run(command: string, args: string[], app: OpenApp): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(command, args, (error, _stdout, stderr) => {
      if (error !== null) {
        reject(new Error(`${APP_NAMES[app]} ließ sich nicht öffnen: ${stderr.trim() || error.message}`));
        return;
      }
      resolve();
    });
  });
}

/**
 * Die Argumente für `osascript`, die ein neues Fenster in iTerm öffnen und darin den Befehl
 * ausführen. Startet iTerm erst, nimmt das Skript dessen erstes Fenster, statt ein zweites zu
 * öffnen. Der Befehl kommt als Argument an, nicht im Text des Skripts.
 */
function claudeScript(command: string): string[] {
  return [
    '-e', 'on run argv',
    '-e', 'tell application "iTerm"',
    '-e', 'set wasRunning to running',
    '-e', 'activate',
    '-e', 'if wasRunning or (count of windows) = 0 then',
    '-e', 'set target to (create window with default profile)',
    '-e', 'else',
    '-e', 'set target to current window',
    '-e', 'end if',
    '-e', 'tell current session of target to write text (item 1 of argv)',
    '-e', 'end tell',
    '-e', 'end run',
    '--', command,
  ];
}

/** Öffnet eine Datei mit Folien in PowerPoint. */
export function openInPowerPoint(file: string): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile('open', ['-a', 'Microsoft PowerPoint', file], (error, _stdout, stderr) => {
      if (error !== null) {
        reject(new Error(`PowerPoint ließ sich nicht öffnen: ${stderr.trim() || error.message}`));
        return;
      }
      resolve();
    });
  });
}

/** Öffnet eine Adresse mit `open` im Standardbrowser des Macs, nicht in der Web-App aus Safari. */
export function openInBrowser(url: string): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile('open', [url], (error, _stdout, stderr) => {
      if (error !== null) {
        reject(new Error(`Der Browser ließ sich nicht öffnen: ${stderr.trim() || error.message}`));
        return;
      }
      resolve();
    });
  });
}
