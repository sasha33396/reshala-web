'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { createPluginsSocket } from '@/lib/socket'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { PluginRunPayload } from '@reshala-web/shared'

interface Props {
  params: { name: string }
}

interface SecurityStatus {
  SSH_PORT?: string
  PASS_AUTH?: string
  UFW_STATUS?: string
  FAIL2BAN_STATUS?: string
  KERNEL_STATUS?: string
}

interface RunState {
  running: boolean
  output: { type: string; data: string }[]
}

export default function SecurityPage({ params }: Props) {
  const { name } = params
  const [status, setStatus] = useState<SecurityStatus | null>(null)
  const [statusLoading, setStatusLoading] = useState(false)
  const [activeCard, setActiveCard] = useState<string | null>(null)
  const [runState, setRunState] = useState<RunState>({ running: false, output: [] })
  const socketRef = useRef<ReturnType<typeof createPluginsSocket> | null>(null)

  function fetchStatus() {
    setStatusLoading(true)
    setStatus(null)
    const lines: { type: string; data: string }[] = []
    runPlugin('security_00_get_security_status', {}, (line) => lines.push(line), () => {
      const parsed: SecurityStatus = {}
      for (const l of lines) {
        const m = l.data.match(/^([A-Z_]+)=(.+)$/)
        if (m) (parsed as Record<string, string>)[m[1]] = m[2].trim()
      }
      setStatus(parsed)
      setStatusLoading(false)
    })
  }

  useEffect(() => { fetchStatus() }, [])

  function runPlugin(
    pluginId: string,
    envVars: Record<string, string>,
    onLine?: (l: { type: string; data: string }) => void,
    onDone?: () => void,
  ) {
    socketRef.current?.disconnect()
    const socket = createPluginsSocket()
    socketRef.current = socket

    setRunState({ running: true, output: [] })

    socket.on('connect', () => {
      const payload: PluginRunPayload = { pluginId, serverName: name, envVars }
      socket.emit('run', payload)
    })
    socket.on('output', (line: { type: string; data: string }) => {
      onLine?.(line)
      if (onDone === undefined) {
        setRunState((prev) => ({ ...prev, output: [...prev.output, line] }))
      }
    })
    socket.on('done', () => {
      setRunState((prev) => ({ ...prev, running: false }))
      socket.disconnect()
      onDone?.()
    })
    socket.on('error', () => { setRunState((prev) => ({ ...prev, running: false })); socket.disconnect(); onDone?.() })
    socket.connect()
  }

  function launch(pluginId: string, envVars: Record<string, string>) {
    setActiveCard(pluginId)
    runPlugin(pluginId, envVars)
  }

  useEffect(() => () => { socketRef.current?.disconnect() }, [])

  return (
    <main className="min-h-screen bg-background">
      <header className="border-b border-border px-6 py-3 flex items-center gap-4">
        <Link href={`/server/${name}`} className="text-muted-foreground hover:text-foreground text-sm">
          ← {name}
        </Link>
        <h1 className="font-bold text-lg">Security</h1>
      </header>

      <div className="p-6 max-w-screen-lg mx-auto space-y-5">
        {/* Status dashboard */}
        <section className="rounded-lg border border-border bg-card p-4 space-y-3">
          <div className="flex items-center justify-between">
            <p className="font-semibold text-sm">Security Status</p>
            <button
              onClick={fetchStatus}
              disabled={statusLoading}
              className="text-xs text-primary hover:underline disabled:opacity-50"
            >
              {statusLoading ? 'Refreshing…' : 'Refresh'}
            </button>
          </div>
          {statusLoading && !status && (
            <div className="flex gap-3">
              {[...Array(5)].map((_, i) => (
                <div key={i} className="h-10 w-28 bg-muted rounded animate-pulse" />
              ))}
            </div>
          )}
          {status && (
            <div className="flex flex-wrap gap-3">
              <StatusBadge label="SSH Port" value={status.SSH_PORT ?? '?'} neutral />
              <StatusBadge
                label="Password Auth"
                value={status.PASS_AUTH ?? '?'}
                ok={status.PASS_AUTH === 'no'}
                bad={status.PASS_AUTH === 'yes'}
              />
              <StatusBadge
                label="UFW"
                value={status.UFW_STATUS ?? '?'}
                ok={status.UFW_STATUS === 'active'}
                bad={status.UFW_STATUS === 'inactive' || status.UFW_STATUS === 'not_installed'}
              />
              <StatusBadge
                label="Fail2ban"
                value={status.FAIL2BAN_STATUS ?? '?'}
                ok={status.FAIL2BAN_STATUS === 'active'}
                bad={status.FAIL2BAN_STATUS === 'inactive' || status.FAIL2BAN_STATUS === 'not_installed'}
              />
              <StatusBadge
                label="Kernel Hardening"
                value={status.KERNEL_STATUS ?? '?'}
                ok={status.KERNEL_STATUS === 'applied'}
                warn={status.KERNEL_STATUS === 'mismatch'}
                bad={status.KERNEL_STATUS === 'not_applied'}
              />
            </div>
          )}
        </section>

        {/* Action cards */}
        <div className="grid gap-4 md:grid-cols-2">
          <HardenSSHCard
            active={activeCard === 'security_01_harden_ssh'}
            running={runState.running && activeCard === 'security_01_harden_ssh'}
            output={activeCard === 'security_01_harden_ssh' ? runState.output : []}
            onRun={(env) => launch('security_01_harden_ssh', env)}
          />
          <ChangePortCard
            active={activeCard === 'security_02_change_ssh_port'}
            running={runState.running && activeCard === 'security_02_change_ssh_port'}
            output={activeCard === 'security_02_change_ssh_port' ? runState.output : []}
            onRun={(env) => launch('security_02_change_ssh_port', env)}
          />
          <UFWCard
            active={activeCard === 'security_03_setup_ufw'}
            running={runState.running && activeCard === 'security_03_setup_ufw'}
            output={activeCard === 'security_03_setup_ufw' ? runState.output : []}
            onRun={(env) => launch('security_03_setup_ufw', env)}
          />
          <Fail2banCard
            active={activeCard === 'security_04_setup_fail2ban'}
            running={runState.running && activeCard === 'security_04_setup_fail2ban'}
            output={activeCard === 'security_04_setup_fail2ban' ? runState.output : []}
            onRun={(env) => launch('security_04_setup_fail2ban', env)}
          />
          <KernelCard
            active={activeCard === 'security_05_apply_kernel'}
            running={runState.running && activeCard === 'security_05_apply_kernel'}
            output={activeCard === 'security_05_apply_kernel' ? runState.output : []}
            onRun={() => launch('security_05_apply_kernel', {})}
          />
          <TelegramNotifyCard
            active={activeCard === 'security_06_setup_ssh_login_notify'}
            running={runState.running && activeCard === 'security_06_setup_ssh_login_notify'}
            output={activeCard === 'security_06_setup_ssh_login_notify' ? runState.output : []}
            onRun={(env) => launch('security_06_setup_ssh_login_notify', env)}
          />
        </div>
      </div>
    </main>
  )
}

/* ── Status badge ── */
function StatusBadge({
  label, value, ok, bad, warn, neutral,
}: {
  label: string; value: string
  ok?: boolean; bad?: boolean; warn?: boolean; neutral?: boolean
}) {
  const color = ok
    ? 'border-green-500/40 bg-green-500/10 text-green-400'
    : bad
    ? 'border-red-500/40 bg-red-500/10 text-red-400'
    : warn
    ? 'border-yellow-500/40 bg-yellow-500/10 text-yellow-400'
    : 'border-border bg-muted/40 text-muted-foreground'

  return (
    <div className={`rounded-lg border px-3 py-2 ${color}`}>
      <p className="text-xs opacity-70">{label}</p>
      <p className="font-mono font-semibold text-sm">{value}</p>
    </div>
  )
}

/* ── Shared action card wrapper ── */
function ActionCard({
  title, description, children, output, running, active,
}: {
  title: string; description: string
  children: React.ReactNode
  output: { type: string; data: string }[]
  running: boolean; active: boolean
}) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (ref.current) ref.current.scrollTop = ref.current.scrollHeight
  }, [output.length])

  return (
    <div className="rounded-lg border border-border bg-card p-4 space-y-3 flex flex-col">
      <div>
        <p className="font-semibold text-sm">{title}</p>
        <p className="text-xs text-muted-foreground mt-0.5">{description}</p>
      </div>
      <div className="space-y-2 flex-1">{children}</div>
      {active && output.length > 0 && (
        <div
          ref={ref}
          className="bg-black rounded p-2 h-36 overflow-y-auto font-mono text-xs border border-border"
        >
          {output.map((l, i) => (
            <div key={i} className={l.type === 'stderr' ? 'text-red-400' : 'text-green-300'}>
              {l.data}
            </div>
          ))}
        </div>
      )}
      {running && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
          Running…
        </div>
      )}
    </div>
  )
}

/* ── Individual cards ── */
function HardenSSHCard({ onRun, ...rest }: { onRun: (e: Record<string, string>) => void } & CardRest) {
  const [port, setPort] = useState('22')
  return (
    <ActionCard title="Harden SSH" description="Disable password auth, limit root login, set MaxAuthTries=3" {...rest}>
      <label className="text-xs text-muted-foreground">SSH Port</label>
      <Input value={port} onChange={(e) => setPort(e.target.value)} placeholder="22" />
      <Button size="sm" onClick={() => onRun({ TARGET_SSH_PORT: port })} disabled={rest.running}>
        Apply
      </Button>
    </ActionCard>
  )
}

function ChangePortCard({ onRun, ...rest }: { onRun: (e: Record<string, string>) => void } & CardRest) {
  const [oldPort, setOldPort] = useState('22')
  const [newPort, setNewPort] = useState('')
  return (
    <ActionCard title="Change SSH Port" description="Safely migrates SSH to a new port with UFW rule update and rollback on failure" {...rest}>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="text-xs text-muted-foreground">Current port</label>
          <Input value={oldPort} onChange={(e) => setOldPort(e.target.value)} placeholder="22" />
        </div>
        <div>
          <label className="text-xs text-muted-foreground">New port</label>
          <Input value={newPort} onChange={(e) => setNewPort(e.target.value)} placeholder="2222" />
        </div>
      </div>
      <Button
        size="sm"
        onClick={() => onRun({ OLD_SSH_PORT: oldPort, NEW_SSH_PORT: newPort })}
        disabled={rest.running || !newPort}
      >
        Change Port
      </Button>
    </ActionCard>
  )
}

function UFWCard({ onRun, ...rest }: { onRun: (e: Record<string, string>) => void } & CardRest) {
  const [sshPort, setSshPort] = useState('22')
  const [panelIp, setPanelIp] = useState('')
  const [adminIp, setAdminIp] = useState('')
  return (
    <ActionCard title="Setup UFW" description="Configure firewall: allow 443, SSH port, optional panel/admin IPs" {...rest}>
      <div className="space-y-1.5">
        <div>
          <label className="text-xs text-muted-foreground">SSH Port</label>
          <Input value={sshPort} onChange={(e) => setSshPort(e.target.value)} placeholder="22" />
        </div>
        <div>
          <label className="text-xs text-muted-foreground">Panel IP (optional, full access)</label>
          <Input value={panelIp} onChange={(e) => setPanelIp(e.target.value)} placeholder="1.2.3.4" />
        </div>
        <div>
          <label className="text-xs text-muted-foreground">Admin IP (optional, SSH only)</label>
          <Input value={adminIp} onChange={(e) => setAdminIp(e.target.value)} placeholder="1.2.3.4" />
        </div>
      </div>
      <Button
        size="sm"
        onClick={() => {
          const env: Record<string, string> = { SSH_PORT: sshPort }
          if (panelIp) env.PANEL_IP = panelIp
          if (adminIp) env.ADMIN_IP = adminIp
          onRun(env)
        }}
        disabled={rest.running || !sshPort}
      >
        Setup UFW
      </Button>
    </ActionCard>
  )
}

function Fail2banCard({ onRun, ...rest }: { onRun: (e: Record<string, string>) => void } & CardRest) {
  const [sshPort, setSshPort] = useState('22')
  return (
    <ActionCard title="Setup Fail2ban" description="Block brute-force: 3 attempts → 24h ban, monitors SSH logs" {...rest}>
      <label className="text-xs text-muted-foreground">SSH Port</label>
      <Input value={sshPort} onChange={(e) => setSshPort(e.target.value)} placeholder="22" />
      <Button size="sm" onClick={() => onRun({ SSH_PORT: sshPort })} disabled={rest.running || !sshPort}>
        Install & Configure
      </Button>
    </ActionCard>
  )
}

function KernelCard({ onRun, ...rest }: { onRun: () => void } & CardRest) {
  return (
    <ActionCard title="Kernel Hardening" description="Apply sysctl: SYN flood, IP spoofing, ASLR, ptrace scope, TCP tuning" {...rest}>
      <p className="text-xs text-muted-foreground">No parameters required.</p>
      <Button size="sm" onClick={onRun} disabled={rest.running}>
        Apply
      </Button>
    </ActionCard>
  )
}

function TelegramNotifyCard({ onRun, ...rest }: { onRun: (e: Record<string, string>) => void } & CardRest) {
  const [token, setToken] = useState('')
  const [chatId, setChatId] = useState('')
  return (
    <ActionCard title="SSH Login Notify" description="Telegram notification on every SSH login via PAM" {...rest}>
      <div className="space-y-1.5">
        <div>
          <label className="text-xs text-muted-foreground">Bot Token</label>
          <Input
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="123456:ABC-..."
          />
        </div>
        <div>
          <label className="text-xs text-muted-foreground">Chat ID</label>
          <Input value={chatId} onChange={(e) => setChatId(e.target.value)} placeholder="-100123456789" />
        </div>
      </div>
      <Button
        size="sm"
        onClick={() => onRun({ TG_BOT_TOKEN: token, TG_CHAT_ID: chatId })}
        disabled={rest.running || !token || !chatId}
      >
        Enable
      </Button>
    </ActionCard>
  )
}

type CardRest = {
  active: boolean
  running: boolean
  output: { type: string; data: string }[]
}
