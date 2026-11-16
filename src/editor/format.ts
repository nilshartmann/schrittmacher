import { format, resolveConfig } from 'prettier';

/**
 * Formatiert Markdown mit Prettier. Gilt für die Datei eine Konfiguration wie `.prettierrc` im
 * Repo, dann mit deren Einstellungen; sonst bleiben die Zeilenumbrüche im Fließtext, wie sie sind.
 */
export async function formatMarkdown(path: string, text: string): Promise<string> {
  const config = (await resolveConfig(path, { editorconfig: true })) ?? {};
  return format(text, { proseWrap: 'preserve', ...config, filepath: path, parser: 'markdown' });
}
