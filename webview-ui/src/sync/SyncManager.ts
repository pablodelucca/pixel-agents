import { SyncTransport } from './SyncTransport.js'
import type { SyncManagerConfig, ServerMessage, PresenceClient } from './types.js'

export class SyncManager {
  private transport: SyncTransport | null = null
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null
  private layoutEtag = ''
  private config: SyncManagerConfig

  constructor(config: SyncManagerConfig) {
    this.config = config
  }

  activate(): void {
    if (this.config.mode === 'offline') return

    this.transport = new SyncTransport(this.config.serverUrl, {
      onOpen: () => this.onOpen(),
      onMessage: (msg) => this.onMessage(msg),
      onClose: () => this.onClose(),
    })
    this.transport.connect()
  }

  putLayout(layout: unknown): void {
    if (this.config.mode === 'guest') return
    this.transport?.send({
      type: 'layoutPut',
      layout: JSON.stringify(layout),
    })
  }

  dispose(): void {
    this.stopHeartbeat()
    this.transport?.dispose()
    this.transport = null
  }

  private onOpen(): void {
    this.transport!.send({ type: 'join', userName: this.config.userName })
    this.startHeartbeat()
  }

  private onClose(): void {
    this.stopHeartbeat()
  }

  private onMessage(msg: ServerMessage): void {
    switch (msg.type) {
      case 'presence':
        this.config.onPresence(msg.clients as PresenceClient[])
        break
      case 'welcome':
        if (msg.layoutJson && msg.layoutJson !== '{}') {
          this.layoutEtag = msg.layoutEtag || ''
          try { this.config.onRemoteLayout(JSON.parse(msg.layoutJson)) } catch { /* bad JSON */ }
        }
        break
      case 'layoutFull':
        this.layoutEtag = msg.layoutEtag || ''
        try { this.config.onRemoteLayout(JSON.parse(msg.layoutJson)) } catch { /* bad JSON */ }
        break
      case 'layoutChanged':
        this.fetchLayout()
        break
    }
  }

  private startHeartbeat(): void {
    this.stopHeartbeat()
    this.sendHeartbeat()
    this.heartbeatTimer = setInterval(() => this.sendHeartbeat(), this.config.heartbeatIntervalMs)
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer !== null) {
      clearInterval(this.heartbeatTimer)
      this.heartbeatTimer = null
    }
  }

  private sendHeartbeat(): void {
    const agents = this.config.mode === 'guest' ? [] : this.config.getLocalAgents()
    this.transport?.send({ type: 'heartbeat', agents })
  }

  private fetchLayout(): void {
    const httpUrl = this.config.serverUrl.replace(/^ws:/, 'http:').replace(/^wss:/, 'https:')
    const headers: Record<string, string> = {}
    if (this.layoutEtag) headers['If-None-Match'] = this.layoutEtag

    fetch(`${httpUrl}/layout`, { headers })
      .then((res) => {
        if (res.status === 304) return null
        const newEtag = res.headers.get('etag')
        if (newEtag) this.layoutEtag = newEtag
        return res.json()
      })
      .then((layout) => {
        if (layout) this.config.onRemoteLayout(layout)
      })
      .catch(() => { /* ignore */ })
  }
}
