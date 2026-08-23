import { useEffect, useState, type ReactNode } from 'react';
import { MockApp } from '../App';
import { IconMoon, IconSun, Logo } from '../components/icons';
import { Frame } from './Frame';
import { Shader } from './Shader';
import type { ShaderName } from './shaders';
import { Timelapse } from './Timelapse';
import './deck.css';

interface Slide {
  id: string;
  bg?: ShaderName;
  render: (active: boolean, replay: number, theme: Theme, toggleTheme: () => void) => ReactNode;
}

function ValueSlide({
  kicker,
  title,
  sub,
  tag,
}: {
  kicker?: string;
  title: string;
  sub?: string;
  tag?: string;
}) {
  return (
    <div className="sl-center">
      {kicker ? <div className="sl-kicker">{kicker}</div> : null}
      <h1 className="sl-title">{title}</h1>
      {sub ? <p className="sl-sub">{sub}</p> : null}
      {tag ? <span className="sl-tag">{tag}</span> : null}
    </div>
  );
}

const SLIDES: Slide[] = [
  {
    id: 'title',
    bg: 'orbits',
    render: () => (
      <div className="sl-center">
        <div className="sl-logo">
          <Logo size={72} />
        </div>
        <h1 className="sl-title">particle</h1>
        <p className="sl-sub">the MMO harness that built itself</p>
      </div>
    ),
  },
  {
    id: 'timelapse',
    render: (active, replay, theme) => (
      <div className="sl-full">
        <div className="sl-kicker sl-kicker-top">one day, replayed in its own UI</div>
        <Timelapse active={active} run={replay} theme={theme} />
      </div>
    ),
  },
  {
    id: 'together',
    bg: 'flow',
    render: () => (
      <ValueSlide
        kicker="value"
        title="Your whole org prompts together"
        sub="Founders, sales, product, engineers — every prompt, every agent turn, every review, in one shared space."
      />
    ),
  },
  {
    id: 'live',
    render: (_active, _replay, theme, toggleTheme) => (
      <div className="sl-full">
        <div className="sl-kicker sl-kicker-top">live — click around</div>
        <div className="tl">
          <Frame title="particle — workspace" interactive>
            <MockApp offline={false} embedded theme={theme} onToggleTheme={toggleTheme} />
          </Frame>
          <div className="tl-caption-row">
            <span className="tl-caption">the same app you just watched build itself</span>
          </div>
        </div>
      </div>
    ),
  },
  {
    id: 'suggest',
    bg: 'julia',
    render: () => (
      <ValueSlide
        kicker="value"
        title="Agents suggest the next project"
        sub="A project converges → agents propose follow-ups → a human hits approve, and a new thread begins."
        tag="shipping next · issue #28"
      />
    ),
  },
  {
    id: 'proof',
    bg: 'waves',
    render: () => (
      <div className="sl-center">
        <h1 className="sl-title">Built in one day</h1>
        <div className="sl-stats">
          <div className="sl-stat">
            <span className="sl-stat-n">2</span>
            <span className="sl-stat-l">humans</span>
          </div>
          <div className="sl-stat">
            <span className="sl-stat-n">9</span>
            <span className="sl-stat-l">agents</span>
          </div>
          <div className="sl-stat">
            <span className="sl-stat-n">30</span>
            <span className="sl-stat-l">issues &amp; PRs</span>
          </div>
          <div className="sl-stat">
            <span className="sl-stat-n">12</span>
            <span className="sl-stat-l">PRs merged</span>
          </div>
        </div>
        <p className="sl-sub">
          Every pull request reviewed adversarially by Greptile — it caught real bugs before any
          human read the diff.
        </p>
      </div>
    ),
  },
  {
    id: 'close',
    bg: 'orbits',
    render: () => (
      <div className="sl-center">
        <h1 className="sl-title">We built it because we needed it.</h1>
        <p className="sl-sub">
          <code>github.com/supernovas/particle</code>
        </p>
      </div>
    ),
  },
];

type Theme = 'light' | 'dark';

function initialTheme(): Theme {
  const fromUrl = new URLSearchParams(window.location.search).get('theme');
  if (fromUrl === 'light' || fromUrl === 'dark') return fromUrl;
  const saved = window.localStorage.getItem('particle-theme');
  if (saved === 'light' || saved === 'dark') return saved;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function Deck() {
  const [index, setIndex] = useState(0);
  const [replay, setReplay] = useState(0);
  const [theme, setTheme] = useState<Theme>(initialTheme);

  // Share the preference with the app, but never touch document-level state.
  useEffect(() => {
    window.localStorage.setItem('particle-theme', theme);
  }, [theme]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'TEXTAREA' || target.tagName === 'INPUT')) return;
      if (e.key === 'ArrowRight' || e.key === ' ' || e.key === 'PageDown') {
        e.preventDefault();
        setIndex((i) => Math.min(i + 1, SLIDES.length - 1));
      } else if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
        e.preventDefault();
        setIndex((i) => Math.max(i - 1, 0));
      } else if (e.key === 'r') {
        setReplay((r) => r + 1);
      } else if (e.key === 't') {
        setTheme((t) => (t === 'dark' ? 'light' : 'dark'));
      } else if (e.key === 'f') {
        void document.documentElement.requestFullscreen?.();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="deck" data-theme={theme}>
      {SLIDES.map((slide, i) => (
        <section key={slide.id} className={`deck-slide${i === index ? ' active' : ''}`}>
          {slide.bg ? (
            <Shader name={slide.bg} active={i === index} light={theme === 'light'} />
          ) : null}
          <div className="deck-content">
            {slide.render(i === index, replay, theme, () =>
              setTheme((t) => (t === 'dark' ? 'light' : 'dark')),
            )}
          </div>
        </section>
      ))}
      <div className="deck-dots">
        {SLIDES.map((slide, i) => (
          <button
            key={slide.id}
            className={`deck-dot${i === index ? ' active' : ''}`}
            onClick={() => setIndex(i)}
            aria-label={`Slide ${i + 1}`}
          />
        ))}
      </div>
      <button
        className="deck-theme icon-btn"
        onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
        aria-label="Toggle theme"
        title="Toggle theme (t)"
      >
        {theme === 'dark' ? <IconSun /> : <IconMoon />}
      </button>
      <div className="deck-hint">← → · r replays · t theme · f fullscreen</div>
    </div>
  );
}
