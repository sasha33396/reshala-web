import { cn } from '@/lib/utils'

interface Props {
  online: boolean | null
  size?: 'sm' | 'md'
}

export function StatusIndicator({ online, size = 'sm' }: Props) {
  const dot = size === 'sm' ? 'w-2 h-2' : 'w-3 h-3'
  return (
    <span
      className={cn('inline-block rounded-full flex-shrink-0', dot, {
        'bg-green-500': online === true,
        'bg-red-500': online === false,
        'bg-muted': online === null,
      })}
      title={online === null ? 'Unknown' : online ? 'Online' : 'Offline'}
    />
  )
}
