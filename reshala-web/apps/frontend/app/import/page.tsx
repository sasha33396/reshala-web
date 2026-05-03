'use client'

import { useState, useRef, DragEvent } from 'react'
import Link from 'next/link'
import { importFleet } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'

interface PreviewRow {
  name: string
  ip: string
  sudoPass: string
}

interface ImportResult {
  added: number
  skipped: number
  errors: string[]
  provisioned?: number
  provisionFailed?: number
}

function parsePreview(content: string): PreviewRow[] {
  return content
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => {
      const [name, ip, sudoPass] = l.split('\t')
      return { name: name ?? '', ip: ip ?? '', sudoPass: sudoPass ?? '' }
    })
    .filter((r) => r.name && r.ip)
}

export default function ImportPage() {
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<PreviewRow[]>([])
  const [dragging, setDragging] = useState(false)
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<ImportResult | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  function handleFile(f: File) {
    setFile(f)
    setResult(null)
    const reader = new FileReader()
    reader.onload = (e) => {
      const text = e.target?.result as string
      setPreview(parsePreview(text))
    }
    reader.readAsText(f)
  }

  function onDrop(e: DragEvent) {
    e.preventDefault()
    setDragging(false)
    const f = e.dataTransfer.files[0]
    if (f) handleFile(f)
  }

  async function doImport() {
    if (!file) return
    setLoading(true)
    try {
      const res = await importFleet(file)
      setResult(res)
    } catch (err: any) {
      setResult({ added: 0, skipped: 0, errors: [err.message] })
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="min-h-screen bg-background">
      <header className="border-b border-border px-6 py-3 flex items-center gap-4">
        <Link href="/" className="text-muted-foreground hover:text-foreground text-sm">
          ← Флот
        </Link>
        <h1 className="font-bold">Импорт флота</h1>
      </header>

      <div className="p-6 max-w-2xl mx-auto space-y-6">
        <p className="text-sm text-muted-foreground">
          Загрузи файл <code className="text-foreground">servers.txt</code> со столбцами через табуляцию:
          <strong> имя</strong>, <strong>IP</strong>, <strong>sudo-пароль</strong>.
        </p>

        {/* Drop zone */}
        <div
          onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          onClick={() => inputRef.current?.click()}
          className={`border-2 border-dashed rounded-lg p-10 text-center cursor-pointer transition-colors ${
            dragging ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/50'
          }`}
        >
          <input
            ref={inputRef}
            type="file"
            accept=".txt"
            className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f) }}
          />
          <p className="text-muted-foreground text-sm">
            {file ? file.name : 'Перетащи servers.txt или кликни, чтобы выбрать файл'}
          </p>
        </div>

        {/* Preview */}
        {preview.length > 0 && (
          <div>
            <p className="text-sm font-medium mb-2">К импорту: {preview.length} серверов</p>
            <div className="rounded border border-border overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-muted">
                  <tr>
                    <th className="text-left px-3 py-2">Имя</th>
                    <th className="text-left px-3 py-2">IP</th>
                    <th className="text-left px-3 py-2">Пароль</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.slice(0, 50).map((row, i) => (
                    <tr key={i} className="border-t border-border">
                      <td className="px-3 py-1.5 font-mono text-xs">{row.name}</td>
                      <td className="px-3 py-1.5 font-mono text-xs">{row.ip}</td>
                      <td className="px-3 py-1.5 text-xs text-muted-foreground">
                        {row.sudoPass ? '●●●●' : '—'}
                      </td>
                    </tr>
                  ))}
                  {preview.length > 50 && (
                    <tr className="border-t border-border">
                      <td colSpan={3} className="px-3 py-1.5 text-xs text-muted-foreground">
                        … и ещё {preview.length - 50}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Import button */}
        {preview.length > 0 && !result && (
          <Button onClick={doImport} disabled={loading}>
            {loading ? 'Импортируем...' : `Импортировать ${preview.length} серверов`}
          </Button>
        )}

        {loading && <Progress value={undefined} className="w-full" />}

        {/* Result */}
        {result && (
          <div className="rounded-lg border border-border p-4 space-y-2">
            <p className="font-medium">Импорт завершён</p>
            <p className="text-sm text-green-400">✓ Добавлено: {result.added}</p>
            <p className="text-sm text-muted-foreground">⟳ Пропущено: {result.skipped}</p>
            {result.provisioned !== undefined && (
              <p className="text-sm text-green-400">🔑 Ключи развёрнуты: {result.provisioned}</p>
            )}
            {result.provisionFailed !== undefined && result.provisionFailed > 0 && (
              <p className="text-sm text-yellow-400">⚠ Не удалось развернуть ключи: {result.provisionFailed} (запусти "Развернуть всем" позже)</p>
            )}
            {result.errors.length > 0 && (
              <div>
                <p className="text-sm text-destructive">✗ Ошибок: {result.errors.length}</p>
                <ul className="text-xs text-destructive mt-1 space-y-0.5">
                  {result.errors.map((e, i) => <li key={i}>{e}</li>)}
                </ul>
              </div>
            )}
            <Link href="/">
              <Button variant="outline" size="sm" className="mt-2">← Вернуться во флот</Button>
            </Link>
          </div>
        )}
      </div>
    </main>
  )
}
