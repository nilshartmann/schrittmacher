import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';

/** So lange zeigt ein Knopf zum Kopieren den Haken, in Millisekunden. */
const COPIED_FOR = 1200;

/**
 * Eine schwebende Leiste mit Knöpfen am rechten Rand ihres Elements. Sie erscheint nur, solange
 * der Zeiger über dem Element steht, und überdeckt dann den Text darunter. Das Element braucht
 * dafür die Klasse `hover-tools-host`.
 */
export function HoverTools({ children }: { children: ReactNode }) {
  return <span className="hover-tools">{children}</span>;
}

/** Ein Knopf, der `text` in die Zwischenablage legt und danach kurz einen Haken zeigt. */
export function CopyButton({ text, tip }: { text: string; tip: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) {
      return;
    }
    const timer = setTimeout(() => {
      setCopied(false);
    }, COPIED_FOR);
    return () => {
      clearTimeout(timer);
    };
  }, [copied]);
  return (
    <button
      type="button"
      className="hover-tool"
      aria-label={tip}
      data-tip={copied ? 'Kopiert' : tip}
      onClick={(event) => {
        event.stopPropagation();
        navigator.clipboard.writeText(text).then(
          () => {
            setCopied(true);
          },
          (error: unknown) => {
            console.error('Der Text ließ sich nicht kopieren.', error);
          },
        );
      }}
    >
      {copied ? <CheckIcon /> : <CopyIcon />}
    </button>
  );
}

/** Zwei Blätter übereinander, wie das Symbol zum Kopieren in macOS. */
function CopyIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
      <rect x="4.5" y="4.5" width="8" height="8" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.3" />
      <path d="M9.5 2.5v-.5a1 1 0 0 0-1-1h-6a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h.5" fill="none" stroke="currentColor" strokeWidth="1.3" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
      <path d="M2.5 7.5l3 3 6-7" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
