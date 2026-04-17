import type { FleetGroup } from '@reshala-web/shared'
import { ServerCard } from './server-card'

interface Props {
  groups: FleetGroup[]
  statusMap: Record<string, boolean>
}

export function FleetGrid({ groups, statusMap }: Props) {
  if (groups.length === 0) {
    return (
      <div className="text-center py-16 text-muted-foreground">
        No servers found. Add servers or adjust the filter.
      </div>
    )
  }

  return (
    <div className="space-y-8">
      {groups.map((group) => (
        <section key={group.country}>
          <h2 className="text-base font-semibold mb-3 text-muted-foreground">{group.country}</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
            {group.servers.map((server) => (
              <ServerCard
                key={server.name}
                server={server}
                online={statusMap[server.ip] ?? null}
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}
