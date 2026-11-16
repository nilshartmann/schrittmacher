import { format, getFileInfo, resolveConfig } from 'prettier';

/** Der Parser, mit dem Prettier eine Datei nach ihrem Namen formatiert; `null`, wenn es keinen kennt. */
export async function formatterOf(path: string): Promise<string | null> {
  return (await getFileInfo(path, { resolveConfig: false })).inferredParser;
}

/**
 * Formatiert den Text einer Datei mit Prettier, mit dem Parser zu ihrem Namen. Gilt für die Datei
 * eine Konfiguration wie `.prettierrc` im Repo, dann mit deren Einstellungen; sonst bleiben in
 * Markdown die Zeilenumbrüche im Fließtext, wie sie sind.
 */
export async function formatText(path: string, text: string): Promise<string> {
  const parser = await formatterOf(path);
  if (parser === null) {
    throw new Error('Für diese Art von Datei kennt Prettier keine Formatierung.');
  }
  const config = (await resolveConfig(path, { editorconfig: true })) ?? {};
  return format(text, { proseWrap: 'preserve', ...config, filepath: path, parser });
}
