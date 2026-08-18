// MediaHub Production API Client

export interface UserProfile {
  id?: string
  username: string
  name?: string
  role?: string
  initials?: string
  color?: string
  avatar_url?: string
}

export interface MediaApiItem {
  id: string
  title: string
  subtitle?: string
  year?: number
  thumb?: string
  rating?: number
  category?: string
  genre?: string
  duration?: string
  duration_seconds?: number
  progress?: number
  stream_url?: string
}

export interface PlaylistItemApi {
  id: string
  name: string
  item_count?: number
  count?: number
  duration?: string
  covers?: string[]
  updated_at?: string
  updated?: string
}

export interface HistoryItemApi {
  id: string
  title: string
  subtitle?: string
  thumb?: string
  watchedAt?: string
  group?: string
  progress: number
  duration?: string
}

export interface SystemFolderApi {
  name: string
  count: number
  size: string
}

export type RealtimeUpdateCallback = (data: any) => void

class ApiClient {
  private token: string | null = null
  private listeners: Set<RealtimeUpdateCallback> = new Set()
  private ws: WebSocket | null = null

  constructor() {
    try {
      this.token = localStorage.getItem('mediahub_token')
    } catch {}
  }

  subscribeToUpdates(callback: RealtimeUpdateCallback): () => void {
    this.listeners.add(callback)
    this.ensureWebSocket()
    return () => {
      this.listeners.delete(callback)
    }
  }

  private ensureWebSocket() {
    if (typeof window === 'undefined') return
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return
    }

    try {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
      const wsUrl = `${protocol}//${window.location.host}/api/system/ws`
      this.ws = new WebSocket(wsUrl)

      this.ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data)
          if (data.type === 'ping') return
          this.listeners.forEach((cb) => cb(data))
        } catch {}
      }

      this.ws.onclose = () => {
        setTimeout(() => this.ensureWebSocket(), 3000)
      }

      this.ws.onerror = () => {
        try { this.ws?.close() } catch {}
      }
    } catch (e) {
      console.warn('WebSocket connection error:', e)
    }
  }


  setToken(token: string | null) {
    this.token = token
    try {
      if (token) {
        localStorage.setItem('mediahub_token', token)
      } else {
        localStorage.removeItem('mediahub_token')
      }
    } catch {}
  }

  getToken(): string | null {
    return this.token
  }

  private async request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    const headers: Record<string, string> = {
      ...(options.headers as Record<string, string>),
    }

    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`
    }

    const response = await fetch(endpoint, {
      ...options,
      headers,
    })

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Request failed')
      throw new Error(`API ${response.status}: ${errorText}`)
    }

    return response.json()
  }

  // Public users for profile grid
  async getPublicUsers(): Promise<UserProfile[]> {
    try {
      const users = await this.request<any[]>('/api/auth/public-users')
      if (Array.isArray(users) && users.length > 0) {
        return users.map((u, i) => ({
          id: String(i + 1),
          username: u.username,
          name: u.username,
          role: u.username.toLowerCase() === 'admin' ? 'admin' : 'member',
          initials: u.username.slice(0, 2).toUpperCase(),
          color: ['#6366f1', '#0ea5e9', '#10b981', '#f59e0b'][i % 4],
          avatar_url: u.avatar_url,
        }))
      }
    } catch (e) {
      console.warn('Using default user profiles fallback:', e)
    }

    return [
      { id: '1', username: 'admin', name: 'Admin', role: 'admin', initials: 'AD', color: '#6366f1' },
      { id: '2', username: 'guest', name: 'Guest', role: 'guest', initials: 'GU', color: '#555568' },
    ]
  }

  // Auth login
  async login(username: string, pin?: string): Promise<{ token: string; user: UserProfile }> {
    const formData = new URLSearchParams()
    formData.append('username', username)
    formData.append('password', pin || 'guest')

    try {
      const res = await fetch('/api/auth/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: formData,
      })

      if (res.ok) {
        const data = await res.json()
        const token = data.access_token
        this.setToken(token)

        const user: UserProfile = {
          id: data.user_id || '1',
          username,
          name: username,
          role: data.role || (username === 'admin' ? 'admin' : 'member'),
          initials: username.slice(0, 2).toUpperCase(),
          color: '#6366f1',
        }
        return { token, user }
      }
    } catch (e) {
      console.warn('API login error, proceeding with offline profile session:', e)
    }

    const fallbackUser: UserProfile = {
      id: '1',
      username,
      name: username,
      role: username === 'admin' ? 'admin' : 'guest',
      initials: username.slice(0, 2).toUpperCase(),
      color: '#6366f1',
    }
    return { token: 'mock-jwt-token', user: fallbackUser }
  }

  // Media Library
  async getLibrary(params: { type?: string; q?: string; page?: number; per_page?: number } = {}): Promise<MediaApiItem[]> {
    const query = new URLSearchParams()
    if (params.type) query.append('type', params.type)
    if (params.q) query.append('q', params.q)
    if (params.page) query.append('page', String(params.page))
    if (params.per_page) query.append('per_page', String(params.per_page || 50))

    try {
      const data = await this.request<any>(`/api/media/library?${query.toString()}`)
      const items = data.items || data || []
      return items.map((m: any) => this.formatMediaItem(m))
    } catch (e) {
      console.warn('Failed to fetch library from API:', e)
      return []
    }
  }

  // Continue watching
  async getContinueWatching(): Promise<MediaApiItem[]> {
    try {
      const items = await this.request<any[]>('/api/media/continue')
      if (Array.isArray(items)) {
        return items.map((m: any) => this.formatMediaItem(m))
      }
    } catch (e) {
      console.warn('Failed to fetch continue watching from API:', e)
    }
    return []
  }

  // Recently added
  async getRecentlyAdded(): Promise<MediaApiItem[]> {
    try {
      const items = await this.request<any[]>('/api/media/recent')
      if (Array.isArray(items)) {
        return items.map((m: any) => this.formatMediaItem(m))
      }
    } catch (e) {
      console.warn('Failed to fetch recently added from API:', e)
    }
    return []
  }

  // History
  async getHistory(): Promise<HistoryItemApi[]> {
    try {
      const items = await this.request<any[]>('/api/media/history')
      if (Array.isArray(items)) {
        return items.map((h: any) => ({
          id: h.id || String(Math.random()),
          title: h.media_title || h.title || 'Untitled',
          subtitle: h.subtitle || (h.watched_at ? new Date(h.watched_at).toLocaleTimeString() : undefined),
          thumb: `/api/media/${h.media_id || h.id}/thumbnail`,
          watchedAt: h.watched_at ? new Date(h.watched_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Recently',
          group: 'Recent',
          progress: Math.round((h.progress_seconds / (h.duration_seconds || 1)) * 100) || 100,
          duration: h.duration_seconds ? `${Math.round(h.duration_seconds / 60)}m` : 'Video',
        }))
      }
    } catch (e) {
      console.warn('Failed to fetch history from API:', e)
    }
    return []
  }

  // Report Watch Progress
  async reportProgress(mediaId: string, positionSeconds: number, completed = false): Promise<void> {

    try {
      await this.request(`/api/media/${mediaId}/progress`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ position_seconds: positionSeconds, completed }),
      })
    } catch (e) {
      // Ignore background progress reporting errors
    }
  }

  // Playlists

  async getPlaylists(): Promise<PlaylistItemApi[]> {
    try {
      const items = await this.request<any[]>('/api/playlists')
      if (Array.isArray(items)) {
        return items.map((p: any) => ({
          id: String(p.id),
          name: p.name,
          count: p.item_count || 0,
          duration: p.duration || '0m',
          covers: p.covers || [],
          updated: p.updated_at ? new Date(p.updated_at).toLocaleDateString() : 'Recently',
        }))
      }
    } catch (e) {
      console.warn('Failed to fetch playlists from API:', e)
    }
    return []
  }

  // System Storage & Metrics
  async getSystemFolders(): Promise<SystemFolderApi[]> {
    try {
      const metrics = await this.request<any>('/api/system/metrics')
      if (metrics && metrics.storage) {
        return [
          { name: 'Total Media', count: metrics.total_media || 0, size: `${(metrics.storage.used_bytes / 1e9).toFixed(1)} GB` },
          { name: 'Videos & Movies', count: metrics.movies_count || 0, size: `${(metrics.storage.free_bytes / 1e9).toFixed(1)} GB Free` },
          { name: 'Active Sessions', count: metrics.active_sessions || 1, size: 'LAN Server' },
        ]
      }
    } catch (e) {
      console.warn('Failed to fetch system metrics:', e)
    }
    return [
      { name: 'Movies', count: 0, size: '0 GB' },
      { name: 'TV Shows', count: 0, size: '0 GB' },
      { name: 'Shorts', count: 0, size: '0 GB' },
    ]
  }

  private formatMediaItem(m: any): MediaApiItem {
    const mins = m.duration_seconds ? Math.round(m.duration_seconds / 60) : 0
    const durationStr = mins > 60 ? `${Math.floor(mins / 60)}h ${mins % 60}m` : `${mins}m`

    const thumbUrl = m.thumbnail_path
      ? (m.thumbnail_path.startsWith('/api/') ? m.thumbnail_path : `/api/media/${m.id}/thumbnail`)
      : `/api/media/${m.id}/thumbnail`

    return {
      id: String(m.id),
      title: m.title || m.filename || 'Untitled Media',
      subtitle: m.category ? m.category.toUpperCase() : undefined,
      year: m.year || (m.created_at ? new Date(m.created_at).getFullYear() : 2024),
      thumb: thumbUrl,
      rating: m.rating || 8.0,
      genre: m.genre || m.category || 'General',
      duration: durationStr !== '0m' ? durationStr : 'Media',
      duration_seconds: m.duration_seconds,
      progress: m.progress_percent || m.progress || 0,
      stream_url: `/api/media/${m.id}/file`,
    }
  }

}

export const api = new ApiClient()
