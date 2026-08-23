import type { Channel, Project } from '../types'
import { ACTORS, CURRENT_USER } from '../data'
import { Avatar } from './Avatar'
import { IconMoon, IconSun, Logo } from './icons'
import { STATUS_LABEL, StatusDot } from './StatusChip'

interface SidebarProps {
  channels: Channel[]
  projects: Project[]
  unreads: Record<string, number>
  channelId: string
  projectId: string | null
  theme: 'light' | 'dark'
  onSelectChannel: (id: string) => void
  onOpenProject: (id: string) => void
  onToggleTheme: () => void
}

export function Sidebar(props: SidebarProps) {
  const me = ACTORS[CURRENT_USER]
  const settled = new Set(['merged', 'failed'])
  const ordered = [
    ...props.projects.filter((p) => !settled.has(p.status)),
    ...props.projects.filter((p) => settled.has(p.status)),
  ]

  return (
    <aside className="sidebar">
      <div className="side-head">
        <Logo size={22} />
        <div className="side-title">
          <strong>particle</strong>
          <span>Supernovas</span>
        </div>
      </div>

      <nav className="side-scroll">
        <div className="side-label">Channels</div>
        {props.channels.map((c) => {
          const unread = props.unreads[c.id] ?? 0
          const active = c.id === props.channelId
          return (
            <button
              key={c.id}
              className={`side-item chan-item${active ? ' active' : ''}${unread ? ' unread' : ''}`}
              onClick={() => props.onSelectChannel(c.id)}
            >
              <span className="chan-hash">#</span>
              <span className="side-item-title">{c.name}</span>
              {unread ? <span className="unread-badge">{unread}</span> : null}
            </button>
          )
        })}

        <div className="side-label">Projects</div>
        {ordered.map((p) => {
          const active = p.id === props.projectId
          return (
            <button
              key={p.id}
              className={`side-item proj-item${active ? ' active' : ''}`}
              onClick={() => props.onOpenProject(p.id)}
              title={`${p.title} — ${STATUS_LABEL[p.status]} · #${p.channelId}`}
            >
              <StatusDot status={p.status} />
              <span className="side-item-title">{p.title}</span>
            </button>
          )
        })}
      </nav>

      <div className="side-foot">
        <Avatar actor={me} size={26} />
        <div className="side-me">
          <strong>{me.kind === 'human' ? me.name : me.id}</strong>
          <span className="presence">online</span>
        </div>
        <button
          className="icon-btn"
          onClick={props.onToggleTheme}
          aria-label="Toggle theme"
          title="Toggle theme"
        >
          {props.theme === 'dark' ? <IconSun /> : <IconMoon />}
        </button>
      </div>
    </aside>
  )
}
