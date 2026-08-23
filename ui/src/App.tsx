import { useEffect, useMemo, useRef, useState } from 'react'
import { ACTORS, CHANNELS, CURRENT_USER, MESSAGES, PROJECTS, SIM, TURNS } from './data'
import type { Message, Project, Turn } from './types'
import { ChannelView } from './components/ChannelView'
import { ProjectPane } from './components/ProjectPane'
import { Sidebar } from './components/Sidebar'

type Theme = 'light' | 'dark'

function initialTheme(): Theme {
  const fromUrl = new URLSearchParams(window.location.search).get('theme')
  if (fromUrl === 'light' || fromUrl === 'dark') return fromUrl
  const saved = window.localStorage.getItem('particle-theme')
  if (saved === 'light' || saved === 'dark') return saved
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

function now(): string {
  const d = new Date()
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

let seq = 0
function nextId(prefix: string): string {
  seq += 1
  return `${prefix}-local-${seq}`
}

export default function App() {
  const [theme, setTheme] = useState<Theme>(initialTheme)
  const [channelId, setChannelId] = useState('eng')
  const [projectId, setProjectId] = useState<string | null>('speed-up-ci')
  const [messages, setMessages] = useState<Message[]>(MESSAGES)
  const [turns, setTurns] = useState<Turn[]>(TURNS)
  const [projects, setProjects] = useState<Project[]>(PROJECTS)
  const [unreads, setUnreads] = useState<Record<string, number>>(() =>
    Object.fromEntries(CHANNELS.filter((c) => c.unread).map((c) => [c.id, c.unread ?? 0])),
  )
  const [paused, setPaused] = useState(false)
  const timers = useRef<number[]>([])

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    window.localStorage.setItem('particle-theme', theme)
  }, [theme])

  // Scripted mock feed: one pass of the implement → review loop, then quiet.
  useEffect(() => {
    for (const ev of SIM) {
      timers.current.push(
        window.setTimeout(() => {
          setTurns((prev) => [...prev, ev.turn])
          if (ev.project) {
            setProjects((prev) =>
              prev.map((p) => (p.id === ev.project?.id ? { ...p, ...ev.project } : p)),
            )
          }
          if (ev.task) {
            setProjects((prev) =>
              prev.map((p) =>
                p.id === ev.task?.projectId
                  ? {
                      ...p,
                      tasks: p.tasks.map((t) =>
                        t.id === ev.task?.taskId ? { ...t, state: ev.task.state } : t,
                      ),
                    }
                  : p,
              ),
            )
          }
        }, ev.delay),
      )
    }
    return () => {
      timers.current.forEach((t) => window.clearTimeout(t))
      timers.current = []
    }
  }, [])

  const projectsById = useMemo(() => Object.fromEntries(projects.map((p) => [p.id, p])), [projects])
  const channel = CHANNELS.find((c) => c.id === channelId) ?? CHANNELS[0]
  const project = projectId ? (projectsById[projectId] ?? null) : null

  function selectChannel(id: string) {
    setChannelId(id)
    setUnreads((u) => (u[id] ? { ...u, [id]: 0 } : u))
  }

  /** Open a project and follow it to its home channel (sidebar navigation). */
  function jumpToProject(id: string) {
    setProjectId(id)
    const home = projectsById[id]?.channelId
    if (home && home !== channelId) selectChannel(home)
  }

  function sendMessage(text: string) {
    setMessages((prev) => [
      ...prev,
      { id: nextId('m'), channelId: channel.id, authorId: CURRENT_USER, time: now(), text },
    ])
  }

  function sendReply(text: string) {
    if (!project) return
    setTurns((prev) => [
      ...prev,
      {
        id: nextId('t'),
        projectId: project.id,
        actorId: CURRENT_USER,
        kind: 'comment',
        time: now(),
        title: text,
      },
    ])
  }

  function togglePause() {
    if (!project) return
    const me = ACTORS[CURRENT_USER]
    const name = me.kind === 'human' ? me.handle : me.name
    if (!paused) {
      timers.current.forEach((t) => window.clearTimeout(t))
      timers.current = []
    }
    setPaused(!paused)
    setTurns((prev) => [
      ...prev,
      {
        id: nextId('t'),
        projectId: project.id,
        actorId: CURRENT_USER,
        kind: 'status',
        time: now(),
        title: paused ? `${name} resumed the agents` : `${name} paused the agents`,
      },
    ])
  }

  const channelMessages = messages.filter((m) => m.channelId === channel.id)
  const projectTurns = project ? turns.filter((t) => t.projectId === project.id) : []

  return (
    <div className={`app${project ? '' : ' no-detail'}`}>
      <Sidebar
        channels={CHANNELS}
        projects={projects}
        unreads={unreads}
        channelId={channel.id}
        projectId={projectId}
        theme={theme}
        onSelectChannel={selectChannel}
        onOpenProject={jumpToProject}
        onToggleTheme={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
      />
      <ChannelView
        channel={channel}
        messages={channelMessages}
        projects={projectsById}
        selectedProjectId={projectId}
        onOpenProject={setProjectId}
        onSend={sendMessage}
      />
      {project ? (
        <ProjectPane
          project={project}
          turns={projectTurns}
          paused={paused}
          onClose={() => setProjectId(null)}
          onTogglePause={togglePause}
          onReply={sendReply}
        />
      ) : null}
    </div>
  )
}
