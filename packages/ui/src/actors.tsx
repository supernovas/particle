import { createContext, useContext, type ReactNode } from 'react';
import type { Actor, ActorId } from './types';

const ActorsContext = createContext<Record<ActorId, Actor>>({});

export function ActorsProvider({
  actors,
  children,
}: {
  actors: Record<ActorId, Actor>;
  children: ReactNode;
}) {
  return <ActorsContext.Provider value={actors}>{children}</ActorsContext.Provider>;
}

const FALLBACK: Actor = { kind: 'app', id: 'unknown', name: 'unknown' };

export function useActors(): (id: ActorId) => Actor {
  const actors = useContext(ActorsContext);
  return (id) => actors[id] ?? { ...FALLBACK, id, name: id };
}
