/**
 * Ein Wert, den alle Instanzen eines Server-Moduls teilen. Im Dev-Server laden Routen und
 * Server-Funktionen dieselbe Datei als getrennte Module, und eine Variable im Modul gäbe es dann
 * mehrmals. `create` läuft nur beim ersten Aufruf mit dem Schlüssel.
 */
export function shared<T>(key: string, create: () => T): T {
  const all = globalThis as typeof globalThis & { __schrittmacher?: Map<string, unknown> };
  all.__schrittmacher ??= new Map();
  if (!all.__schrittmacher.has(key)) {
    all.__schrittmacher.set(key, create());
  }
  return all.__schrittmacher.get(key) as T;
}
