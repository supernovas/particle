import { useEffect, useState } from 'react';
import { Workspace } from '../Workspace';
import { Frame } from './Frame';
import { BEATS, TL_ACTORS, timelapseState } from './story';

const STEP_MS = 1150;
const noop = () => undefined;

/**
 * The 15-second self-build replay: particle's first day folded into beats,
 * rendered inside the real workspace shell with subtitles.
 */
export function Timelapse({
  active,
  run,
  theme,
}: {
  active: boolean;
  run: number;
  theme?: 'light' | 'dark';
}) {
  const [beat, setBeat] = useState(0);
  const [replays, setReplays] = useState(0);

  useEffect(() => {
    if (!active) return;
    setBeat(0);
    const timer = window.setInterval(() => {
      setBeat((current) => {
        if (current >= BEATS.length - 1) {
          window.clearInterval(timer);
          return current;
        }
        return current + 1;
      });
    }, STEP_MS);
    return () => window.clearInterval(timer);
  }, [active, run, replays]);

  const state = timelapseState(beat);
  const done = beat >= BEATS.length - 1;

  return (
    <div className="tl">
      <Frame title="particle — supernovas/particle">
        <Workspace
          actors={TL_ACTORS}
          channels={[
            {
              id: 'github-issues',
              name: 'github-issues',
              topic: 'Projects from supernovas/particle issues',
            },
          ]}
          messages={state.messages}
          projects={state.projects}
          turns={state.turns}
          currentUserId="kate"
          workspaceLabel="supernovas/particle"
          mode="live"
          repoUrl="https://github.com/supernovas/particle"
          unreads={{}}
          channelId="github-issues"
          projectId={state.focus}
          onSelectChannel={noop}
          onJumpToProject={noop}
          onOpenProject={noop}
          onCloseProject={noop}
          onSendReply={noop}
          embedded
          theme={theme}
        />
      </Frame>
      <div className="tl-caption-row">
        <span className="tl-caption">{state.caption}</span>
        {done ? (
          <button className="tl-replay" onClick={() => setReplays((r) => r + 1)}>
            replay ↺
          </button>
        ) : null}
      </div>
    </div>
  );
}
