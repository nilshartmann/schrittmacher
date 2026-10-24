import { useEffect, useState } from 'react';

/** Die Zeit in Millisekunden, die der Zeiger über einem Element ruht, bis der Tooltip erscheint. */
const DELAY = 500;

/** Der Text und der Platz eines Tooltips: links bündig mit dem Element, in der rechten Hälfte rechts. */
interface Tip {
  text: string;
  left?: number;
  right?: number;
  top: number;
}

/**
 * Tooltips für alle Elemente mit `data-tip`. Die Web-App aus Safari zeigt das Attribut `title`
 * nicht an, deshalb zeichnet die Seite den Tooltip selbst unter dem Element.
 */
export function Tooltips() {
  const [tip, setTip] = useState<Tip | null>(null);

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
        const top = box.bottom + 4;
        setTip(
          box.left < window.innerWidth / 2
            ? { text, left: Math.max(4, box.left), top }
            : { text, right: Math.max(4, window.innerWidth - box.right), top },
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
    <div className="tooltip" role="tooltip" style={{ left: tip.left, right: tip.right, top: tip.top }}>
      {tip.text}
    </div>
  );
}
