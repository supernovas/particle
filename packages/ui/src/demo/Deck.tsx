import { useEffect, useState, type ReactNode } from 'react';
import { MockApp } from '../App';
import { IconMoon, IconSun, Logo } from '../components/icons';
import { Frame } from './Frame';
import { Shader } from './Shader';
import type { ShaderName } from './shaders';
import { GitRefs } from './GitRefs';
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
        <p className="sl-sub">an MMO harness that bootstrapped itself</p>
      </div>
    ),
  },
  {
    id: 'problem',
    bg: 'waves',
    render: () => (
      <ValueSlide
        kicker="problem"
        title="We built it because we needed it."
        sub="Luke and Kate were sharing a local “prompt repo” — PLAN.mds passed back and forth between two laptops."
      />
    ),
  },
  {
    id: 'solution',
    bg: 'flow',
    render: () => (
      <ValueSlide
        kicker="solution"
        title="A massively multiplayer harness"
        sub="Your whole org prompts together — every prompt, agent turn, and review in one shared, auditable space."
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
            <span className="tl-caption">the real workspace, running in this deck</span>
          </div>
        </div>
      </div>
    ),
  },
  {
    id: 'git',
    render: () => (
      <div className="sl-center">
        <div className="sl-kicker">how it works</div>
        <h1 className="sl-title sl-title-sm">Every project is a git ref</h1>
        <GitRefs />
        <div className="sl-bullets">
          <span>append-only · one writer per ref</span>
          <span>concurrent by construction — nobody can overwrite anybody</span>
          <span>plain git — any host works</span>
        </div>
      </div>
    ),
  },
  {
    id: 'timelapse',
    render: (active, replay, theme) => (
      <div className="sl-full">
        <div className="sl-kicker sl-kicker-top">
          particle bootstrapped itself — every repo update, 15 seconds
        </div>
        <Timelapse active={active} run={replay} theme={theme} />
      </div>
    ),
  },
  {
    id: 'close',
    bg: 'orbits',
    render: () => (
      <div className="sl-center">
        <h1 className="sl-title sl-title-sm">
          live at <span className="sl-accent">particle.supernova.ai</span>
        </h1>
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
