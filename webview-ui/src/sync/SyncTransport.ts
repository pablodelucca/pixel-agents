import type { ClientMessage, ServerMessage, SyncTransportCallbacks } from './types.js'

const RECONNECT_BASE_MS = 1000
const RECONNECT_MAX_MS = 10000

export class SyncTransport {
  private ws: WebSocket | null = null
  private reconnectTimer: number | null = null
  private reconnectDelay = RECONNECT_BASE_MS
  private disposed = false

  private url: string
  private callbacks: SyncTransportCallbacks

  constructor(url: string, callbacks: SyncTransportCallbacks) {
    this.url = url
    this.callbacks = callbacks
  }

  get isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN
  }

  connect(): void {
    if (this.disposed) return
    try {
      this.ws = new WebSocket(this.url)

      this.ws.onopen = () => {
        this.reconnectDelay = RECONNECT_BASE_MS
        this.callbacks.onOpen()
      }

      this.ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data as string) as ServerMessage
          this.callbacks.onMessage(msg)
        } catch { /* ignore bad JSON */ }
      }

      this.ws.onclose = () => {
        this.callbacks.onClose()
        this.scheduleReconnect()
      }

      this.ws.onerror = () => { /* onclose will fire */ }
    } catch {
      this.scheduleReconnect()
    }
  }

  send(msg: ClientMessage): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return
    this.ws.send(JSON.stringify(msg))
  }

  dispose(): void {
    this.disposed = true
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    if (this.ws) {
      this.ws.onclose = null
      this.ws.close()
      this.ws = null
    }
  }

  private scheduleReconnect(): void {
    if (this.disposed || this.reconnectTimer !== null) return
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      this.connect()
    }, this.reconnectDelay)
    this.reconnectDelay = Math.min(this.reconnectDelay * 2, RECONNECT_MAX_MS)
  }
}
