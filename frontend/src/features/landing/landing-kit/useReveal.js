// frontend/src/features/landing/landing-kit/useReveal.js
import { useEffect } from 'react';

/**
 * Adds `.is-in` to every `.lk-reveal` element once it scrolls into view.
 * Purely additive — if IntersectionObserver is unavailable the elements are
 * revealed immediately so content is never trapped at opacity 0.
 */
export default function useReveal() {
  useEffect(() => {
    const nodes = document.querySelectorAll('.lk-reveal:not(.is-in)');
    if (!nodes.length) return undefined;

    if (typeof IntersectionObserver === 'undefined') {
      nodes.forEach((n) => n.classList.add('is-in'));
      return undefined;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add('is-in');
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.12, rootMargin: '0px 0px -40px 0px' }
    );

    nodes.forEach((n) => observer.observe(n));
    return () => observer.disconnect();
  });
}
