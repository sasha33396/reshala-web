import { io, Socket } from 'socket.io-client'

const WS_URL = process.env.NEXT_PUBLIC_WS_URL ?? ''

export function createPluginsSocket(): Socket {
  return io(`${WS_URL}/plugins`, { withCredentials: true, autoConnect: false })
}

export function createTerminalSocket(): Socket {
  return io(`${WS_URL}/terminal`, { withCredentials: true, autoConnect: false })
}
