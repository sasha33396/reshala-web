import type { FleetGroup, PanelNode, PanelHost } from '@reshala-web/shared'
import { ServerCard } from './server-card'

interface Props {
  groups: FleetGroup[]
  statusMap: Record<string, boolean>
  panelMap?: Record<string, PanelNode>
  hostByIp?: Record<string, PanelHost>
}

export function FleetGrid({ groups, statusMap, panelMap, hostByIp }: Props) {
  if (groups.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border bg-card px-6 py-14 text-center">
        <div className="mx-auto max-w-sm">
          <h2 className="text-base font-semibold">No servers found</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Add a server or change the search filter to bring the fleet back into view.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-7">
      {groups.map((group) => (
        <section key={group.country}>
          <div className="mb-3 flex items-center justify-between gap-3">
            <h2 className="text-sm font-semibold text-muted-foreground">{group.country}</h2>
            <span className="rounded-full border border-border px-2 py-0.5 text-xs text-muted-foreground">
              {group.servers.length}
            </span>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-5">
            {group.servers.map((server) => (
              <ServerCard
                key={server.name}
                server={server}
                online={statusMap[server.ip] ?? null}
                panelNode={panelMap ? (panelMap[server.ip] ?? null) : undefined}
                panelHost={hostByIp?.[server.ip]}
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}
