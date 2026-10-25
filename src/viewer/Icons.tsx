/**
 * Ein Branch als Symbol im Text: eine Linie mit einem abzweigenden Ast. Es ist so groß wie die
 * Schrift daneben und ersetzt das Zeichen ⑂, das klein wie ein Pfeil nach unten aussieht.
 */
export function BranchIcon() {
  return (
    <svg className="icon-inline" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M5 4.5v7M11 6c0 3-6 2.5-6 5.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="5" cy="3.25" r="1.75" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="5" cy="12.75" r="1.75" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="11" cy="4.25" r="1.75" fill="none" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

/** Ein Ordner als Symbol für das Repo. */
export function RepoIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
      <path
        d="M2 4.5c0-.8.7-1.5 1.5-1.5h3.6l1.6 2h5.8c.8 0 1.5.7 1.5 1.5v7c0 .8-.7 1.5-1.5 1.5h-11C2.7 15 2 14.3 2 13.5z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </svg>
  );
}
