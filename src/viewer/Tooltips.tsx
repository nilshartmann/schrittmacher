import { useEffect, useLayoutEffect, useRef, useState } from 'react';

/** Die Zeit in Millisekunden, die der Zeiger über einem Element ruht, bis der Tooltip erscheint. */
const DELAY = 500;

/** Der Abstand des Tooltips zu seinem Element und zum Rand des Fensters, in Pixeln. */
const GAP = 4;

/**
 * Der Text und der Platz eines Tooltips: links bündig mit dem Element, in der rechten Hälfte rechts.
 * `above` ist die Oberkante des Elements, für den Fall, dass unter ihm kein Platz ist.
 */
interface Tip {
  text: string;
  left?: number;
  right?: number;
  top: number;
  above: number;
}

/**
 * Tooltips für alle Elemente mit `data-tip`. Die Web-App aus Safari zeigt das Attribut `title`
 * nicht an, deshalb zeichnet die Seite den Tooltip selbst unter dem Element. Passt er dort nicht
 * mehr ins Fenster, steht er über dem Element.
 */
export function Tooltips() {
  const [tip, setTip] = useState<Tip | null>(null);
  const shown = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const element = shown.current;
    if (tip === null || element === null) {
      return;
    }
    const height = element.getBoundingClientRect().height;
    if (tip.top + height > window.innerHeight - GAP) {
      element.style.top = `${String(Math.max(GAP, tip.above - GAP - height))}px`;
    }
  }, [tip]);

  useEffect(() => {
    let timer: number | undefined;
    let shownFor: Element | null = null;
    const hide = () => {
      window.clearTimeout(timer);
      shownFor = null;
      setTip(null);
    };
    const onOver = (event: PointerEvent) => {
      const element = event.target instanceof Element ? event.target.closest('[data-tip]') : null;
      if (element === shownFor) {
        return;
      }
      hide();
      const text = element?.getAttribute('data-tip');
      if (element == null || text == null || text === '') {
        return;
      }
      shownFor = element;
      timer = window.setTimeout(() => {
        const box = element.getBoundingClientRect();
        const place = { top: box.bottom + GAP, above: box.top };
        setTip(
          box.left < window.innerWidth / 2
            ? { text, left: Math.max(GAP, box.left), ...place }
            : { text, right: Math.max(GAP, window.innerWidth - box.right), ...place },
        );
      }, DELAY);
    };
    document.addEventListener('pointerover', onOver);
    document.addEventListener('pointerdown', hide);
    window.addEventListener('scroll', hide, true);
    return () => {
      hide();
      document.removeEventListener('pointerover', onOver);
      document.removeEventListener('pointerdown', hide);
      window.removeEventListener('scroll', hide, true);
    };
  }, []);

  if (tip === null) {
    return null;
  }
  return (
    <div ref={shown} className="tooltip" role="tooltip" style={{ left: tip.left, right: tip.right, top: tip.top }}>
      {tip.text}
    </div>
  );
}
