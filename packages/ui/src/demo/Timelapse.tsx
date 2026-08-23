import { useEffect, useState } from 'react';
import { Workspace } from '../Workspace';
import { Frame } from './Frame';
import { timelapseState, TL_ACTORS, TOTAL } from './story';

const DURATION_MS = 15_000;
const noop = () => undefined;

/** Every repo update, streamed through the real workspace in ~15 seconds. */
export function Timelapse({
  active,
  run,
  theme,
}: {
  active: boolean;
  run: number;
  theme?: 'light' | 'dark';
}) {
  const [count, setCount] = useState(0);
  const [replays, setReplays] = useState(0);

  useEffect(() => {
    if (!active) return;
    setCount(0);
    const timer = window.setInterval(() => {
      setCount((current) => {
        if (current >= TOTAL) {
          window.clearInterval(timer);
          return current;
        }
        return current + 1;
      });
    }, DURATION_MS / TOTAL);
    return () => window.clearInterval(timer);
  }, [active, run, replays]);

  const state = timelapseState(count);

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
          turns={[]}
          currentUserId="wildkakapo"
          workspaceLabel="supernovas/particle"
          mode="live"
          repoUrl="https://github.com/supernovas/particle"
          unreads={{}}
          channelId="github-issues"
          projectId={null}
          issues={state.issues}
          newIssueUrl="https://github.com/supernovas/particle/issues/new"
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
        {state.done ? (
          <button className="tl-replay" onClick={() => setReplays((r) => r + 1)}>
            replay ↺
          </button>
        ) : null}
      </div>
    </div>
  );
}
