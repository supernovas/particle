import type { Actor } from '../types';
import type { CSSProperties } from 'react';
import { Logo } from './icons';

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  const first = parts[0]?.[0] ?? '?';
  const last = parts.length > 1 ? parts[parts.length - 1][0] : '';
  return (first + last).toUpperCase();
}

/** Agents get a short role mark: P, I1, I2, R. */
function agentMark(name: string, role: string): string {
  const n = name.match(/\d+/)?.[0] ?? '';
  return role[0].toUpperCase() + n;
}

function Face({ url }: { url: string }) {
  return (
    <img
      className="avatar-img"
      src={url}
      alt=""
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={(e) => {
        e.currentTarget.style.display = 'none';
      }}
    />
  );
}

export function Avatar({ actor, size = 28 }: { actor: Actor; size?: number }) {
  const style = { width: size, height: size, fontSize: Math.round(size * 0.38) } as CSSProperties;

  if (actor.kind === 'human') {
    return (
      <span
        className="avatar avatar-human"
        style={{ ...style, '--h': actor.hue } as CSSProperties}
        title={actor.name}
      >
        {initials(actor.name)}
        {actor.avatarUrl ? <Face url={actor.avatarUrl} /> : null}
      </span>
    );
  }
  if (actor.kind === 'agent') {
    return (
      <span className="avatar avatar-agent" style={style} title={`${actor.name} · ${actor.role}`}>
        {agentMark(actor.name, actor.role)}
        {actor.avatarUrl ? <Face url={actor.avatarUrl} /> : null}
      </span>
    );
  }
  return (
    <span className="avatar avatar-app" style={style} title={actor.name}>
      <Logo size={Math.round(size * 0.66)} />
      {actor.avatarUrl ? <Face url={actor.avatarUrl} /> : null}
    </span>
  );
}

export function Facepile({ actors, size = 18 }: { actors: Actor[]; size?: number }) {
  return (
    <span className="facepile">
      {actors.map((a) => (
        <Avatar key={a.id} actor={a} size={size} />
      ))}
    </span>
  );
}
