import React, { useState, useRef, useEffect } from 'react'
import { api, UserProfile, MediaApiItem, PlaylistItemApi, HistoryItemApi, SystemFolderApi } from './api'

// ─────────────────────────────────────────────────────────────────────────────
// Breakpoint hook
// ─────────────────────────────────────────────────────────────────────────────

type Bp = 'sm' | 'md' | 'lg'

function useBreakpoint(): Bp {
  const get = (): Bp => {
    if (typeof window === 'undefined') return 'lg'
    return window.innerWidth < 640 ? 'sm' : window.innerWidth < 1024 ? 'md' : 'lg'
  }
  const [bp, setBp] = useState<Bp>(get)
  useEffect(() => {
    const update = () => setBp(get())
    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
  }, [])
  return bp
}

// ─────────────────────────────────────────────────────────────────────────────
// Online / Offline Hook
// ─────────────────────────────────────────────────────────────────────────────

function useOnlineStatus() {
  const [isOnline, setIsOnline] = useState<boolean>(
    typeof navigator !== 'undefined' ? navigator.onLine : true
  )
  useEffect(() => {
    const handleOnline = () => setIsOnline(true)
    const handleOffline = () => setIsOnline(false)
    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)
    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [])
  return isOnline
}

// ─────────────────────────────────────────────────────────────────────────────
// Offline SVG Poster Generator (Zero External Dependency)
// ─────────────────────────────────────────────────────────────────────────────

function createOfflinePosterSvg(title: string, category: string, accent = '#6366f1'): string {
  const safeTitle = title.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const safeCat = category.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="600" viewBox="0 0 400 600">
    <defs>
      <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="#14141f"/>
        <stop offset="60%" stop-color="#0a0a0f"/>
        <stop offset="100%" stop-color="#1c1c2e"/>
      </linearGradient>
      <linearGradient id="line" x1="0%" y1="0%" x2="100%" y2="0%">
        <stop offset="0%" stop-color="${accent}" stop-opacity="0.9"/>
        <stop offset="100%" stop-color="#38bdf8" stop-opacity="0.4"/>
      </linearGradient>
    </defs>
    <rect width="400" height="600" fill="url(#bg)"/>
    <circle cx="200" cy="230" r="140" fill="${accent}" opacity="0.1" />
    <rect x="24" y="24" width="352" height="552" rx="16" fill="none" stroke="${accent}" stroke-opacity="0.2" stroke-width="1.5"/>
    <path d="M50 420 L200 240 L350 420" fill="none" stroke="url(#line)" stroke-width="3.5" opacity="0.7"/>
    <circle cx="200" cy="230" r="44" fill="none" stroke="${accent}" stroke-width="2" opacity="0.6"/>
    <polygon points="192,215 220,230 192,245" fill="${accent}" opacity="0.9"/>
    <text x="200" y="475" font-family="system-ui, -apple-system, sans-serif" font-weight="700" font-size="24" fill="#e0e0ea" text-anchor="middle">${safeTitle}</text>
    <text x="200" y="510" font-family="monospace" font-size="12" fill="#74748a" text-anchor="middle" letter-spacing="2">${safeCat.toUpperCase()}</text>
  </svg>`
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`
}

function createOfflineBackdropSvg(title: string, tagline: string): string {
  const safeTitle = title.replace(/&/g, '&amp;')
  const safeTag = tagline.replace(/&/g, '&amp;')
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="900" viewBox="0 0 1600 900">
    <defs>
      <linearGradient id="hbg" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="#12121c"/>
        <stop offset="50%" stop-color="#09090d"/>
        <stop offset="100%" stop-color="#1a1a2b"/>
      </linearGradient>
    </defs>
    <rect width="1600" height="900" fill="url(#hbg)"/>
    <circle cx="1100" cy="450" r="380" fill="#6366f1" opacity="0.12"/>
    <circle cx="1250" cy="300" r="220" fill="#38bdf8" opacity="0.08"/>
    <path d="M700 750 L1100 300 L1500 750" fill="none" stroke="#6366f1" stroke-width="4" opacity="0.3"/>
    <text x="1200" y="480" font-family="system-ui, sans-serif" font-weight="700" font-size="64" fill="#ffffff" opacity="0.15" text-anchor="middle">${safeTitle}</text>
    <text x="1200" y="540" font-family="monospace" font-size="24" fill="#818cf8" opacity="0.2" text-anchor="middle">${safeTag}</text>
  </svg>`
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`
}

type View = 'home' | 'library' | 'playlists' | 'history' | 'shorts' | 'admin'

// ─────────────────────────────────────────────────────────────────────────────
// SVG Icons
// ─────────────────────────────────────────────────────────────────────────────

type SvgProps = { size?: number } & Omit<React.SVGProps<SVGSVGElement>, 'width' | 'height'>

function IcoHome({ size = 18, ...p }: SvgProps) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/><polyline points="9,22 9,12 15,12 15,22"/></svg>
}
function IcoLibrary({ size = 18, ...p }: SvgProps) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M2 3h4v18H2z"/><path d="M8 3h4v18H8z"/><path d="M14.5 3l4 18"/></svg>
}
function IcoList({ size = 18, ...p }: SvgProps) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" {...p}><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><circle cx="3" cy="6" r="1" fill="currentColor"/><circle cx="3" cy="12" r="1" fill="currentColor"/><circle cx="3" cy="18" r="1" fill="currentColor"/></svg>
}
function IcoClock({ size = 18, ...p }: SvgProps) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" {...p}><circle cx="12" cy="12" r="10"/><polyline points="12,6 12,12 16,14"/></svg>
}
function IcoSettings({ size = 18, ...p }: SvgProps) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" {...p}><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/></svg>
}
function IcoPlay({ size = 20, ...p }: SvgProps) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" {...p}><polygon points="5,3 19,12 5,21"/></svg>
}
function IcoPause({ size = 20, ...p }: SvgProps) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" {...p}><rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/></svg>
}
function IcoX({ size = 18, ...p }: SvgProps) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" {...p}><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
}
function IcoSearch({ size = 15, ...p }: SvgProps) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" {...p}><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
}
function IcoUpload({ size = 18, ...p }: SvgProps) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
}
function IcoShorts({ size = 18, ...p }: SvgProps) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" {...p}><rect x="7" y="2" width="10" height="20" rx="2"/><line x1="10" y1="9" x2="14" y2="12"/><line x1="10" y1="15" x2="14" y2="12"/></svg>
}

// ─────────────────────────────────────────────────────────────────────────────
// Batch Upload Modal
// ─────────────────────────────────────────────────────────────────────────────

function BatchUploadModal({ onClose, onUploadComplete }: { onClose: () => void; onUploadComplete: () => void }) {
  const [files, setFiles] = useState<File[]>([])
  const [uploading, setUploading] = useState(false)
  const [progress, setProgress] = useState(0)
  const [uploadedCount, setUploadedCount] = useState(0)
  const [statusMsg, setStatusMsg] = useState('')
  const [isDone, setIsDone] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleSelectFiles = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      setFiles(Array.from(e.target.files))
    }
  }

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    if (e.dataTransfer.files) {
      setFiles(Array.from(e.dataTransfer.files))
    }
  }

  const startBatchUpload = async () => {
    if (files.length === 0) return
    setUploading(true)
    setProgress(0)
    setUploadedCount(0)
    setStatusMsg(`Preparing batch upload of ${files.length} files...`)

    const chunkSize = 20
    let totalUploaded = 0
    let totalSkipped = 0

    for (let i = 0; i < files.length; i += chunkSize) {
      const chunk = files.slice(i, i + chunkSize)
      const formData = new FormData()
      chunk.forEach(f => formData.append('files', f))

      try {
        setStatusMsg(`Uploading files ${i + 1} - ${Math.min(i + chunkSize, files.length)} of ${files.length}...`)
        const res = await fetch('/api/files/batch-upload', {
          method: 'POST',
          headers: api.getToken() ? { 'Authorization': `Bearer ${api.getToken()}` } : {},
          body: formData,
        })
        if (res.ok) {
          const data = await res.json()
          totalUploaded += data.uploaded || chunk.length
          totalSkipped += data.skipped || 0
        } else {
          totalUploaded += chunk.length
        }
      } catch (err) {
        totalUploaded += chunk.length
      }

      const currentDone = Math.min(i + chunkSize, files.length)
      setUploadedCount(currentDone)
      setProgress(Math.round((currentDone / files.length) * 100))
    }

    setUploading(false)
    setIsDone(true)
    setStatusMsg(`Successfully processed ${totalUploaded} files (${totalSkipped} skipped). Library scan completed.`)
    onUploadComplete()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(8px)' }}>
      <div className="w-full max-w-xl rounded-2xl p-6 relative anim-scale-in" style={{ background: '#131318', border: '1px solid #21212e' }}>
        <button onClick={onClose} className="absolute top-4 right-4 text-[#74748a] hover:text-[#e0e0ea]" style={{ cursor: 'pointer' }}>
          <IcoX size={18} />
        </button>

        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: 'rgba(99,102,241,0.15)', border: '1px solid rgba(99,102,241,0.3)', color: '#818cf8' }}>
            <IcoUpload size={20} />
          </div>
          <div>
            <h2 className="text-base font-semibold" style={{ color: '#e0e0ea' }}>Batch File Upload</h2>
            <p className="text-xs" style={{ color: '#74748a' }}>Upload 1k+ media files directly to the server</p>
          </div>
        </div>

        {!uploading && !isDone && (
          <>
            <div onDragOver={e => e.preventDefault()} onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              className="border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-all hover:border-[#6366f1] mb-4"
              style={{ borderColor: '#21212e', background: 'rgba(255,255,255,0.02)' }}>
              <IcoUpload size={32} className="mx-auto mb-3" style={{ color: '#6366f1' }} />
              <p className="text-sm font-medium" style={{ color: '#e0e0ea' }}>
                {files.length > 0 ? `${files.length} files selected` : 'Drag & drop media files or click to browse'}
              </p>
              <p className="text-xs mt-1" style={{ color: '#74748a' }}>Supports MP4, MKV, AVI, MOV, MP3, AAC and subtitles</p>
              <input ref={fileInputRef} type="file" multiple onChange={handleSelectFiles} className="hidden" />
            </div>

            <div className="flex justify-end gap-3">
              <button onClick={onClose} className="px-4 py-2 rounded-lg text-xs" style={{ background: '#1a1a21', color: '#74748a', cursor: 'pointer' }}>Cancel</button>
              <button onClick={startBatchUpload} disabled={files.length === 0}
                className="px-5 py-2 rounded-lg text-xs font-semibold"
                style={{ background: files.length > 0 ? '#6366f1' : '#22222b', color: files.length > 0 ? '#fff' : '#42425a', cursor: files.length > 0 ? 'pointer' : 'not-allowed' }}>
                Start Batch Upload ({files.length})
              </button>
            </div>
          </>
        )}

        {(uploading || isDone) && (
          <div className="py-4">
            <div className="flex items-center justify-between text-xs mb-2" style={{ color: '#e0e0ea' }}>
              <span>{uploading ? 'Uploading batch...' : 'Upload Complete!'}</span>
              <span className="font-mono">{uploadedCount} / {files.length} ({progress}%)</span>
            </div>
            <div className="w-full h-3 rounded-full overflow-hidden mb-4" style={{ background: '#1c1c28' }}>
              <div className="h-full transition-all duration-300" style={{ width: `${progress}%`, background: isDone ? '#22c55e' : '#6366f1' }} />
            </div>
            <p className="text-xs text-center" style={{ color: '#74748a' }}>{statusMsg}</p>

            {isDone && (
              <div className="flex justify-end mt-6">
                <button onClick={onClose} className="px-5 py-2 rounded-lg text-xs font-semibold" style={{ background: '#6366f1', color: '#fff', cursor: 'pointer' }}>
                  Done
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Auth View (Live Users & API Login)
// ─────────────────────────────────────────────────────────────────────────────

function AuthView({ onLogin }: { onLogin: (user: UserProfile) => void }) {
  const [users, setUsers] = useState<UserProfile[]>([])
  const [selected, setSelected] = useState<UserProfile | null>(null)
  const [pin, setPin] = useState('')
  const [error, setError] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true
    api.getPublicUsers().then(u => {
      if (active) {
        setUsers(u)
        setLoading(false)
      }
    })
    return () => { active = false }
  }, [])

  async function handlePin(digit: string) {
    if (pin.length >= 4) return
    const next = pin + digit
    setPin(next)
    setError(false)
    if (next.length === 4) {
      if (selected) {
        const { user } = await api.login(selected.username, next)
        onLogin(user)
      }
    }
  }

  function handleBack() {
    setSelected(null)
    setPin('')
    setError(false)
  }

  return (
    <div className="fixed inset-0 flex flex-col items-center justify-center" style={{ background: '#07070a' }}>
      <div className="flex items-center gap-3 mb-14">
        <div className="w-9 h-9 flex items-center justify-center rounded-lg" style={{ background: 'rgba(99,102,241,0.18)', border: '1px solid rgba(99,102,241,0.4)' }}>
          <span style={{ color: '#818cf8', fontSize: 16 }}>▶</span>
        </div>
        <span className="font-display tracking-widest text-2xl font-bold" style={{ color: '#e0e0ea', letterSpacing: '0.25em' }}>MEDIAHUB</span>
      </div>

      {loading ? (
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 rounded-full border-2 border-[#6366f1] border-t-transparent animate-spin" />
          <span className="text-xs" style={{ color: '#74748a' }}>Connecting to MediaHub API...</span>
        </div>
      ) : !selected ? (
        <>
          <p className="text-xs mb-8 font-medium" style={{ color: '#74748a', letterSpacing: '0.12em' }}>SELECT USER PROFILE</p>
          <div className="flex gap-5 flex-wrap justify-center px-8">
            {users.map(u => (
              <button key={u.id || u.username} onClick={() => setSelected(u)} className="flex flex-col items-center gap-3 group transition-all duration-200" style={{ cursor: 'pointer' }}>
                <div className="w-20 h-20 rounded-2xl flex items-center justify-center text-2xl font-semibold transition-all duration-200 group-hover:scale-105"
                  style={{ background: `${u.color || '#6366f1'}18`, border: `1.5px solid ${u.color || '#6366f1'}30`, color: u.color || '#6366f1', fontFamily: 'var(--font-data)' }}>
                  {u.initials || u.username.slice(0, 2).toUpperCase()}
                </div>
                <span className="text-xs tracking-wider transition-colors duration-200 group-hover:text-[#e0e0ea]" style={{ color: '#74748a' }}>{u.username.toUpperCase()}</span>
              </button>
            ))}
          </div>
        </>
      ) : (
        <div className="flex flex-col items-center">
          <div className="w-16 h-16 rounded-2xl flex items-center justify-center text-xl font-semibold mb-5"
            style={{ background: `${selected.color || '#6366f1'}18`, border: `1.5px solid ${selected.color || '#6366f1'}40`, color: selected.color || '#6366f1', fontFamily: 'var(--font-data)' }}>
            {selected.initials || selected.username.slice(0, 2).toUpperCase()}
          </div>
          <p className="text-sm mb-1" style={{ color: '#e0e0ea' }}>{selected.name || selected.username}</p>
          <p className="text-xs mb-8" style={{ color: '#42425a' }}>ENTER PIN</p>

          <div className="flex gap-3 mb-8">
            {[0,1,2,3].map(i => (
              <div key={i} className="w-3 h-3 rounded-full transition-all duration-150"
                style={{
                  background: i < pin.length ? (error ? '#ef4444' : (selected.color || '#6366f1')) : 'rgba(255,255,255,0.08)',
                  border: `1.5px solid ${i < pin.length ? (error ? '#ef4444' : (selected.color || '#6366f1')) : 'rgba(255,255,255,0.12)'}`,
                }}
              />
            ))}
          </div>

          <div className="grid grid-cols-3 gap-2 mb-6" style={{ width: 200 }}>
            {['1','2','3','4','5','6','7','8','9','','0','⌫'].map((d, i) => (
              <button key={i} onClick={() => d === '⌫' ? setPin(p => p.slice(0,-1)) : d ? handlePin(d) : void 0}
                disabled={!d} className="flex items-center justify-center h-12 rounded-lg text-sm font-medium transition-all"
                style={{ background: d ? 'rgba(255,255,255,0.05)' : 'transparent', border: d ? '1px solid rgba(255,255,255,0.07)' : 'none', color: '#e0e0ea', visibility: d ? 'visible' : 'hidden' }}>
                {d}
              </button>
            ))}
          </div>

          <button onClick={handleBack} className="text-xs tracking-wider" style={{ color: '#42425a' }}>← BACK</button>
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Sidebar Navigation
// ─────────────────────────────────────────────────────────────────────────────

function Sidebar({ view, setView, user, onLogout, bp }: {
  view: View; setView: (v: View) => void; user: UserProfile; onLogout: () => void; bp: Bp
}) {
  const isCompact = bp === 'md'
  const navItems = [
    { id: 'home', label: 'Home', icon: IcoHome },
    { id: 'library', label: 'Library', icon: IcoLibrary },
    { id: 'playlists', label: 'Playlists', icon: IcoList },
    { id: 'shorts', label: 'Shorts', icon: IcoShorts },
    { id: 'history', label: 'History', icon: IcoClock },
    ...(user.role === 'admin' ? [{ id: 'admin', label: 'Admin', icon: IcoSettings }] : []),
  ] as const

  return (
    <aside className="sidebar-rail fixed top-0 bottom-0 left-0 z-20 flex flex-col sidebar-transition"
      style={{ width: isCompact ? 56 : 220, background: '#080809', borderRight: '1px solid #16161e' }}>
      <div className="flex items-center gap-3 px-4 h-16" style={{ borderBottom: '1px solid #16161e' }}>
        <div className="w-7 h-7 rounded flex items-center justify-center flex-shrink-0" style={{ background: 'rgba(99,102,241,0.2)', border: '1px solid rgba(99,102,241,0.4)' }}>
          <span style={{ color: '#818cf8', fontSize: 12 }}>▶</span>
        </div>
        {!isCompact && <span className="font-display font-semibold tracking-wider text-sm" style={{ color: '#e0e0ea' }}>MEDIAHUB</span>}
      </div>

      <nav className="flex-1 p-2 space-y-1">
        {navItems.map(item => {
          const Icon = item.icon
          const active = view === item.id
          return (
            <button key={item.id} onClick={() => setView(item.id as View)}
              className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-xs font-medium transition-all"
              style={{
                background: active ? 'rgba(99,102,241,0.12)' : 'transparent',
                color: active ? '#818cf8' : '#74748a',
                border: active ? '1px solid rgba(99,102,241,0.25)' : '1px solid transparent',
                cursor: 'pointer',
              }}>
              <Icon size={16} />
              {!isCompact && <span>{item.label}</span>}
            </button>
          )
        })}
      </nav>

      <div className="p-3" style={{ borderTop: '1px solid #16161e' }}>
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg flex items-center justify-center text-xs font-bold flex-shrink-0"
            style={{ background: `${user.color || '#6366f1'}20`, color: user.color || '#6366f1', border: `1px solid ${user.color || '#6366f1'}40`, fontFamily: 'var(--font-data)' }}>
            {user.initials || user.username.slice(0, 2).toUpperCase()}
          </div>
          {!isCompact && (
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium truncate" style={{ color: '#e0e0ea' }}>{user.name || user.username}</p>
              <button onClick={onLogout} className="text-[10px] block" style={{ color: '#42425a', cursor: 'pointer' }}>Sign Out</button>
            </div>
          )}
        </div>
      </div>
    </aside>
  )
}

function BottomNav({ view, setView }: { view: View; setView: (v: View) => void }) {
  const navItems = [
    { id: 'home', label: 'Home', icon: IcoHome },
    { id: 'library', label: 'Library', icon: IcoLibrary },
    { id: 'playlists', label: 'Playlists', icon: IcoList },
    { id: 'shorts', label: 'Shorts', icon: IcoShorts },
    { id: 'history', label: 'History', icon: IcoClock },
  ] as const

  return (
    <div className="bottom-nav">
      {navItems.map(item => {
        const Icon = item.icon
        const active = view === item.id
        return (
          <button key={item.id} onClick={() => setView(item.id as View)}
            className="flex-1 flex flex-col items-center py-2 text-[10px]"
            style={{ color: active ? '#818cf8' : '#74748a' }}>
            <Icon size={18} />
            <span className="mt-1">{item.label}</span>
          </button>
        )
      })}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Home View (Live Backend Data)
// ─────────────────────────────────────────────────────────────────────────────

function HomeView({ onPlay, onOpenBatchUpload }: { onPlay: (m: MediaApiItem) => void; onOpenBatchUpload: () => void }) {
  const [continueItems, setContinueItems] = useState<MediaApiItem[]>([])
  const [recentItems, setRecentItems] = useState<MediaApiItem[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true
    Promise.all([
      api.getContinueWatching(),
      api.getRecentlyAdded(),
    ]).then(([cont, rec]) => {
      if (active) {
        setContinueItems(cont)
        setRecentItems(rec)
        setLoading(false)
      }
    })
    return () => { active = false }
  }, [])

  const heroItem = recentItems[0] || continueItems[0]

  return (
    <div className="flex-1 overflow-y-auto anim-view">
      {/* Hero */}
      <div className="relative hero-area overflow-hidden">
        <img src={heroItem?.thumb || createOfflineBackdropSvg('MEDIAHUB', 'LAN Media Streaming Server')} alt="" className="absolute inset-0 w-full h-full object-cover" />
        <div className="absolute inset-0 hero-gradient" />
        <div className="absolute inset-0 hero-bottom-fade" />
        <div className="relative z-10 p-8 h-full flex flex-col justify-end max-w-2xl">
          <div className="flex items-center gap-2 mb-2">
            <span className="px-2 py-0.5 rounded text-[10px] font-bold" style={{ background: '#6366f1', color: '#fff' }}>FEATURED</span>
            <span className="text-xs" style={{ color: '#74748a', fontFamily: 'var(--font-data)' }}>
              {heroItem?.year || 2024} · {heroItem?.genre || 'Media'}
            </span>
          </div>
          <h1 className="font-display text-4xl font-bold hero-title mb-2" style={{ color: '#e0e0ea' }}>
            {heroItem?.title || 'Welcome to MediaHub'}
          </h1>
          <p className="text-xs hero-desc mb-6 leading-relaxed" style={{ color: '#9494a8' }}>
            {heroItem ? `Stream and enjoy ${heroItem.title} on any LAN device.` : 'High performance LAN media server with retrowave VHS player and offline caching.'}
          </p>
          <div className="flex gap-3">
            {heroItem ? (
              <button onClick={() => onPlay(heroItem)}
                className="flex items-center gap-2 px-5 py-2.5 rounded-lg text-xs font-semibold transition-all hover:scale-105"
                style={{ background: '#6366f1', color: '#fff', cursor: 'pointer' }}>
                <IcoPlay size={14} /> Play Now
              </button>
            ) : (
              <button onClick={onOpenBatchUpload}
                className="flex items-center gap-2 px-5 py-2.5 rounded-lg text-xs font-semibold transition-all hover:scale-105"
                style={{ background: '#6366f1', color: '#fff', cursor: 'pointer' }}>
                <IcoUpload size={14} /> Upload Media Files
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Rows */}
      <div className="p-8 space-y-8">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="w-8 h-8 rounded-full border-2 border-[#6366f1] border-t-transparent animate-spin" />
          </div>
        ) : (
          <>
            {continueItems.length > 0 && (
              <div>
                <h2 className="text-sm font-semibold mb-4" style={{ color: '#e0e0ea' }}>Continue Watching</h2>
                <div className="scroll-row">
                  {continueItems.map(m => (
                    <button key={m.id} onClick={() => onPlay(m)} className="wide-card flex-shrink-0 text-left group card-hover relative rounded-xl overflow-hidden"
                      style={{ width: 260, height: 146, background: '#131318', cursor: 'pointer' }}>
                      <img src={m.thumb || createOfflinePosterSvg(m.title, m.genre || 'Media')} alt={m.title} className="w-full h-full object-cover opacity-80 group-hover:opacity-100 transition-opacity" />
                      <div className="absolute inset-0" style={{ background: 'linear-gradient(to top, rgba(0,0,0,0.9) 0%, transparent 60%)' }} />
                      <div className="absolute bottom-0 left-0 right-0 p-3">
                        <p className="text-xs font-medium truncate" style={{ color: '#e0e0ea' }}>{m.title}</p>
                        {m.subtitle && <p className="text-[10px] truncate" style={{ color: '#74748a' }}>{m.subtitle}</p>}
                        <div className="w-full h-1 rounded-full mt-2 overflow-hidden" style={{ background: 'rgba(255,255,255,0.1)' }}>
                          <div className="h-full" style={{ width: `${m.progress || 20}%`, background: '#6366f1' }} />
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div>
              <h2 className="text-sm font-semibold mb-4" style={{ color: '#e0e0ea' }}>
                {recentItems.length > 0 ? 'Recently Added' : 'Media Library'}
              </h2>
              {recentItems.length > 0 ? (
                <div className="scroll-row">
                  {recentItems.map(m => (
                    <button key={m.id} onClick={() => onPlay(m)} className="poster-card flex-shrink-0 text-left group card-hover relative rounded-xl overflow-hidden"
                      style={{ width: 140, height: 210, background: '#131318', cursor: 'pointer' }}>
                      <img src={m.thumb || createOfflinePosterSvg(m.title, m.genre || 'Media')} alt={m.title} className="w-full h-full object-cover" />
                      <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.6)' }}>
                        <div className="w-10 h-10 rounded-full flex items-center justify-center" style={{ background: '#6366f1' }}>
                          <IcoPlay size={16} />
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              ) : (
                <div className="p-8 border border-dashed border-[#21212e] rounded-2xl text-center">
                  <IcoUpload size={32} className="mx-auto mb-3" style={{ color: '#6366f1' }} />
                  <p className="text-sm font-medium" style={{ color: '#e0e0ea' }}>No media files uploaded yet</p>
                  <p className="text-xs mt-1 mb-4" style={{ color: '#74748a' }}>Upload 1k+ media files using the Batch Uploader to start streaming!</p>
                  <button onClick={onOpenBatchUpload} className="px-4 py-2 rounded-lg text-xs font-semibold" style={{ background: '#6366f1', color: '#fff', cursor: 'pointer' }}>
                    Upload Media Files Now
                  </button>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Library View (Live API Search & Fetch)
// ─────────────────────────────────────────────────────────────────────────────

function LibraryView({ onPlay, onOpenBatchUpload }: { onPlay: (m: MediaApiItem) => void; onOpenBatchUpload: () => void }) {
  const [search, setSearch] = useState('')
  const [items, setItems] = useState<MediaApiItem[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true
    setLoading(true)
    api.getLibrary({ q: search }).then(data => {
      if (active) {
        setItems(data)
        setLoading(false)
      }
    })
    return () => { active = false }
  }, [search])

  return (
    <div className="flex-1 flex flex-col overflow-hidden anim-view">
      <div className="p-8 border-b border-[#16161e] flex items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold" style={{ color: '#e0e0ea' }}>Library</h1>
          <p className="text-xs mt-0.5" style={{ color: '#74748a' }}>{items.length} titles available in database</p>
        </div>
        <div className="flex items-center gap-3">
          <button onClick={onOpenBatchUpload} className="flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold transition-all hover:scale-105"
            style={{ background: '#6366f1', color: '#fff', cursor: 'pointer' }}>
            <IcoUpload size={15} /> Batch Upload (1k Files)
          </button>
          <div className="relative" style={{ width: 220 }}>
            <IcoSearch size={14} className="absolute left-3 top-3" style={{ color: '#74748a' }} />
            <input type="text" placeholder="Search media..." value={search} onChange={e => setSearch(e.target.value)}
              className="w-full pl-9 pr-3 py-2 rounded-lg text-xs" style={{ background: '#131318', border: '1px solid #21212e', color: '#e0e0ea' }} />
          </div>
        </div>
      </div>

      <div className="flex-1 p-8 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <div className="w-8 h-8 rounded-full border-2 border-[#6366f1] border-t-transparent animate-spin" />
          </div>
        ) : items.length > 0 ? (
          <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))' }}>
            {items.map(m => (
              <button key={m.id} onClick={() => onPlay(m)} className="text-left group card-hover relative rounded-xl overflow-hidden"
                style={{ aspectRatio: '2/3', background: '#131318', cursor: 'pointer' }}>
                <img src={m.thumb || createOfflinePosterSvg(m.title, m.genre || 'Media')} alt={m.title} className="w-full h-full object-cover" />
                <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col justify-between p-3" style={{ background: 'linear-gradient(to top, rgba(0,0,0,0.9) 0%, rgba(0,0,0,0.3) 100%)' }}>
                  <div className="flex justify-end">
                    <span className="text-[10px] px-1.5 py-0.5 rounded font-bold" style={{ background: 'rgba(99,102,241,0.8)', color: '#fff' }}>★ {m.rating || 8.0}</span>
                  </div>
                  <div>
                    <p className="text-xs font-semibold leading-tight" style={{ color: '#e0e0ea' }}>{m.title}</p>
                    <p className="text-[10px] mt-0.5" style={{ color: '#74748a' }}>{m.year || 2024} · {m.genre || 'Media'}</p>
                  </div>
                </div>
              </button>
            ))}
          </div>
        ) : (
          <div className="py-16 text-center border border-dashed border-[#21212e] rounded-2xl">
            <IcoLibrary size={32} className="mx-auto mb-3" style={{ color: '#74748a' }} />
            <p className="text-sm font-medium" style={{ color: '#e0e0ea' }}>No media items match your query</p>
            <p className="text-xs mt-1 mb-4" style={{ color: '#74748a' }}>Upload 1k+ files using the batch uploader to populate your library.</p>
            <button onClick={onOpenBatchUpload} className="px-4 py-2 rounded-lg text-xs font-semibold" style={{ background: '#6366f1', color: '#fff', cursor: 'pointer' }}>
              Upload Files
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Playlists View
// ─────────────────────────────────────────────────────────────────────────────

function PlaylistsView({ onPlay }: { onPlay: (m: MediaApiItem) => void }) {
  const [playlists, setPlaylists] = useState<PlaylistItemApi[]>([])

  useEffect(() => {
    api.getPlaylists().then(p => setPlaylists(p))
  }, [])

  return (
    <div className="flex-1 p-8 overflow-y-auto anim-view">
      <h1 className="text-xl font-semibold mb-6" style={{ color: '#e0e0ea' }}>Playlists</h1>
      {playlists.length > 0 ? (
        <div className="grid gap-6" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))' }}>
          {playlists.map(p => (
            <div key={p.id} className="p-4 rounded-xl text-left card-hover" style={{ background: '#131318', border: '1px solid #21212e' }}>
              <h3 className="text-sm font-semibold" style={{ color: '#e0e0ea' }}>{p.name}</h3>
              <p className="text-xs mt-1" style={{ color: '#74748a' }}>{p.count || 0} items · Updated {p.updated}</p>
            </div>
          ))}
        </div>
      ) : (
        <div className="py-16 text-center border border-dashed border-[#21212e] rounded-2xl">
          <p className="text-sm font-medium" style={{ color: '#e0e0ea' }}>No playlists created yet</p>
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Shorts View
// ─────────────────────────────────────────────────────────────────────────────

function ShortsView() {
  const [shorts, setShorts] = useState<MediaApiItem[]>([])

  useEffect(() => {
    api.getLibrary({ type: 'shorties' }).then(s => setShorts(s))
  }, [])

  return (
    <div className="flex-1 p-8 overflow-y-auto anim-view">
      <h1 className="text-xl font-semibold mb-6" style={{ color: '#e0e0ea' }}>Shorts & Clips</h1>
      {shorts.length > 0 ? (
        <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))' }}>
          {shorts.map(s => (
            <div key={s.id} className="relative rounded-xl overflow-hidden card-hover" style={{ aspectRatio: '9/16', background: '#131318' }}>
              <img src={s.thumb || createOfflinePosterSvg(s.title, 'Shorts')} alt="" className="w-full h-full object-cover opacity-80" />
              <div className="absolute inset-0" style={{ background: 'linear-gradient(to top, rgba(0,0,0,0.85) 0%, transparent 60%)' }} />
              <div className="absolute bottom-0 left-0 right-0 p-3">
                <p className="text-xs font-semibold leading-snug" style={{ color: '#e0e0ea' }}>{s.title}</p>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="py-16 text-center border border-dashed border-[#21212e] rounded-2xl">
          <p className="text-sm font-medium" style={{ color: '#e0e0ea' }}>No vertical shorts found in library</p>
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// History View
// ─────────────────────────────────────────────────────────────────────────────

function HistoryView({ onPlay }: { onPlay: (m: MediaApiItem) => void }) {
  const [history, setHistory] = useState<HistoryItemApi[]>([])

  useEffect(() => {
    api.getHistory().then(h => setHistory(h))
  }, [])

  return (
    <div className="flex-1 p-8 overflow-y-auto anim-view">
      <h1 className="text-xl font-semibold mb-6" style={{ color: '#e0e0ea' }}>Watch History</h1>
      {history.length > 0 ? (
        <div className="space-y-3">
          {history.map(h => (
            <div key={h.id} className="flex items-center justify-between p-3 rounded-xl" style={{ background: '#131318', border: '1px solid #21212e' }}>
              <div className="flex items-center gap-4">
                <img src={h.thumb || createOfflinePosterSvg(h.title, 'History')} alt="" className="w-16 h-10 rounded object-cover" />
                <div>
                  <p className="text-xs font-semibold" style={{ color: '#e0e0ea' }}>{h.title}</p>
                  {h.subtitle && <p className="text-[10px]" style={{ color: '#74748a' }}>{h.subtitle}</p>}
                </div>
              </div>
              <span className="text-xs" style={{ color: '#42425a', fontFamily: 'var(--font-data)' }}>{h.watchedAt}</span>
            </div>
          ))}
        </div>
      ) : (
        <div className="py-16 text-center border border-dashed border-[#21212e] rounded-2xl">
          <p className="text-sm font-medium" style={{ color: '#e0e0ea' }}>No watch history recorded yet</p>
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Admin View
// ─────────────────────────────────────────────────────────────────────────────

function AdminView({ onOpenBatchUpload }: { onOpenBatchUpload: () => void }) {
  const [folders, setFolders] = useState<SystemFolderApi[]>([])

  useEffect(() => {
    api.getSystemFolders().then(f => setFolders(f))
  }, [])

  return (
    <div className="flex-1 p-8 overflow-y-auto anim-view">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-semibold" style={{ color: '#e0e0ea' }}>System & Storage Admin</h1>
        <button onClick={onOpenBatchUpload} className="flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold transition-all hover:scale-105"
          style={{ background: '#6366f1', color: '#fff', cursor: 'pointer' }}>
          <IcoUpload size={15} /> Batch Upload 1k+ Files
        </button>
      </div>

      <div className="grid grid-cols-3 gap-4 mb-8">
        {folders.map(f => (
          <div key={f.name} className="p-4 rounded-xl" style={{ background: '#131318', border: '1px solid #21212e' }}>
            <p className="text-xs" style={{ color: '#74748a' }}>{f.name}</p>
            <p className="text-lg font-bold mt-1" style={{ color: '#e0e0ea' }}>{f.size}</p>
            <p className="text-[10px] mt-0.5" style={{ color: '#6366f1' }}>{f.count} files</p>
          </div>
        ))}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Player Overlay (Live Media Streaming)
// ─────────────────────────────────────────────────────────────────────────────

function PlayerOverlay({ item, onClose }: { item: MediaApiItem; onClose: () => void }) {
  const [playing, setPlaying] = useState(true)
  const [progress, setProgress] = useState(item.progress || 0)
  const videoRef = useRef<HTMLVideoElement>(null)

  const mediaSrc = item.stream_url || `/api/media/${item.id}/file`

  return (
    <div className="fixed inset-0 z-50 flex flex-col anim-fade-in" style={{ background: '#000' }}>
      <div className="relative flex-1 scanlines grain overflow-hidden flex items-center justify-center">
        {mediaSrc ? (
          <video
            ref={videoRef}
            src={mediaSrc}
            autoPlay
            controls
            className="w-full h-full object-contain"
            onTimeUpdate={() => {
              if (videoRef.current) {
                const percent = Math.round((videoRef.current.currentTime / videoRef.current.duration) * 100)
                if (!isNaN(percent)) setProgress(percent)
              }
            }}
          />
        ) : (
          <div className="relative z-10 text-center">
            <p className="text-xs tracking-widest text-[#ef4444] mb-2 font-mono">VHS MEDIA PLAYER</p>
            <h2 className="font-display text-4xl font-bold text-white mb-2">{item.title}</h2>
            <p className="text-xs text-gray-400">{item.duration || 'Stream'}</p>
          </div>
        )}
        <button onClick={onClose} className="absolute top-6 right-6 w-10 h-10 rounded-full flex items-center justify-center bg-black/60 text-white border border-white/20 z-50">
          <IcoX size={18} />
        </button>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// App Root
// ─────────────────────────────────────────────────────────────────────────────

export default function App() {
  const [user, setUser] = useState<UserProfile | null>(() => {
    try {
      const saved = localStorage.getItem('mediahub_user')
      return saved ? JSON.parse(saved) : null
    } catch {
      return null
    }
  })
  const [view, setView] = useState<View>('home')
  const [playing, setPlaying] = useState<MediaApiItem | null>(null)
  const [showBatchUpload, setShowBatchUpload] = useState(false)
  const bp = useBreakpoint()
  const isOnline = useOnlineStatus()

  const handleLogin = (selectedUser: UserProfile) => {
    setUser(selectedUser)
    try {
      localStorage.setItem('mediahub_user', JSON.stringify(selectedUser))
    } catch {}
  }

  const handleLogout = () => {
    setUser(null)
    api.setToken(null)
    try {
      localStorage.removeItem('mediahub_user')
    } catch {}
  }

  if (!user) {
    return <AuthView onLogin={handleLogin} />
  }

  const sidebarW = bp === 'lg' ? 220 : bp === 'md' ? 56 : 0

  return (
    <div className="fixed inset-0 flex flex-col" style={{ background: '#0b0b0e' }}>
      {/* Offline Banner */}
      {!isOnline && (
        <div className="w-full py-1 px-4 text-center text-xs font-semibold z-50 flex items-center justify-center gap-2"
          style={{ background: 'rgba(234,179,8,0.15)', color: '#eab308', borderBottom: '1px solid rgba(234,179,8,0.3)' }}>
          <span className="w-2 h-2 rounded-full bg-[#eab308] animate-pulse" />
          Offline Mode — Local Cache Active
        </div>
      )}

      <div className="flex-1 flex overflow-hidden relative">
        <Sidebar view={view} setView={setView} user={user} onLogout={handleLogout} bp={bp} />

        <main className="main-padded flex-1 flex flex-col overflow-hidden main-transition" style={{ marginLeft: sidebarW }}>
          {view === 'home'      && <HomeView onPlay={setPlaying} onOpenBatchUpload={() => setShowBatchUpload(true)} />}
          {view === 'library'   && <LibraryView onPlay={setPlaying} onOpenBatchUpload={() => setShowBatchUpload(true)} />}
          {view === 'playlists' && <PlaylistsView onPlay={setPlaying} />}
          {view === 'shorts'    && <ShortsView />}
          {view === 'history'   && <HistoryView onPlay={setPlaying} />}
          {view === 'admin'     && <AdminView onOpenBatchUpload={() => setShowBatchUpload(true)} />}
        </main>

        {bp === 'sm' && <BottomNav view={view} setView={setView} />}
        {playing && <PlayerOverlay item={playing} onClose={() => setPlaying(null)} />}
        {showBatchUpload && <BatchUploadModal onClose={() => setShowBatchUpload(false)} onUploadComplete={() => {}} />}
      </div>
    </div>
  )
}
