/**
 * Die Symbole im Baum des Editors, angelehnt an den Explorer von VS Code: ein Ordner als Umriss,
 * bekannte Dateiarten als farbiges Kürzel, alle anderen Dateien als Blatt.
 */

/** Ein Ordner als Umriss, offen und geschlossen gleich. */
export function TreeFolderIcon() {
  return (
    <svg className="tree-icon" width={16} height={16} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M1.75 4.25c0-.7.55-1.25 1.25-1.25h3.1l1.5 1.5H13c.7 0 1.25.55 1.25 1.25v6.5c0 .7-.55 1.25-1.25 1.25H3c-.7 0-1.25-.55-1.25-1.25z"
        stroke="currentColor"
        strokeWidth={1.2}
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Ein Kürzel mit Farbe für eine Dateiart. */
interface Badge {
  text: string;
  color: string;
  /** Ein Kürzel ohne Fläche steht in der Farbe auf dem Grund, sonst weiß auf der Farbe. */
  plain?: boolean;
}

/** Die Kürzel der bekannten Dateiarten nach Endung. */
const BADGES: Record<string, Badge> = {
  md: { text: 'M↓', color: '#3b78e7', plain: true },
  markdown: { text: 'M↓', color: '#3b78e7', plain: true },
  ts: { text: 'TS', color: '#3178c6' },
  mts: { text: 'TS', color: '#3178c6' },
  tsx: { text: 'TS', color: '#1f9bd1' },
  js: { text: 'JS', color: '#e8c31a' },
  mjs: { text: 'JS', color: '#e8c31a' },
  cjs: { text: 'JS', color: '#e8c31a' },
  jsx: { text: 'JS', color: '#1f9bd1' },
  json: { text: '{}', color: '#9b5de5', plain: true },
  css: { text: '#', color: '#3d6fd8', plain: true },
  html: { text: '<>', color: '#e06c3c', plain: true },
  yaml: { text: 'Y', color: '#c94f4f', plain: true },
  yml: { text: 'Y', color: '#c94f4f', plain: true },
  java: { text: 'J', color: '#d9761c', plain: true },
  kt: { text: 'K', color: '#8c5cf6', plain: true },
  sh: { text: '$', color: '#4d9a4d', plain: true },
};

/** Das Symbol einer Datei nach ihrer Endung. */
export function TreeFileIcon({ name }: { name: string }) {
  const dot = name.lastIndexOf('.');
  const badge = dot > 0 ? BADGES[name.slice(dot + 1).toLowerCase()] : undefined;
  if (badge === undefined) {
    return (
      <svg className="tree-icon" width={16} height={16} viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <path
          d="M4 1.75h5l3.25 3.25v8c0 .7-.55 1.25-1.25 1.25H4c-.7 0-1.25-.55-1.25-1.25V3c0-.7.55-1.25 1.25-1.25z M9 1.75V5h3.25"
          stroke="currentColor"
          strokeWidth={1.2}
          strokeLinejoin="round"
        />
      </svg>
    );
  }
  return (
    <svg className="tree-icon" width={16} height={16} viewBox="0 0 16 16" aria-hidden="true">
      {badge.plain !== true && <rect x={1.5} y={2.5} width={13} height={11} rx={2} fill={badge.color} />}
      <text
        x={8}
        y={8.4}
        textAnchor="middle"
        dominantBaseline="middle"
        fontSize={badge.text.length === 1 ? 11 : badge.plain === true ? 10 : 7.5}
        fontWeight={700}
        fontFamily="-apple-system, system-ui, sans-serif"
        fill={badge.plain === true ? badge.color : '#fff'}
      >
        {badge.text}
      </text>
    </svg>
  );
}
