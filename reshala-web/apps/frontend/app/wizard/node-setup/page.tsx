'use client'

import { Suspense, useEffect, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { fetchFleet, readCert } from '@/lib/api'
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
  certSourceServerName: string
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
    certSourceServerName: '',
    panelApiIp: '178.128.249.68',
    metricsIp: '31.192.111.182',
  })
  const [running, setRunning] = useState(false)
  const [fetchingCert, setFetchingCert] = useState(false)
  const [output, setOutput] = useState<{ type: string; data: string }[]>([])
  const outputRef = useRef<HTMLDivElement>(null)
  const socketRef = useRef<ReturnType<typeof createPluginsSocket> | null>(null)

  const { data: groups = [] } = useQuery({ queryKey: ['fleet'], queryFn: fetchFleet })
  const allServers = groups.flatMap((g: any) => g.servers)
  const certSources = allServers.filter((s: any) => s.name !== form.serverName)

  useEffect(() => {
    if (outputRef.current) outputRef.current.scrollTop = outputRef.current.scrollHeight
  }, [output])

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  async function launch() {
    setRunning(true)
    setOutput([])

    const envVars: Record<string, string> = {
      REMNA_SECRET_KEY_B64: btoa(form.secretKey),
      SNI_DOMAIN_B64: btoa(form.sniDomain),
      CF_API_TOKEN_B64: btoa(form.cfApiToken),
      COPY_CERT: form.copyCert ? 'y' : 'n',
      PANEL_API_IP: form.panelApiIp,
      METRICS_IP: form.metricsIp,
    }

    // If copying cert — fetch it from source server via backend SSH
    if (form.copyCert && form.certSourceServerName) {
      setFetchingCert(true)
      setOutput([{ type: 'stdout', data: `[INFO] Fetching certificate from ${form.certSourceServerName}…` }])
      try {
        const cert = await readCert(form.certSourceServerName, form.sniDomain)
        if (!cert.crt || !cert.key) {
          setOutput((p) => [...p, { type: 'stderr', data: `[ERROR] Certificate not found on ${form.certSourceServerName}. Make sure xray-sni is running there.` }])
          setRunning(false)
          setFetchingCert(false)
          return
        }
        envVars.CERT_CRT_B64 = cert.crt
        envVars.CERT_KEY_B64 = cert.key
        if (cert.json) envVars.CERT_JSON_B64 = cert.json
        setOutput((p) => [...p, { type: 'stdout', data: `[INFO] Certificate fetched OK (crt=${cert.crt.length} chars).` }])
      } catch (e: any) {
        setOutput((p) => [...p, { type: 'stderr', data: `[ERROR] Failed to fetch cert: ${e?.message}` }])
        setRunning(false)
        setFetchingCert(false)
        return
      }
      setFetchingCert(false)
    }

    const socket = createPluginsSocket()
    socketRef.current = socket
    const payload: PluginRunPayload = {
      pluginId: SETUP_PLUGIN_ID,
      serverName: form.serverName,
      envVars,
    }

    socket.on('connect', () => socket.emit('run', payload))
    socket.on('output', (line: { type: string; data: string }) =>
      setOutput((prev) => [...prev, line]),
    )
    socket.on('done', () => { setRunning(false); socket.disconnect() })
    socket.on('error', (msg: unknown) => {
      const text = typeof msg === 'string' ? msg : (msg as any)?.message ?? JSON.stringify(msg)
      setOutput((prev) => [...prev, { type: 'stderr', data: `Error: ${text}` }])
      setRunning(false)
    })
    socket.connect()
  }

  const selectedCertSource = allServers.find((s: any) => s.name === form.certSourceServerName)

  const stepContent = [
    // Step 0: Server
    <div key="server" className="space-y-3">
      <label className="text-sm font-medium">Select server</label>
      <Select value={form.serverName} onChange={(e) => set('serverName', e.target.value)}>
        <option value="">— choose —</option>
        {allServers.map((s: any) => (
          <option key={s.name} value={s.name}>{s.name} ({s.ip})</option>
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
        <Input className="mt-1" placeholder="sni.example.com" value={form.sniDomain} onChange={(e) => set('sniDomain', e.target.value)} />
      </div>
      <div>
        <label className="text-sm font-medium">Cloudflare API Token</label>
        <Input className="mt-1" type="password" value={form.cfApiToken} onChange={(e) => set('cfApiToken', e.target.value)} />
      </div>
      <div className="flex items-center gap-2">
        <input type="checkbox" id="copyCert" checked={form.copyCert} onChange={(e) => set('copyCert', e.target.checked)} />
        <label htmlFor="copyCert" className="text-sm">Copy cert from existing node in this group</label>
      </div>
      {form.copyCert && (
        <div>
          <label className="text-sm font-medium">Source server</label>
          <Select className="mt-1" value={form.certSourceServerName} onChange={(e) => set('certSourceServerName', e.target.value)}>
            <option value="">— choose server —</option>
            {certSources.map((s: any) => (
              <option key={s.name} value={s.name}>{s.name} ({s.ip})</option>
            ))}
          </Select>
          <p className="text-xs text-muted-foreground mt-1">
            Backend will SSH into this server and copy the cert for <strong>{form.sniDomain || '…'}</strong>
          </p>
        </div>
      )}
    </div>,

    // Step 3: UFW
    <div key="ufw" className="space-y-3">
      <div>
        <label className="text-sm font-medium">Panel API IP (allowed on port 2222)</label>
        <Input className="mt-1" value={form.panelApiIp} onChange={(e) => set('panelApiIp', e.target.value)} />
      </div>
      <div>
        <label className="text-sm font-medium">Metrics IP (allowed on 9100 + 9200)</label>
        <Input className="mt-1" value={form.metricsIp} onChange={(e) => set('metricsIp', e.target.value)} />
      </div>
    </div>,

    // Step 4: Confirm
    <div key="confirm" className="space-y-2 text-sm">
      <p><span className="text-muted-foreground">Server:</span> <strong>{form.serverName}</strong></p>
      <p><span className="text-muted-foreground">SNI Domain:</span> {form.sniDomain}</p>
      <p><span className="text-muted-foreground">Copy cert:</span> {form.copyCert ? `yes (from ${form.certSourceServerName}${selectedCertSource ? ` / ${selectedCertSource.ip}` : ''})` : 'no'}</p>
      <p><span className="text-muted-foreground">Panel API IP:</span> {form.panelApiIp}</p>
      <p><span className="text-muted-foreground">Metrics IP:</span> {form.metricsIp}</p>
    </div>,
  ]

  const canLaunch = form.serverName && form.secretKey && form.sniDomain && form.cfApiToken &&
    (!form.copyCert || form.certSourceServerName)

  return (
    <main className="min-h-screen bg-background">
      <header className="border-b border-border px-6 py-3 flex items-center gap-4">
        <a href="/" className="text-muted-foreground hover:text-foreground text-sm">← Fleet</a>
        <h1 className="font-bold">Node Setup Wizard</h1>
      </header>

      <div className="p-6 max-w-lg mx-auto">
        <div className="flex gap-2 mb-8">
          {STEPS.map((label, i) => (
            <div key={label} className="flex-1 text-center">
              <div className={`w-7 h-7 rounded-full mx-auto flex items-center justify-center text-xs font-bold mb-1 ${
                i === step ? 'bg-primary text-primary-foreground' : i < step ? 'bg-primary/30 text-primary' : 'bg-muted text-muted-foreground'
              }`}>
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
              <Button onClick={() => setStep((s) => s + 1)} disabled={step === 0 && !form.serverName}>
                Next
              </Button>
            ) : (
              <Button onClick={launch} disabled={!canLaunch || fetchingCert}>
                {fetchingCert ? 'Fetching cert…' : 'Launch Setup'}
              </Button>
            )}
          </div>
        )}

        {(running || output.length > 0) && (
          <div ref={outputRef} className="mt-6 bg-black rounded p-3 h-96 overflow-y-auto font-mono text-xs">
            {running && output.length === 0 && <p className="text-yellow-400 mb-2">▶ Connecting…</p>}
            {output.map((line, i) => (
              <div key={i} className={line.type === 'stderr' ? 'text-red-400' : 'text-green-300'}>
                {line.data}
              </div>
            ))}
            {running && <p className="text-yellow-400 animate-pulse mt-1">▶ Running…</p>}
          </div>
        )}
      </div>
    </main>
  )
}
