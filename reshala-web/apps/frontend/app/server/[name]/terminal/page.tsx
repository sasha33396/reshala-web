'use client'

import { use } from 'react'
import Link from 'next/link'
import dynamic from 'next/dynamic'

const SshTerminal = dynamic(
  () => import('@/components/ssh-terminal').then((m) => m.SshTerminal),
  { ssr: false, loading: () => <div className="h-[500px] bg-black rounded animate-pulse" /> },
)

interface Props {
  params: Promise<{ name: string }>
}

export default function TerminalPage({ params }: Props) {
  const { name } = use(params)

  return (
    <main className="min-h-screen bg-background flex flex-col">
      <header className="border-b border-border px-6 py-3 flex items-center gap-4 flex-shrink-0">
        <Link href={`/server/${name}`} className="text-muted-foreground hover:text-foreground text-sm">
          ← {name}
        </Link>
        <h1 className="font-bold">SSH Terminal</h1>
      </header>

      <div className="flex-1 p-4">
        <SshTerminal serverName={name} />
      </div>
    </main>
  )
}
