'use client'

import { Suspense, useEffect, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { fetchFleet } from '@/lib/api'
import { createPluginsSocket } from '@/lib/socket'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import type { PluginRunPayload } from '@reshala-web/shared'

const STEPS = ['Server', 'Remnanode', 'xray-sni', 'UFW rules', 'Confirm'] as const
const SETUP_PLUGIN_ID = 'remnawave_setup_full_node'

interface FormState {
  serverName: string
  secretKey: string
  sniDomain: string
  cfApiToken: string
  copyCert: boolean
  certSourceIp: string
  panelApiIp: string
  metricsIp: string
}

export default function NodeSetupPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-background flex items-center justify-center text-muted-foreground">Loading…</div>}>
      <NodeSetupWizard />
    </Suspense>
  )
}

function NodeSetupWizard() {
  const searchParams = useSearchParams()
  const [step, setStep] = useState(0)
  const [form, setForm] = useState<FormState>({
    serverName: searchParams.get('server') ?? '',
    secretKey: '',
    sniDomain: '',
    cfApiToken: '',
    copyCert: false,
    certSourceIp: '',
    panelApiIp: '178.128.249.68',
    metricsIp: '188.225.56.179',
  })
  const [running, setRunning] = useState(false)
  const [output, setOutput] = useState<{ type: string; data: string }[]>([])
  const outputRef = useRef<HTMLDivElement>(null)
  const socketRef = useRef<ReturnType<typeof createPluginsSocket> | null>(null)

  const { data: groups = [] } = useQuery({ queryKey: ['fleet'], queryFn: fetchFleet })
  const allServers = groups.flatMap((g) => g.servers)

  useEffect(() => {
    if (outputRef.current) outputRef.current.scrollTop = outputRef.current.scrollHeight
  }, [output])

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  function launch() {
    setRunning(true)
    setOutput([])

    const envVars: Record<string, string> = {
      REMNA_SECRET_KEY_B64: btoa(form.secretKey),
      SNI_DOMAIN_B64: btoa(form.sniDomain),
      CF_API_TOKEN_B64: btoa(form.cfApiToken),
      COPY_CERT: form.copyCert ? 'y' : 'n',
      CERT_SOURCE_IP: form.certSourceIp,
      PANEL_API_IP: form.panelApiIp,
      METRICS_IP: form.metricsIp,
    }

    const socket = createPluginsSocket()
    socketRef.current = socket
    const payload: PluginRunPayload = {
      pluginId: SETUP_PLUGIN_ID,
      serverName: form.serverName,
      envVars,
    }

    socket.connect()
    socket.emit('run', payload)
    socket.on('output', (line: { type: string; data: string }) =>
      setOutput((prev) => [...prev, line]),
    )
    socket.on('done', () => { setRunning(false); socket.disconnect() })
    socket.on('error', (msg: string) => {
      setOutput((prev) => [...prev, { type: 'stderr', data: `Error: ${msg}` }])
      setRunning(false)
    })
  }

  const stepContent = [
    // Step 0: Server
    <div key="server" className="space-y-3">
      <label className="text-sm font-medium">Select server</label>
      <Select value={form.serverName} onChange={(e) => set('serverName', e.target.value)}>
        <option value="">— choose —</option>
        {allServers.map((s) => (
          <option key={s.name} value={s.name}>
            {s.name} ({s.ip})
          </option>
        ))}
      </Select>
    </div>,

    // Step 1: Remnanode
    <div key="remnanode" className="space-y-3">
      <label className="text-sm font-medium">Remnanode SECRET_KEY</label>
      <Input
        type="password"
        placeholder="Secret key"
        value={form.secretKey}
        onChange={(e) => set('secretKey', e.target.value)}
      />
    </div>,

    // Step 2: xray-sni
    <div key="sni" className="space-y-3">
      <div>
        <label className="text-sm font-medium">SNI Domain</label>
        <Input
          className="mt-1"
          placeholder="sni.example.com"
          value={form.sniDomain}
          onChange={(e) => set('sniDomain', e.target.value)}
        />
      </div>
      <div>
        <label className="text-sm font-medium">Cloudflare API Token</label>
        <Input
          className="mt-1"
          type="password"
          value={form.cfApiToken}
          onChange={(e) => set('cfApiToken', e.target.value)}
        />
      </div>
      <div className="flex items-center gap-2">
        <input
          type="checkbox"
          id="copyCert"
          checked={form.copyCert}
          onChange={(e) => set('copyCert', e.target.checked)}
        />
        <label htmlFor="copyCert" className="text-sm">Copy cert from another server</label>
      </div>
      {form.copyCert && (
        <div>
          <label className="text-sm font-medium">Cert source IP</label>
          <Input
            className="mt-1"
            placeholder="1.2.3.4"
            value={form.certSourceIp}
            onChange={(e) => set('certSourceIp', e.target.value)}
          />
        </div>
      )}
    </div>,

    // Step 3: UFW
    <div key="ufw" className="space-y-3">
      <div>
        <label className="text-sm font-medium">Panel API IP</label>
        <Input
          className="mt-1"
          value={form.panelApiIp}
          onChange={(e) => set('panelApiIp', e.target.value)}
        />
      </div>
      <div>
        <label className="text-sm font-medium">Metrics IP</label>
        <Input
          className="mt-1"
          value={form.metricsIp}
          onChange={(e) => set('metricsIp', e.target.value)}
        />
      </div>
    </div>,

    // Step 4: Confirm
    <div key="confirm" className="space-y-2 text-sm">
      <p><span className="text-muted-foreground">Server:</span> {form.serverName}</p>
      <p><span className="text-muted-foreground">SNI Domain:</span> {form.sniDomain}</p>
      <p><span className="text-muted-foreground">Copy cert:</span> {form.copyCert ? `yes (from ${form.certSourceIp})` : 'no'}</p>
      <p><span className="text-muted-foreground">Panel API IP:</span> {form.panelApiIp}</p>
      <p><span className="text-muted-foreground">Metrics IP:</span> {form.metricsIp}</p>
    </div>,
  ]

  return (
    <main className="min-h-screen bg-background">
      <header className="border-b border-border px-6 py-3 flex items-center gap-4">
        <a href="/" className="text-muted-foreground hover:text-foreground text-sm">← Fleet</a>
        <h1 className="font-bold">Node Setup Wizard</h1>
      </header>

      <div className="p-6 max-w-lg mx-auto">
        {/* Step indicator */}
        <div className="flex gap-2 mb-8">
          {STEPS.map((label, i) => (
            <div key={label} className="flex-1 text-center">
              <div
                className={`w-7 h-7 rounded-full mx-auto flex items-center justify-center text-xs font-bold mb-1 ${
                  i === step
                    ? 'bg-primary text-primary-foreground'
                    : i < step
                    ? 'bg-primary/30 text-primary'
                    : 'bg-muted text-muted-foreground'
                }`}
              >
                {i + 1}
              </div>
              <p className="text-xs text-muted-foreground hidden sm:block">{label}</p>
            </div>
          ))}
        </div>

        <div className="rounded-lg border border-border bg-card p-6 mb-6">
          {stepContent[step]}
        </div>

        {!running && (
          <div className="flex justify-between">
            <Button variant="outline" onClick={() => setStep((s) => s - 1)} disabled={step === 0}>
              Back
            </Button>
            {step < STEPS.length - 1 ? (
              <Button onClick={() => setStep((s) => s + 1)}>Next</Button>
            ) : (
              <Button onClick={launch} disabled={!form.serverName}>
                Launch Setup
              </Button>
            )}
          </div>
        )}

        {(running || output.length > 0) && (
          <div
            ref={outputRef}
            className="mt-6 bg-black rounded p-3 h-72 overflow-y-auto font-mono text-xs"
          >
            {running && <p className="text-yellow-400 mb-2">▶ Running setup…</p>}
            {output.map((line, i) => (
              <div key={i} className={line.type === 'stderr' ? 'text-red-400' : 'text-green-300'}>
                {line.data}
              </div>
            ))}
          </div>
        )}
      </div>
    </main>
  )
}
