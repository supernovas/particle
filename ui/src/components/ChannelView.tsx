import { useEffect, useRef } from 'react'
import type { Channel, Message, Project } from '../types'
import { ACTORS } from '../data'
import { Avatar } from './Avatar'
import { Composer } from './Composer'
import { ProjectCard } from './ProjectCard'

interface ChannelViewProps {
  channel: Channel
  messages: Message[]
  projects: Record<string, Project>
  selectedProjectId: string | null
  onOpenProject: (id: string) => void
  onSend: (text: string) => void
}

function MessageRow({
  message,
  project,
  selected,
  onOpenProject,
}: {
  message: Message
  project?: Project
  selected: boolean
  onOpenProject: (id: string) => void
}) {
  const author = ACTORS[message.authorId]
  return (
    <div className="msg">
      <Avatar actor={author} size={30} />
      <div className="msg-main">
        <div className="msg-head">
          <span className="msg-name">{author.kind === 'human' ? author.name : author.name}</span>
          {author.kind !== 'human' ? <span className="badge">{author.kind}</span> : null}
          <span className="msg-time">{message.time}</span>
        </div>
        <p className="msg-text">{message.text}</p>
        {project ? (
          <ProjectCard
            project={project}
            active={selected}
            onOpen={() => onOpenProject(project.id)}
          />
        ) : null}
      </div>
    </div>
  )
}

export function ChannelView(props: ChannelViewProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const count = props.messages.length

  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [count, props.channel.id])

  return (
    <section className="channel">
      <header className="pane-head">
        <div className="pane-head-text">
          <h1>
            <span className="hash">#</span>
            {props.channel.name}
          </h1>
          <p className="topic">{props.channel.topic}</p>
        </div>
      </header>

      <div className="msg-scroll" ref={scrollRef}>
        <div className="day-divider">
          <span>Today</span>
        </div>
        {props.messages.map((m) => (
          <MessageRow
            key={m.id}
            message={m}
            project={m.projectId ? props.projects[m.projectId] : undefined}
            selected={m.projectId != null && m.projectId === props.selectedProjectId}
            onOpenProject={props.onOpenProject}
          />
        ))}
      </div>

      <Composer
        placeholder={`Message #${props.channel.name} — a prompt starts a project`}
        hint="Enter to send · Shift+Enter for a new line"
        onSend={props.onSend}
      />
    </section>
  )
}
