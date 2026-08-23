import { useEffect, useRef, useState, type ReactNode } from 'react';

const W = 1280;
const H = 720;

/**
 * A browser-window frame that renders the real workspace at 1280×720 and
 * scales it to fit the slide. `interactive` decides whether the embedded app
 * receives the pointer (live demo) or stays a pure exhibit (timelapse).
 */
export function Frame({
  children,
  title,
  interactive = false,
}: {
  children: ReactNode;
  title: string;
  interactive?: boolean;
}) {
  const stageRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.5);

  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const observer = new ResizeObserver(() => {
      const rect = el.getBoundingClientRect();
      setScale(Math.min(rect.width / W, rect.height / H, 1));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <div className="tl-stage" ref={stageRef}>
      <div className="tl-frame" style={{ width: W * scale, height: H * scale }}>
        <div className="tl-scale" style={{ width: W, height: H, transform: `scale(${scale})` }}>
          <div className="tl-chrome">
            <span className="tl-dot" />
            <span className="tl-dot" />
            <span className="tl-dot" />
            <span className="tl-url">{title}</span>
          </div>
          <div className={`tl-app${interactive ? '' : ' tl-inert'}`}>{children}</div>
        </div>
      </div>
    </div>
  );
}
