import { useEffect, useRef } from 'react';

export function useTopicMediaViewport(onViewportChange?: (visibleIndices: number[]) => void) {
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const element = containerRef.current;
    if (!element || !onViewportChange) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const visible: number[] = [];
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            const indexAttr = entry.target.getAttribute('data-index');
            if (indexAttr !== null) {
              visible.push(parseInt(indexAttr, 10));
            }
          }
        });
        if (visible.length > 0) {
          onViewportChange(visible);
        }
      },
      { root: element, threshold: 0.1 },
    );

    const children = element.querySelectorAll('[data-index]');
    children.forEach((child) => observer.observe(child));

    return () => {
      observer.disconnect();
    };
  }, [onViewportChange]);

  return containerRef;
}
