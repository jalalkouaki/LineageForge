'use client'

import { useCallback, useMemo, useState, useRef, useEffect } from 'react'
import {
  AlertCircle,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Check,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  Download,
  ExternalLink,
  FileCode2,
  FolderOpen,
  GitBranch,
  Layers3,
  Loader2,
  Maximize2,
  Network,
  Play,
  RefreshCw,
  Search,
  Settings2,
  Table2,
  X,
  Zap,
  Radio,
  ShieldAlert,
  Cpu,
  Workflow,
  SlidersHorizontal,
  Trash2,
  Eye,
  FileText,
  Copy,
} from 'lucide-react'

import {
  readDirectoryRecursive,
  parseFiles,
  buildConnectorPaths,
  groupByDir,
  generateSvgExport,
} from '@/lib/lineage'
import type { LineageNode, Edge } from '@/lib/lineage'

const kindConfig = {
  table: {
    icon: Table2,
    label: 'TABLE',
    color: '#4facfe',
    badgeClass: 'bg-[#4facfe]/10 text-[#4facfe] border-[#4facfe]/30',
    glowClass: 'shadow-[0_0_20px_rgba(79,172,254,0.35)] border-[#4facfe]/60',
    borderGlow: '#4facfe',
  },
  view: {
    icon: Layers3,
    label: 'VIEW',
    color: '#43e97b',
    badgeClass: 'bg-[#43e97b]/10 text-[#43e97b] border-[#43e97b]/30',
    glowClass: 'shadow-[0_0_20px_rgba(67,233,123,0.35)] border-[#43e97b]/60',
    borderGlow: '#43e97b',
  },
  model: {
    icon: GitBranch,
    label: 'MODEL',
    color: '#00f2fe',
    badgeClass: 'bg-[#00f2fe]/10 text-[#00f2fe] border-[#00f2fe]/30',
    glowClass: 'shadow-[0_0_20px_rgba(0,242,254,0.35)] border-[#00f2fe]/60',
    borderGlow: '#00f2fe',
  },
  source: {
    icon: FileCode2,
    label: 'SOURCE',
    color: '#fa709a',
    badgeClass: 'bg-[#fa709a]/10 text-[#fa709a] border-[#fa709a]/30',
    glowClass: 'shadow-[0_0_20px_rgba(250,112,154,0.35)] border-[#fa709a]/60',
    borderGlow: '#fa709a',
  },
}

function NodeIcon({ kind }: { kind: 'table' | 'view' | 'model' | 'source' }) {
  const Icon = kindConfig[kind]?.icon || Table2
  return <Icon size={14} strokeWidth={2} />
}

export default function Page() {
  // Always starts completely empty — no dummy information on fresh launch
  const [scannedNodes, setScannedNodes] = useState<LineageNode[]>([])
  const [edges, setEdges] = useState<Edge[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [activeTab, setActiveTab] = useState<'upstream' | 'downstream' | 'columns'>('upstream')
  const [expanded, setExpanded] = useState<string[]>([])
  const [scanning, setScanning] = useState(false)
  const [projectName, setProjectName] = useState('')
  const [lastScan, setLastScan] = useState<Date | null>(null)
  const [fileCount, setFileCount] = useState(0)
  const [scanError, setScanError] = useState<string | null>(null)
  const [showHelp, setShowHelp] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [showOrphanReport, setShowOrphanReport] = useState(false)
  const [showFilesModal, setShowFilesModal] = useState(false)
  const [selectedFileIndex, setSelectedFileIndex] = useState<number | null>(null)
  const [fileCopied, setFileCopied] = useState(false)
  const [copied, setCopied] = useState(false)
  const [uploadedFiles, setUploadedFiles] = useState<{ name: string; path: string; content: string }[]>([])
  const [kindFilter, setKindFilter] = useState<string>('all')

  // User Settings State
  const [settings, setSettings] = useState({
    enableEdgeFlow: true,
    enableGlow: true,
    enableAtmosphere: true,
    enableGrid: true,
    showColBadges: true,
    autoExpandFolders: true,
    impactThreshold: 2,
  })

  // Smooth Pan & Zoom state
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [isDragging, setIsDragging] = useState(false)
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 })

  const dirHandleRef = useRef<FileSystemDirectoryHandle | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const zoomIn = useCallback(() => setZoom((z) => Math.min(2.5, +(z + 0.15).toFixed(2))), [])
  const zoomOut = useCallback(() => setZoom((z) => Math.max(0.4, +(z - 0.15).toFixed(2))), [])
  const zoomFit = useCallback(() => {
    setZoom(1)
    setPan({ x: 0, y: 0 })
  }, [])

  // Clear any old stored dummy cache on initial startup
  useEffect(() => {
    try {
      localStorage.removeItem('lineage-scan')
      const savedSettings = localStorage.getItem('lineage-forge-settings')
      if (savedSettings) {
        setSettings((prev) => ({ ...prev, ...JSON.parse(savedSettings) }))
      }
    } catch {}
  }, [])

  const updateSetting = (key: keyof typeof settings, val: any) => {
    setSettings((prev) => {
      const next = { ...prev, [key]: val }
      try {
        localStorage.setItem('lineage-forge-settings', JSON.stringify(next))
      } catch {}
      return next
    })
  }

  const filteredNodes = useMemo(() => {
    return scannedNodes.filter((n) => {
      const matchesQuery =
        n.name.toLowerCase().includes(query.toLowerCase()) ||
        (n.filePath && n.filePath.toLowerCase().includes(query.toLowerCase()))
      const matchesKind = kindFilter === 'all' || n.kind === kindFilter
      return matchesQuery && matchesKind
    })
  }, [query, kindFilter, scannedNodes])

  const current = scannedNodes.find((n) => n.id === selected) ?? null
  const hasData = scannedNodes.length > 0
  const treeGroups = useMemo(() => groupByDir(scannedNodes), [scannedNodes])

  // Explicit action to clear & reset all data to empty
  const clearAllData = useCallback(() => {
    setScannedNodes([])
    setEdges([])
    setSelected(null)
    setProjectName('')
    setLastScan(null)
    setFileCount(0)
    setUploadedFiles([])
    dirHandleRef.current = null
    setExpanded([])
    setZoom(1)
    setPan({ x: 0, y: 0 })
    setSelectedFileIndex(null)
    try {
      localStorage.removeItem('lineage-scan')
    } catch {}
  }, [])

  const toggleExpanded = (id: string) =>
    setExpanded((items) => (items.includes(id) ? items.filter((item) => item !== id) : [...items, id]))

  const upstream = useMemo(() => {
    if (!selected) return []
    return edges
      .filter((e) => e.to === selected)
      .map((e) => scannedNodes.find((n) => n.id === e.from))
      .filter(Boolean) as LineageNode[]
  }, [selected, edges, scannedNodes])

  const downstream = useMemo(() => {
    if (!selected) return []
    return edges
      .filter((e) => e.from === selected)
      .map((e) => scannedNodes.find((n) => n.id === e.to))
      .filter(Boolean) as LineageNode[]
  }, [selected, edges, scannedNodes])

  // Orphan analysis & stats
  const orphanAnalysis = useMemo(() => {
    const orphans = scannedNodes.filter((n) => !edges.some((e) => e.from === n.id || e.to === n.id))
    const roots = scannedNodes.filter(
      (n) => !edges.some((e) => e.to === n.id) && edges.some((e) => e.from === n.id),
    )
    const sinks = scannedNodes.filter(
      (n) => edges.some((e) => e.to === n.id) && !edges.some((e) => e.from === n.id),
    )

    const impactScores = scannedNodes
      .map((n) => {
        const visited = new Set<string>()
        const queue = [n.id]
        while (queue.length > 0) {
          const curr = queue.shift()!
          const next = edges.filter((e) => e.from === curr).map((e) => e.to)
          for (const target of next) {
            if (!visited.has(target)) {
              visited.add(target)
              queue.push(target)
            }
          }
        }
        return { node: n, score: visited.size }
      })
      .sort((a, b) => b.score - a.score)

    return { orphans, roots, sinks, topImpact: impactScores.slice(0, 5) }
  }, [scannedNodes, edges])

  const connectors = useMemo(
    () => buildConnectorPaths(scannedNodes, edges, selected),
    [scannedNodes, edges, selected],
  )

  const doScan = useCallback(
    async (handle?: FileSystemDirectoryHandle) => {
      try {
        setScanError(null)
        let dirHandle = handle
        if (!dirHandle) {
          if (!('showDirectoryPicker' in window)) {
            setScanError(
              'Direct folder access API not supported in this browser. Please use the Browse button to select your folder.',
            )
            if (fileInputRef.current) fileInputRef.current.click()
            return
          }
          dirHandle = await (window as any).showDirectoryPicker()
          if (!dirHandle) return
        }
        dirHandleRef.current = dirHandle
        setScanning(true)
        setProjectName(dirHandle.name)

        const files = await readDirectoryRecursive(dirHandle)
        setFileCount(files.length)
        setUploadedFiles(files)
        const { nodes: parsedNodes, edges: parsedEdges } = parseFiles(files)

        setScannedNodes(parsedNodes)
        setEdges(parsedEdges)
        setLastScan(new Date())
        setSelected(parsedNodes[0]?.id || null)

        const groups = groupByDir(parsedNodes)
        if (settings.autoExpandFolders) {
          setExpanded(groups.map((g) => g.dir))
        }
        setZoom(1)
        setPan({ x: 0, y: 0 })
      } catch (err: any) {
        if (err?.name !== 'AbortError') {
          console.error('Scan failed:', err)
          setScanError(err?.message || 'Failed to scan workspace directory.')
        }
      } finally {
        setScanning(false)
      }
    },
    [settings.autoExpandFolders],
  )

  const doExportSvg = useCallback(() => {
    if (!hasData) return
    const svgContent = generateSvgExport(scannedNodes, edges, `${projectName || 'LineageForge'} Architecture`)
    const blob = new Blob([svgContent], { type: 'image/svg+xml;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${projectName || 'lineage'}-forge.svg`
    a.click()
    URL.revokeObjectURL(url)
  }, [hasData, projectName, scannedNodes, edges])

  const handleFileInput = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const fileList = Array.from(e.target.files || [])
      if (fileList.length === 0) return

      setScanError(null)
      setScanning(true)
      setProjectName('Uploaded Workspace')
      dirHandleRef.current = null

      const parsedFiles: { name: string; path: string; content: string }[] = []
      for (const file of fileList) {
        const content = await file.text()
        parsedFiles.push({
          name: file.name,
          path: file.webkitRelativePath || file.name,
          content,
        })
      }

      setFileCount(parsedFiles.length)
      setUploadedFiles(parsedFiles)
      const { nodes: parsedNodes, edges: parsedEdges } = parseFiles(parsedFiles)

      setScannedNodes(parsedNodes)
      setEdges(parsedEdges)
      setLastScan(new Date())
      setSelected(parsedNodes[0]?.id || null)

      const groups = groupByDir(parsedNodes)
      if (settings.autoExpandFolders) {
        setExpanded(groups.map((g) => g.dir))
      }
      setScanning(false)
      setZoom(1)
      setPan({ x: 0, y: 0 })
    },
    [settings.autoExpandFolders],
  )

  const doRefresh = useCallback(() => {
    if (dirHandleRef.current) {
      doScan(dirHandleRef.current)
    } else if (uploadedFiles.length > 0) {
      setScanning(true)
      const { nodes: parsedNodes, edges: parsedEdges } = parseFiles(uploadedFiles)
      setScannedNodes(parsedNodes)
      setEdges(parsedEdges)
      setLastScan(new Date())
      setScanning(false)
    }
  }, [doScan, uploadedFiles])

  // Robust Canvas Pan & Drag with Pointer Capture
  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement
    if (target.closest('button') || target.closest('.node-card')) return

    setIsDragging(true)
    setDragStart({ x: e.clientX - pan.x, y: e.clientY - pan.y })
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {}
  }

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDragging) return
    setPan({
      x: e.clientX - dragStart.x,
      y: e.clientY - dragStart.y,
    })
  }

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (isDragging) {
      setIsDragging(false)
      try {
        e.currentTarget.releasePointerCapture(e.pointerId)
      } catch {}
    }
  }

  // Smooth Mouse Wheel Panning / Zooming
  const handleWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    if (e.ctrlKey || e.metaKey) {
      const delta = e.deltaY < 0 ? 0.1 : -0.1
      setZoom((z) => Math.min(2.5, Math.max(0.3, +(z + delta).toFixed(2))))
    } else {
      setPan((prev) => ({
        x: prev.x - e.deltaX,
        y: prev.y - e.deltaY,
      }))
    }
  }

  return (
    <main className="relative flex flex-col h-screen w-screen overflow-hidden bg-[#0a0a0f] text-[#e0e0e0] font-sans select-none">
      {/* Atmosphere & Grid Background Layer */}
      {settings.enableAtmosphere && <div className="forge-atmosphere" />}
      {settings.enableGrid && (
        <>
          <div className="forge-grid" />
          <div className="forge-grid-dots" />
        </>
      )}

      {/* Hidden file input */}
      <input
        ref={fileInputRef as any}
        type="file"
        {...({ webkitdirectory: 'true', directory: 'true' } as any)}
        style={{ display: 'none' }}
        onChange={handleFileInput}
      />

      {/* Error Banner */}
      {scanError && (
        <div className="relative z-50 flex items-center justify-between px-4 py-2 bg-rose-950/80 border-b border-rose-500/40 text-rose-200 text-xs backdrop-blur-md">
          <div className="flex items-center gap-2">
            <AlertCircle size={15} className="text-rose-400" />
            <span>{scanError}</span>
          </div>
          <button
            type="button"
            onClick={() => setScanError(null)}
            className="p-1 hover:bg-rose-900/50 rounded text-rose-300 cursor-pointer"
          >
            <X size={14} />
          </button>
        </div>
      )}

      {/* ── TOP ACTION BAR ── */}
      <header className="relative z-40 flex items-center justify-between px-4 h-14 bg-[#101222]/80 backdrop-blur-xl border-b border-white/10 shadow-2xl">
        {/* Brand */}
        <div className="flex items-center gap-3">
          <div className="relative flex items-center justify-center w-8 h-8 rounded-lg bg-gradient-to-tr from-[#4facfe] to-[#00f2fe] text-black shadow-[0_0_15px_rgba(79,172,254,0.6)]">
            <Network size={18} strokeWidth={2.5} />
            <span className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-[#43e97b] animate-ping" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-extrabold text-sm tracking-tight text-white flex items-center gap-1.5">
                LINEAGE<span className="text-[#00f2fe]">FORGE</span>
              </span>
              <span className="px-1.5 py-0.5 rounded text-[9px] font-mono font-bold tracking-wider bg-[#4facfe]/20 text-[#4facfe] border border-[#4facfe]/30">
                FORGE ENGINE
              </span>
            </div>
          </div>
        </div>

        {/* Action Bar Pills */}
        <div className="flex items-center gap-2.5">
          {/* Scan Workspace Button */}
          <button
            type="button"
            onClick={() => doScan()}
            disabled={scanning}
            className="btn-pill-cyan flex items-center gap-2 px-4 py-1.5 rounded-full text-xs font-bold tracking-wide cursor-pointer disabled:opacity-50"
          >
            {scanning ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} fill="currentColor" />}
            <span>{scanning ? 'SCANNING CORE…' : 'SCAN DIRECTORY'}</span>
          </button>

          {/* Browse Files */}
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="btn-pill-ghost flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium cursor-pointer"
          >
            <FolderOpen size={13} className="text-[#4facfe]" />
            <span>Browse</span>
          </button>

          {/* Export SVG Button */}
          <button
            type="button"
            onClick={doExportSvg}
            disabled={!hasData}
            className="btn-pill-purple flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-semibold cursor-pointer disabled:opacity-40"
          >
            <Download size={13} />
            <span>Export SVG</span>
          </button>

          {/* Orphan Report Button */}
          <button
            type="button"
            onClick={() => setShowOrphanReport(true)}
            disabled={!hasData}
            className="btn-pill-pink flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-bold cursor-pointer disabled:opacity-40"
          >
            <ShieldAlert size={13} />
            <span>Orphan Report</span>
            {orphanAnalysis.orphans.length > 0 && (
              <span className="w-4 h-4 rounded-full bg-black/40 text-white text-[10px] flex items-center justify-center font-mono">
                {orphanAnalysis.orphans.length}
              </span>
            )}
          </button>

          {/* Show Files Button */}
          <button
            type="button"
            onClick={() => setShowFilesModal(true)}
            title="View scanned and used files"
            className="btn-pill-ghost flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-medium cursor-pointer text-[#00f2fe] border-[#00f2fe]/30 hover:border-[#00f2fe]"
          >
            <Eye size={13} />
            <span>Show Files</span>
            {uploadedFiles.length > 0 && (
              <span className="px-1.5 py-0.2 rounded-full text-[10px] font-mono bg-[#00f2fe]/20 text-[#00f2fe]">
                {uploadedFiles.length}
              </span>
            )}
          </button>
        </div>

        {/* Right Info & Search */}
        <div className="flex items-center gap-3">
          {/* Quick Search */}
          <div className="relative flex items-center">
            <Search size={14} className="absolute left-2.5 text-[#626282]" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search objects, models..."
              className="w-48 pl-8 pr-4 py-1 text-xs rounded-full bg-white/[0.05] border border-white/10 text-white placeholder-[#626282] focus:outline-none focus:border-[#4facfe] focus:ring-1 focus:ring-[#4facfe] transition-all"
            />
          </div>

          {/* Status badge */}
          {lastScan && (
            <div className="hidden xl:flex items-center gap-2 px-2.5 py-1 rounded-full bg-white/[0.04] border border-white/10 text-[11px] text-[#a0a0b8]">
              <span className="w-2 h-2 rounded-full bg-[#43e97b] shadow-[0_0_8px_#43e97b]" />
              <span className="font-mono text-[#00f2fe]">{projectName || 'Project'}</span>
              <span className="text-[#626282]">•</span>
              <span>{fileCount} files</span>
            </div>
          )}

          {/* Help & Settings */}
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setShowHelp(true)}
              className="p-2 rounded-lg text-[#a0a0b8] hover:text-white hover:bg-white/[0.08] transition-colors cursor-pointer"
              title="Documentation"
            >
              <CircleHelp size={16} />
            </button>
            <button
              type="button"
              onClick={() => setShowSettings(true)}
              className="p-2 rounded-lg text-[#a0a0b8] hover:text-white hover:bg-white/[0.08] transition-colors cursor-pointer"
              title="Settings"
            >
              <Settings2 size={16} />
            </button>
          </div>
        </div>
      </header>

      {/* ── MAIN WORKSPACE BODY ── */}
      <div className="relative z-10 flex-1 grid grid-cols-[260px_1fr_320px] overflow-hidden">
        {/* ── 1. SIDEBAR (Object Tree) ── */}
        <aside className="flex flex-col h-full bg-[#121426]/75 backdrop-blur-xl border-r border-white/10 overflow-hidden">
          {/* Sidebar Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-white/10 bg-white/[0.02]">
            <div>
              <div className="text-[10px] font-mono font-bold tracking-widest text-[#4facfe]">SYSTEM REPOSITORY</div>
              <h2 className="text-xs font-bold text-white tracking-tight flex items-center gap-2">
                <span>Object Explorer</span>
                <span className="px-1.5 py-0.2 rounded-full text-[10px] font-mono bg-white/10 text-[#a0a0b8]">
                  {scannedNodes.length}
                </span>
              </h2>
            </div>
            {hasData && (
              <button
                type="button"
                onClick={doRefresh}
                className="p-1.5 rounded text-[#a0a0b8] hover:text-[#00f2fe] hover:bg-white/5 transition-colors cursor-pointer"
                title="Refresh scan"
              >
                <RefreshCw size={13} />
              </button>
            )}
          </div>

          {/* Filter Pills with Live Counts */}
          {hasData && (
            <div className="flex items-center gap-1 px-3 py-2 border-b border-white/10 bg-black/20 text-[10px] font-mono overflow-x-auto scrollbar-none">
              {(['all', 'table', 'view', 'model', 'source'] as const).map((kind) => {
                const count = kind === 'all'
                  ? scannedNodes.length
                  : scannedNodes.filter((n) => n.kind === kind).length
                const isActive = kindFilter === kind
                return (
                  <button
                    key={kind}
                    type="button"
                    onClick={() => setKindFilter(kind)}
                    className={`px-2 py-1 rounded-md capitalize transition-all cursor-pointer flex items-center gap-1.5 shrink-0 ${
                      isActive
                        ? 'bg-[#4facfe]/20 text-[#00f2fe] border border-[#4facfe]/50 font-bold shadow-[0_0_10px_rgba(79,172,254,0.2)]'
                        : 'text-[#a0a0b8] hover:text-white hover:bg-white/5 border border-transparent'
                    }`}
                  >
                    <span>{kind}</span>
                    <span
                      className={`text-[9px] px-1 py-0.2 rounded font-mono ${
                        isActive ? 'bg-[#00f2fe]/30 text-white font-bold' : 'bg-white/10 text-[#a0a0b8]'
                      }`}
                    >
                      {count}
                    </span>
                  </button>
                )
              })}
            </div>
          )}

          {/* Tree Scroll Area */}
          <div className="flex-1 overflow-y-auto p-2 space-y-1">
            {!hasData && (
              <div className="flex flex-col items-center justify-center h-full text-center p-6 text-[#626282]">
                <Workflow size={32} className="text-[#4facfe]/30 mb-2.5 animate-pulse" />
                <p className="text-xs font-semibold text-[#a0a0b8]">No Workspace Loaded</p>
                <span className="text-[11px] mt-1 leading-relaxed text-[#626282]">
                  Scan a directory to inspect repository objects and dependencies.
                </span>
              </div>
            )}

            {hasData && filteredNodes.length === 0 && (
              <div className="flex flex-col items-center justify-center py-10 text-center px-4 text-[#626282]">
                <Search size={24} className="text-[#4facfe]/40 mb-2" />
                <p className="text-xs font-semibold text-[#a0a0b8]">No {kindFilter !== 'all' ? kindFilter : ''} objects found</p>
                <span className="text-[10px] mt-1 text-[#626282]">
                  {query ? `No objects match "${query}"` : `There are no ${kindFilter} objects in this scan.`}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setKindFilter('all')
                    setQuery('')
                  }}
                  className="mt-3 px-2.5 py-1 rounded bg-white/5 hover:bg-white/10 border border-white/10 text-[10px] font-mono text-[#00f2fe] cursor-pointer"
                >
                  Show All Objects
                </button>
              </div>
            )}

            {treeGroups.map((group) => {
              const isOpen = expanded.includes(group.dir)
              const groupNodes = group.items.filter((item) => filteredNodes.some((fn) => fn.id === item.id))
              if (groupNodes.length === 0) return null

              return (
                <div key={group.dir} className="rounded-lg overflow-hidden border border-white/[0.04] bg-white/[0.01]">
                  <button
                    type="button"
                    onClick={() => toggleExpanded(group.dir)}
                    className="w-full flex items-center justify-between px-2.5 py-1.5 text-left text-xs text-[#a0a0b8] hover:text-white hover:bg-white/[0.04] transition-colors cursor-pointer"
                  >
                    <div className="flex items-center gap-1.5 truncate">
                      {isOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                      <FolderOpen size={13} className="text-[#a855f7]" />
                      <span className="font-mono text-[11px] truncate">{group.dir}</span>
                    </div>
                    <span className="text-[10px] font-mono text-[#626282]">{groupNodes.length}</span>
                  </button>

                  {isOpen && (
                    <div className="pl-4 pr-1 py-1 space-y-0.5 border-l border-white/5 ml-3">
                      {groupNodes.map((item) => {
                        const isSelected = selected === item.id
                        const cfg = kindConfig[item.kind]
                        return (
                          <button
                            key={item.id}
                            type="button"
                            onClick={() => setSelected(item.id)}
                            className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded text-left text-xs transition-all cursor-pointer ${
                              isSelected
                                ? 'bg-gradient-to-r from-[#4facfe]/25 to-transparent text-white font-semibold border-l-2 border-[#00f2fe] shadow-[inset_0_0_10px_rgba(79,172,254,0.2)]'
                                : 'text-[#a0a0b8] hover:text-white hover:bg-white/[0.04]'
                            }`}
                            style={{
                              borderLeftColor: isSelected ? cfg.borderGlow : undefined,
                            }}
                          >
                            <span style={{ color: cfg.color }}>
                              <NodeIcon kind={item.kind} />
                            </span>
                            <span className="font-mono text-[11px] truncate flex-1">{item.name}</span>
                            <span className="text-[9px] font-mono text-[#626282] uppercase">{item.kind}</span>
                          </button>
                        )
                      })}
                    </div>
                  )}
                </div>
              )
            })}
          </div>

          {/* Sidebar Footer Legend */}
          <div className="p-3 border-t border-white/10 bg-black/30">
            <div className="text-[9px] font-mono font-bold tracking-widest text-[#626282] mb-1.5 uppercase">
              NODE TYPES
            </div>
            <div className="grid grid-cols-2 gap-1.5 text-[10px] font-mono">
              <span className="flex items-center gap-1.5 text-[#4facfe]">
                <span className="w-2 h-2 rounded-full bg-[#4facfe] shadow-[0_0_6px_#4facfe]" /> Table
              </span>
              <span className="flex items-center gap-1.5 text-[#43e97b]">
                <span className="w-2 h-2 rounded-full bg-[#43e97b] shadow-[0_0_6px_#43e97b]" /> View
              </span>
              <span className="flex items-center gap-1.5 text-[#00f2fe]">
                <span className="w-2 h-2 rounded-full bg-[#00f2fe] shadow-[0_0_6px_#00f2fe]" /> Model
              </span>
              <span className="flex items-center gap-1.5 text-[#fa709a]">
                <span className="w-2 h-2 rounded-full bg-[#fa709a] shadow-[0_0_6px_#fa709a]" /> Source
              </span>
            </div>
          </div>
        </aside>

        {/* ── 2. CENTER CANVAS ── */}
        <section className="relative flex flex-col h-full overflow-hidden bg-transparent">
          {/* Canvas Sub-Header */}
          <div className="relative z-20 flex items-center justify-between px-5 py-2.5 border-b border-white/10 bg-[#101222]/60 backdrop-blur-md">
            <div className="flex items-center gap-3">
              <div className="text-[10px] font-mono text-[#00f2fe] tracking-widest flex items-center gap-1.5">
                <Radio size={12} className="animate-pulse text-[#43e97b]" />
                <span>LINEAGE CANVAS</span>
              </div>
              <span className="text-[#626282]">•</span>
              <span className="text-xs font-semibold text-white">
                {current ? (
                  <span className="font-mono text-[#4facfe]">{current.name}</span>
                ) : hasData ? (
                  'Complete Lineage Topology'
                ) : (
                  'Empty Canvas'
                )}
              </span>
            </div>

            {hasData && (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setSelected(null)}
                  className="px-2.5 py-1 rounded text-[11px] font-mono text-[#a0a0b8] hover:text-white bg-white/5 hover:bg-white/10 border border-white/10 transition-all cursor-pointer"
                >
                  Reset Selection
                </button>
                <button
                  type="button"
                  onClick={zoomFit}
                  className="px-2.5 py-1 rounded text-[11px] font-mono text-[#00f2fe] bg-[#00f2fe]/10 hover:bg-[#00f2fe]/20 border border-[#00f2fe]/30 transition-all flex items-center gap-1 cursor-pointer"
                >
                  <Maximize2 size={12} /> Fit Graph
                </button>
              </div>
            )}
          </div>

          {/* Interactive Graph Viewport with Pointer Drag & Wheel Panning */}
          <div
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
            onWheel={handleWheel}
            className={`relative flex-1 w-full h-full overflow-hidden touch-none ${
              hasData ? (isDragging ? 'cursor-grabbing' : 'cursor-grab') : 'cursor-default'
            }`}
          >
            {hasData ? (
              <div
                style={{
                  transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
                  transformOrigin: '0 0',
                  transition: isDragging ? 'none' : 'transform 0.1s ease-out',
                  width: '100%',
                  height: '100%',
                  position: 'relative',
                }}
              >
                {/* SVG Connector Edge Layer */}
                <svg
                  className="absolute inset-0 w-[1400px] h-[900px] pointer-events-none overflow-visible"
                  aria-hidden="true"
                >
                  <defs>
                    <linearGradient id="edge-grad" x1="0%" y1="0%" x2="100%" y2="0%">
                      <stop offset="0%" stopColor="#a855f7" />
                      <stop offset="50%" stopColor="#ec4899" />
                      <stop offset="100%" stopColor="#4facfe" />
                    </linearGradient>
                    <linearGradient id="highlight-grad" x1="0%" y1="0%" x2="100%" y2="0%">
                      <stop offset="0%" stopColor="#43e97b" />
                      <stop offset="100%" stopColor="#00f2fe" />
                    </linearGradient>

                    <marker
                      id="forge-arrow"
                      viewBox="0 0 10 10"
                      refX="8"
                      refY="5"
                      markerWidth="6"
                      markerHeight="6"
                      orient="auto-start-reverse"
                    >
                      <path d="M 0 1 L 10 5 L 0 9 z" fill="#a855f7" />
                    </marker>
                    <marker
                      id="forge-arrow-highlight"
                      viewBox="0 0 10 10"
                      refX="8"
                      refY="5"
                      markerWidth="7"
                      markerHeight="7"
                      orient="auto-start-reverse"
                    >
                      <path d="M 0 1 L 10 5 L 0 9 z" fill="#00f2fe" />
                    </marker>
                  </defs>

                  {/* Regular Edges */}
                  {connectors.normal && (
                    <path
                      d={connectors.normal}
                      fill="none"
                      stroke="url(#edge-grad)"
                      strokeWidth="2"
                      className={`opacity-70 ${settings.enableEdgeFlow ? 'flowing-edge' : ''}`}
                      markerEnd="url(#forge-arrow)"
                    />
                  )}

                  {/* Highlighted Selected Edges */}
                  {connectors.highlight && (
                    <path
                      d={connectors.highlight}
                      fill="none"
                      stroke="url(#highlight-grad)"
                      strokeWidth="3.2"
                      className={`opacity-100 ${settings.enableEdgeFlow ? 'flowing-edge-fast' : ''}`}
                      style={{
                        filter: settings.enableGlow ? 'drop-shadow(0 0 8px rgba(0, 242, 254, 0.8))' : undefined,
                      }}
                      markerEnd="url(#forge-arrow-highlight)"
                    />
                  )}
                </svg>

                {/* Interactive Nodes */}
                {filteredNodes.map((node) => {
                  const isSelected = selected === node.id
                  const isUpstream = upstream.some((u) => u.id === node.id)
                  const isDownstream = downstream.some((d) => d.id === node.id)
                  const cfg = kindConfig[node.kind]

                  return (
                    <div
                      key={node.id}
                      style={{
                        left: `${node.x}%`,
                        top: `${node.y}%`,
                        transform: 'translate(-0%, -50%)',
                      }}
                      className="absolute node-card cursor-pointer select-none"
                      onClick={(e) => {
                        e.stopPropagation()
                        setSelected(node.id)
                      }}
                    >
                      {/* Node Selection Ripple Wave */}
                      {isSelected && settings.enableGlow && <div className="node-ripple" />}

                      {/* Node Card */}
                      <div
                        className={`relative flex items-center gap-3 px-3.5 py-2.5 rounded-xl border backdrop-blur-xl transition-all duration-200 ${
                          isSelected
                            ? `bg-[#151934] border-[#00f2fe] ${settings.enableGlow ? 'shadow-[0_0_30px_rgba(0,242,254,0.5)]' : ''} scale-105`
                            : isUpstream
                            ? `bg-[#142329] border-[#43e97b]/70 ${settings.enableGlow ? 'shadow-[0_0_20px_rgba(67,233,123,0.3)]' : ''}`
                            : isDownstream
                            ? `bg-[#24152a] border-[#fa709a]/70 ${settings.enableGlow ? 'shadow-[0_0_20px_rgba(250,112,154,0.3)]' : ''}`
                            : `bg-[#121428]/85 border-white/10 hover:border-white/30 hover:scale-[1.02] shadow-lg`
                        }`}
                        style={{
                          boxShadow:
                            settings.enableGlow && !isSelected && !isUpstream && !isDownstream
                              ? `0 0 15px ${cfg.color}15`
                              : undefined,
                        }}
                      >
                        {/* Node Icon Badge */}
                        <div
                          className="flex items-center justify-center w-8 h-8 rounded-lg border text-white font-bold"
                          style={{
                            backgroundColor: `${cfg.color}18`,
                            borderColor: `${cfg.color}50`,
                            color: cfg.color,
                            boxShadow: settings.enableGlow ? `0 0 12px ${cfg.color}40` : undefined,
                          }}
                        >
                          <NodeIcon kind={node.kind} />
                        </div>

                        {/* Node Text & Type Details */}
                        <div className="flex flex-col min-w-[120px] max-w-[190px]">
                          <span className="font-mono text-xs font-bold text-white truncate tracking-tight drop-shadow-md">
                            {node.name}
                          </span>
                          <div className="flex items-center gap-1.5 mt-0.5">
                            <span
                              className="px-1.5 py-0.2 rounded text-[9px] font-mono font-bold tracking-wider uppercase border"
                              style={{
                                backgroundColor: `${cfg.color}15`,
                                color: cfg.color,
                                borderColor: `${cfg.color}35`,
                              }}
                            >
                              {node.kind}
                            </span>
                            {settings.showColBadges && node.columns && (
                              <span className="text-[9px] font-mono text-[#a0a0b8]">
                                {node.columns.length} cols
                              </span>
                            )}
                          </div>
                        </div>

                        {/* Status indicator pulse */}
                        {isSelected && (
                          <span className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-[#00f2fe] shadow-[0_0_8px_#00f2fe]" />
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            ) : (
              /* Clean Empty State */
              <div className="absolute inset-0 flex flex-col items-center justify-center p-8 text-center pointer-events-auto">
                <div className="w-16 h-16 rounded-2xl bg-white/[0.04] border border-white/10 flex items-center justify-center text-[#4facfe] mb-4 shadow-xl">
                  <Network size={32} strokeWidth={1.5} />
                </div>
                <h3 className="text-base font-bold text-white tracking-tight">No Lineage Map Loaded</h3>
                <p className="text-xs text-[#a0a0b8] max-w-sm mt-1 mb-6 leading-relaxed">
                  Scan a local repository folder or browse SQL and YAML files to visualize your data pipeline topology and column-level dependencies.
                </p>
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => doScan()}
                    className="btn-pill-cyan px-5 py-2 rounded-full text-xs font-bold tracking-wide flex items-center gap-2 cursor-pointer"
                  >
                    <Play size={14} fill="currentColor" />
                    <span>Scan Directory</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="btn-pill-ghost px-4 py-2 rounded-full text-xs font-medium cursor-pointer"
                  >
                    <FolderOpen size={14} className="text-[#4facfe]" />
                    <span>Browse Files</span>
                  </button>
                </div>
              </div>
            )}

            {/* Floating HUD Controls */}
            {hasData && (
              <>
                <div className="absolute bottom-5 left-5 z-30 flex flex-col gap-1 p-1 rounded-xl bg-[#121426]/80 backdrop-blur-xl border border-white/10 shadow-2xl">
                  <button
                    type="button"
                    onClick={zoomIn}
                    className="w-8 h-8 flex items-center justify-center text-sm font-bold text-[#a0a0b8] hover:text-white hover:bg-white/10 rounded-lg transition-colors cursor-pointer"
                    title="Zoom In"
                  >
                    +
                  </button>
                  <button
                    type="button"
                    onClick={zoomOut}
                    className="w-8 h-8 flex items-center justify-center text-sm font-bold text-[#a0a0b8] hover:text-white hover:bg-white/10 rounded-lg transition-colors cursor-pointer"
                    title="Zoom Out"
                  >
                    −
                  </button>
                  <div className="h-px bg-white/10 mx-1" />
                  <button
                    type="button"
                    onClick={zoomFit}
                    className="w-8 h-8 flex items-center justify-center text-xs text-[#00f2fe] hover:bg-[#00f2fe]/10 rounded-lg transition-colors cursor-pointer"
                    title="Reset View"
                  >
                    <Maximize2 size={13} />
                  </button>
                </div>

                {/* Floating Stats Pill */}
                <div className="absolute bottom-5 right-5 z-30 flex items-center gap-3 px-3 py-1.5 rounded-full bg-[#121426]/80 backdrop-blur-xl border border-white/10 text-xs font-mono text-[#a0a0b8] shadow-2xl">
                  <span className="flex items-center gap-1.5 text-[#43e97b]">
                    <span className="w-2 h-2 rounded-full bg-[#43e97b] animate-pulse" />
                    Live Graph
                  </span>
                  <span>•</span>
                  <span>{scannedNodes.length} nodes</span>
                  <span>•</span>
                  <span>{edges.length} edges</span>
                </div>
              </>
            )}
          </div>
        </section>

        {/* ── 3. RIGHT PANEL (Property Inspector) ── */}
        <aside className="flex flex-col h-full bg-[#121426]/75 backdrop-blur-xl border-l border-white/10 overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-white/10 bg-white/[0.02]">
            <div>
              <div className="text-[10px] font-mono font-bold tracking-widest text-[#00f2fe]">INSPECTION MATRIX</div>
              <h2 className="text-xs font-bold text-white tracking-tight">Property Diagnostics</h2>
            </div>
            {current && (
              <button
                type="button"
                onClick={() => setSelected(null)}
                className="p-1 rounded text-[#a0a0b8] hover:text-white hover:bg-white/5 transition-colors cursor-pointer"
              >
                <X size={15} />
              </button>
            )}
          </div>

          {current ? (
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {/* Selected Object Primary Card */}
              <div className="glass-card rounded-2xl p-4 relative overflow-hidden border border-white/10">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <div
                      className="w-10 h-10 rounded-xl flex items-center justify-center font-bold"
                      style={{
                        backgroundColor: `${kindConfig[current.kind].color}20`,
                        color: kindConfig[current.kind].color,
                        border: `1px solid ${kindConfig[current.kind].color}50`,
                        boxShadow: settings.enableGlow ? `0 0 15px ${kindConfig[current.kind].color}30` : undefined,
                      }}
                    >
                      <NodeIcon kind={current.kind} />
                    </div>
                    <div>
                      <h3 className="text-sm font-bold text-white font-mono">{current.name}</h3>
                      <span
                        className="inline-block mt-0.5 px-2 py-0.5 rounded text-[9px] font-mono font-bold uppercase tracking-wider"
                        style={{
                          backgroundColor: `${kindConfig[current.kind].color}15`,
                          color: kindConfig[current.kind].color,
                          border: `1px solid ${kindConfig[current.kind].color}30`,
                        }}
                      >
                        {current.kind}
                      </span>
                    </div>
                  </div>

                  {/* Copy Path */}
                  {current.filePath && (
                    <button
                      type="button"
                      onClick={() => {
                        navigator.clipboard.writeText(current.filePath!)
                        setCopied(true)
                        setTimeout(() => setCopied(false), 1500)
                      }}
                      className="p-1.5 rounded-lg text-[#a0a0b8] hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
                      title={copied ? 'Copied path!' : 'Copy file path'}
                    >
                      {copied ? <Check size={14} className="text-[#43e97b]" /> : <ExternalLink size={14} />}
                    </button>
                  )}
                </div>

                {/* Metadata Properties Grid */}
                <div className="mt-4 pt-3 border-t border-white/10 space-y-2 text-xs">
                  {current.filePath && (
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-mono text-[#8892b0] tracking-widest uppercase">FILE</span>
                      <span
                        className="font-mono text-[11px] text-white truncate max-w-[170px]"
                        title={current.filePath}
                      >
                        {current.filePath}
                      </span>
                    </div>
                  )}
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-mono text-[#8892b0] tracking-widest uppercase">UPSTREAM</span>
                    <span className="font-mono text-[11px] font-bold text-[#43e97b]">{upstream.length} parents</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-mono text-[#8892b0] tracking-widest uppercase">DOWNSTREAM</span>
                    <span className="font-mono text-[11px] font-bold text-[#fa709a]">
                      {downstream.length} dependents
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-mono text-[#8892b0] tracking-widest uppercase">COLUMNS</span>
                    <span className="font-mono text-[11px] text-[#00f2fe]">
                      {current.columns?.length ?? 0} defined
                    </span>
                  </div>
                </div>
              </div>

              {/* Impact Analysis Diagnostic Card */}
              <div className="glass-card rounded-2xl p-4 border border-white/10">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[10px] font-mono font-bold tracking-widest text-[#fa709a] flex items-center gap-1.5">
                    <Zap size={13} /> BLAST RADIUS IMPACT
                  </span>
                  <span
                    className={`px-2 py-0.5 rounded text-[9px] font-mono font-bold ${
                      downstream.length >= settings.impactThreshold
                        ? 'bg-rose-500/20 text-rose-300 border border-rose-500/30'
                        : downstream.length > 0
                        ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                        : 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                    }`}
                  >
                    {downstream.length >= settings.impactThreshold
                      ? 'HIGH IMPACT'
                      : downstream.length > 0
                      ? 'MODERATE'
                      : 'LEAF / SAFE'}
                  </span>
                </div>
                <p className="text-[11px] text-[#a0a0b8] leading-relaxed">
                  Modifying <strong className="text-white font-mono">{current.name}</strong> directly affects{' '}
                  <strong className="text-[#00f2fe]">{downstream.length} downstream models/views</strong> in
                  production pipelines.
                </p>
              </div>

              {/* Tab Navigation */}
              <div className="flex p-1 rounded-xl bg-black/40 border border-white/10 text-xs font-mono">
                <button
                  type="button"
                  onClick={() => setActiveTab('upstream')}
                  className={`flex-1 py-1.5 rounded-lg flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
                    activeTab === 'upstream'
                      ? 'bg-[#43e97b]/20 text-[#43e97b] font-bold border border-[#43e97b]/40'
                      : 'text-[#a0a0b8] hover:text-white'
                  }`}
                >
                  <ArrowUp size={12} />
                  <span>Upstream ({upstream.length})</span>
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab('downstream')}
                  className={`flex-1 py-1.5 rounded-lg flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
                    activeTab === 'downstream'
                      ? 'bg-[#fa709a]/20 text-[#fa709a] font-bold border border-[#fa709a]/40'
                      : 'text-[#a0a0b8] hover:text-white'
                  }`}
                >
                  <ArrowDown size={12} />
                  <span>Down ({downstream.length})</span>
                </button>
                {current.columns && current.columns.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setActiveTab('columns')}
                    className={`flex-1 py-1.5 rounded-lg flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
                      activeTab === 'columns'
                        ? 'bg-[#00f2fe]/20 text-[#00f2fe] font-bold border border-[#00f2fe]/40'
                        : 'text-[#a0a0b8] hover:text-white'
                    }`}
                  >
                    <span>Cols ({current.columns.length})</span>
                  </button>
                )}
              </div>

              {/* Tab Content */}
              {activeTab === 'upstream' && (
                <div className="space-y-1.5">
                  {upstream.length === 0 ? (
                    <div className="text-center py-6 text-xs text-[#626282] font-mono">
                      No upstream parents (Root Source Node)
                    </div>
                  ) : (
                    upstream.map((up) => (
                      <button
                        key={up.id}
                        type="button"
                        onClick={() => setSelected(up.id)}
                        className="w-full flex items-center justify-between p-2.5 rounded-xl bg-white/[0.03] hover:bg-white/[0.08] border border-white/5 hover:border-[#43e97b]/40 transition-all text-left group cursor-pointer"
                      >
                        <div className="flex items-center gap-2 truncate">
                          <span className="text-[#43e97b]">
                            <NodeIcon kind={up.kind} />
                          </span>
                          <span className="font-mono text-xs text-white truncate">{up.name}</span>
                        </div>
                        <span className="text-[9px] font-mono text-[#626282] group-hover:text-[#43e97b] uppercase">
                          Inspect →
                        </span>
                      </button>
                    ))
                  )}
                </div>
              )}

              {activeTab === 'downstream' && (
                <div className="space-y-1.5">
                  {downstream.length === 0 ? (
                    <div className="text-center py-6 text-xs text-[#626282] font-mono">
                      No downstream dependents (Terminal Leaf/View)
                    </div>
                  ) : (
                    downstream.map((down) => (
                      <button
                        key={down.id}
                        type="button"
                        onClick={() => setSelected(down.id)}
                        className="w-full flex items-center justify-between p-2.5 rounded-xl bg-white/[0.03] hover:bg-white/[0.08] border border-white/5 hover:border-[#fa709a]/40 transition-all text-left group cursor-pointer"
                      >
                        <div className="flex items-center gap-2 truncate">
                          <span className="text-[#fa709a]">
                            <NodeIcon kind={down.kind} />
                          </span>
                          <span className="font-mono text-xs text-white truncate">{down.name}</span>
                        </div>
                        <span className="text-[9px] font-mono text-[#626282] group-hover:text-[#fa709a] uppercase">
                          Inspect →
                        </span>
                      </button>
                    ))
                  )}
                </div>
              )}

              {activeTab === 'columns' && current.columns && (
                <div className="space-y-1.5">
                  {current.columns.map((col) => (
                    <div key={col.name} className="p-2.5 rounded-xl bg-white/[0.03] border border-white/5 space-y-1">
                      <div className="flex items-center justify-between">
                        <span className="font-mono text-xs font-bold text-white">{col.name}</span>
                        <span className="px-1.5 py-0.2 rounded text-[9px] font-mono bg-white/10 text-[#00f2fe]">
                          {col.type || 'FIELD'}
                        </span>
                      </div>
                      {col.sources.length > 0 && (
                        <div className="text-[10px] font-mono text-[#a0a0b8] pt-1 border-t border-white/5">
                          <span className="text-[#4facfe]">←</span>{' '}
                          {col.sources.map((s) => `${s.table}.${s.column}`).join(', ')}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center h-full p-6 text-center text-[#626282]">
              <Cpu size={36} className="text-[#4facfe]/30 mb-3 animate-pulse" />
              <h3 className="text-xs font-bold text-[#a0a0b8] font-mono uppercase tracking-wider">
                Awaiting Target Selection
              </h3>
              <p className="text-[11px] mt-1 leading-relaxed">
                Click any table, view, or model node on the canvas to inspect dependencies, column lineage, and blast radius impact.
              </p>
            </div>
          )}
        </aside>
      </div>

      {/* ── 4. SHOW FILES MODAL (Scanned & Analyzed Files Explorer) ── */}
      {showFilesModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-fadeIn"
          onClick={() => setShowFilesModal(false)}
        >
          <div
            className="relative w-full max-w-4xl max-h-[85vh] flex flex-col rounded-2xl bg-[#121428] border border-[#00f2fe]/30 shadow-[0_0_50px_rgba(0,242,254,0.2)] text-[#e0e0e0] overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-white/10 bg-white/[0.02]">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-xl bg-gradient-to-tr from-[#4facfe] to-[#00f2fe] text-black">
                  <FileText size={20} />
                </div>
                <div>
                  <h2 className="text-base font-bold text-white tracking-tight flex items-center gap-2">
                    <span>Scanned Workspace Files</span>
                    <span className="px-2 py-0.5 rounded-full text-xs font-mono bg-[#00f2fe]/20 text-[#00f2fe] border border-[#00f2fe]/30">
                      {uploadedFiles.length} files
                    </span>
                  </h2>
                  <p className="text-xs text-[#a0a0b8]">Files parsed to build table dependencies and column-level lineages</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowFilesModal(false)}
                className="p-1.5 rounded-lg text-[#a0a0b8] hover:text-white hover:bg-white/10 cursor-pointer"
              >
                <X size={18} />
              </button>
            </div>

            {/* Modal Content */}
            <div className="flex-1 overflow-hidden grid grid-cols-[300px_1fr] min-h-[380px]">
              {/* File List Column */}
              <div className="border-r border-white/10 overflow-y-auto p-3 space-y-1.5 bg-black/20">
                {uploadedFiles.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-48 text-center p-4 text-[#626282]">
                    <FileCode2 size={32} className="text-[#00f2fe]/30 mb-2" />
                    <p className="text-xs font-semibold text-[#a0a0b8]">No Files Loaded</p>
                    <span className="text-[11px] mt-1">Scan a local workspace folder or browse files.</span>
                  </div>
                ) : (
                  uploadedFiles.map((file, idx) => {
                    const isSelected = (selectedFileIndex ?? 0) === idx
                    const ext = file.name.split('.').pop()?.toUpperCase() || 'FILE'
                    return (
                      <button
                        key={idx}
                        type="button"
                        onClick={() => setSelectedFileIndex(idx)}
                        className={`w-full flex items-center justify-between p-2.5 rounded-xl text-left text-xs transition-all cursor-pointer ${
                          isSelected
                            ? 'bg-[#00f2fe]/15 text-white border border-[#00f2fe]/40 font-semibold shadow-[0_0_15px_rgba(0,242,254,0.15)]'
                            : 'text-[#a0a0b8] hover:text-white hover:bg-white/[0.04] border border-transparent'
                        }`}
                      >
                        <div className="flex items-center gap-2 truncate">
                          <FileCode2 size={14} className={isSelected ? 'text-[#00f2fe]' : 'text-[#a0a0b8]'} />
                          <span className="font-mono text-xs truncate">{file.name}</span>
                        </div>
                        <span className="px-1.5 py-0.2 rounded text-[9px] font-mono bg-white/10 text-[#a0a0b8]">
                          {ext}
                        </span>
                      </button>
                    )
                  })
                )}
              </div>

              {/* File Content Preview Column */}
              <div className="flex flex-col h-full overflow-hidden bg-black/40">
                {uploadedFiles.length > 0 ? (
                  (() => {
                    const activeFile = uploadedFiles[selectedFileIndex ?? 0]
                    if (!activeFile) return null
                    return (
                      <>
                        <div className="flex items-center justify-between px-4 py-2.5 border-b border-white/10 bg-white/[0.02]">
                          <div className="flex items-center gap-2 truncate">
                            <span className="text-xs font-mono text-[#00f2fe] truncate">{activeFile.path}</span>
                            <span className="text-[10px] font-mono text-[#626282]">• {activeFile.content.length} characters</span>
                          </div>
                          <button
                            type="button"
                            onClick={() => {
                              navigator.clipboard.writeText(activeFile.content)
                              setFileCopied(true)
                              setTimeout(() => setFileCopied(false), 1500)
                            }}
                            className="flex items-center gap-1 px-2.5 py-1 rounded text-xs font-mono text-[#a0a0b8] hover:text-white bg-white/5 hover:bg-white/10 border border-white/10 transition-colors cursor-pointer"
                          >
                            {fileCopied ? <Check size={12} className="text-[#43e97b]" /> : <Copy size={12} />}
                            <span>{fileCopied ? 'Copied' : 'Copy'}</span>
                          </button>
                        </div>
                        <div className="flex-1 overflow-auto p-4 font-mono text-xs text-[#e0e0e0] leading-relaxed bg-[#0a0a0f]/60">
                          <pre className="whitespace-pre-wrap">{activeFile.content}</pre>
                        </div>
                      </>
                    )
                  })()
                ) : (
                  <div className="flex flex-col items-center justify-center h-full p-8 text-center text-[#626282]">
                    <p className="text-xs text-[#a0a0b8]">No file selected for preview</p>
                    <div className="flex items-center gap-3 mt-4">
                      <button
                        type="button"
                        onClick={() => {
                          setShowFilesModal(false)
                          doScan()
                        }}
                        className="btn-pill-cyan px-4 py-1.5 rounded-full text-xs font-bold flex items-center gap-1.5 cursor-pointer"
                      >
                        <Play size={13} fill="currentColor" />
                        <span>Scan Directory</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setShowFilesModal(false)
                          fileInputRef.current?.click()
                        }}
                        className="btn-pill-ghost px-4 py-1.5 rounded-full text-xs font-medium cursor-pointer"
                      >
                        <FolderOpen size={13} className="text-[#4facfe]" />
                        <span>Browse Files</span>
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── 5. ORPHAN REPORT MODAL ── */}
      {showOrphanReport && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-fadeIn"
          onClick={() => setShowOrphanReport(false)}
        >
          <div
            className="relative w-full max-w-2xl max-h-[85vh] overflow-y-auto rounded-2xl bg-[#121428] border border-[#fa709a]/40 shadow-[0_0_50px_rgba(250,112,154,0.3)] p-6 text-[#e0e0e0]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between pb-4 border-b border-white/10">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-xl bg-gradient-to-tr from-[#fa709a] to-[#fee140] text-black">
                  <ShieldAlert size={20} />
                </div>
                <div>
                  <h2 className="text-base font-bold text-white tracking-tight">Lineage Health & Orphan Diagnostics</h2>
                  <p className="text-xs text-[#a0a0b8]">Pipeline integrity scan for unlinked tables and critical bottlenecks</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowOrphanReport(false)}
                className="p-1.5 rounded-lg text-[#a0a0b8] hover:text-white hover:bg-white/10 cursor-pointer"
              >
                <X size={18} />
              </button>
            </div>

            <div className="mt-5 space-y-5">
              {/* Orphan Tables Section */}
              <div className="p-4 rounded-xl bg-white/[0.02] border border-white/10">
                <div className="flex items-center justify-between mb-2">
                  <h4 className="text-xs font-mono font-bold text-[#fa709a] uppercase tracking-wider flex items-center gap-1.5">
                    <AlertCircle size={14} /> Disconnected / Orphan Nodes ({orphanAnalysis.orphans.length})
                  </h4>
                  <span className="text-[10px] font-mono text-[#a0a0b8]">0 upstream & 0 downstream</span>
                </div>
                {orphanAnalysis.orphans.length === 0 ? (
                  <p className="text-xs text-[#43e97b] font-mono">✓ No orphan objects detected. Entire pipeline is connected.</p>
                ) : (
                  <div className="grid grid-cols-2 gap-2 mt-2">
                    {orphanAnalysis.orphans.map((o) => (
                      <button
                        key={o.id}
                        type="button"
                        onClick={() => {
                          setSelected(o.id)
                          setShowOrphanReport(false)
                        }}
                        className="p-2.5 rounded-lg bg-black/40 hover:bg-[#fa709a]/20 border border-white/5 hover:border-[#fa709a] text-left transition-all cursor-pointer"
                      >
                        <div className="font-mono text-xs font-bold text-white">{o.name}</div>
                        <div className="text-[10px] text-[#fa709a] uppercase">{o.kind}</div>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Critical Impact Bottlenecks */}
              <div className="p-4 rounded-xl bg-white/[0.02] border border-white/10">
                <h4 className="text-xs font-mono font-bold text-[#00f2fe] uppercase tracking-wider mb-2 flex items-center gap-1.5">
                  <Zap size={14} /> Highest Impact Core Models
                </h4>
                <div className="space-y-1.5">
                  {orphanAnalysis.topImpact.map((item, idx) => (
                    <div
                      key={item.node.id}
                      className="flex items-center justify-between p-2 rounded-lg bg-black/30 text-xs font-mono"
                    >
                      <div className="flex items-center gap-2">
                        <span className="text-[#a855f7] font-bold">#{idx + 1}</span>
                        <span className="text-white font-bold">{item.node.name}</span>
                        <span className="text-[10px] text-[#626282] uppercase">({item.node.kind})</span>
                      </div>
                      <span className="px-2 py-0.5 rounded bg-[#00f2fe]/10 text-[#00f2fe] border border-[#00f2fe]/30 font-bold">
                        {item.score} downstream descendants
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── 6. HELP MODAL ── */}
      {showHelp && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md"
          onClick={() => setShowHelp(false)}
        >
          <div
            className="relative w-full max-w-md rounded-2xl bg-[#121428] border border-[#4facfe]/30 shadow-2xl p-6 text-[#e0e0e0]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between pb-3 border-b border-white/10">
              <h2 className="text-sm font-bold text-white font-mono">Lineage Forge Guide</h2>
              <button
                type="button"
                onClick={() => setShowHelp(false)}
                className="p-1 rounded text-[#a0a0b8] hover:text-white cursor-pointer"
              >
                <X size={16} />
              </button>
            </div>
            <div className="mt-4 space-y-3 text-xs text-[#a0a0b8] leading-relaxed">
              <p>
                <strong className="text-white">Lineage Forge</strong> parses SQL models, dbt refs, source definitions, and ETL scripts directly in your browser.
              </p>
              <ul className="list-disc pl-4 space-y-1.5 text-[11px]">
                <li><strong className="text-[#4facfe]">Scan Directory</strong>: Choose any local repo with .sql / .yml / .py files.</li>
                <li><strong className="text-[#43e97b]">Canvas Navigation</strong>: Click and drag anywhere to pan; scroll to pan or pinch to zoom.</li>
                <li><strong className="text-[#fa709a]">Orphan Report</strong>: Identify isolated tables and blast radius impact score.</li>
                <li><strong className="text-[#00f2fe]">Show Files</strong>: Browse and preview all analyzed workspace source files.</li>
                <li><strong className="text-[#a855f7]">Export SVG</strong>: Download high-resolution vector diagrams of your lineage topology.</li>
              </ul>
            </div>
          </div>
        </div>
      )}

      {/* ── 7. EXPANDED SETTINGS MODAL ── */}
      {showSettings && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-fadeIn"
          onClick={() => setShowSettings(false)}
        >
          <div
            className="relative w-full max-w-xl max-h-[85vh] overflow-y-auto rounded-2xl bg-[#121428] border border-white/10 shadow-2xl p-6 text-[#e0e0e0]"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Settings Header */}
            <div className="flex items-center justify-between pb-4 border-b border-white/10">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-xl bg-white/10 text-white">
                  <SlidersHorizontal size={20} />
                </div>
                <div>
                  <h2 className="text-base font-bold text-white font-mono">Workspace & Graph Preferences</h2>
                  <p className="text-xs text-[#a0a0b8]">Customize graph rendering, animations, and pipeline rules</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowSettings(false)}
                className="p-1.5 rounded-lg text-[#a0a0b8] hover:text-white hover:bg-white/10 cursor-pointer"
              >
                <X size={18} />
              </button>
            </div>

            <div className="mt-5 space-y-6 text-xs">
              {/* Section 1: Canvas & Visuals */}
              <div className="space-y-3">
                <h4 className="text-[11px] font-mono font-bold uppercase tracking-wider text-[#00f2fe]">
                  CANVAS & ANIMATION SETTINGS
                </h4>
                <div className="p-3 rounded-xl bg-white/[0.02] border border-white/5 space-y-3">
                  {/* Flow Animation */}
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="font-semibold text-white">Flowing Edge Data Stream</div>
                      <div className="text-[11px] text-[#a0a0b8]">Animate directional particle dashes along relationship lines</div>
                    </div>
                    <button
                      type="button"
                      onClick={() => updateSetting('enableEdgeFlow', !settings.enableEdgeFlow)}
                      className={`px-3 py-1 rounded-full text-xs font-mono font-bold transition-all cursor-pointer ${
                        settings.enableEdgeFlow
                          ? 'bg-[#43e97b]/20 text-[#43e97b] border border-[#43e97b]/40'
                          : 'bg-white/5 text-[#a0a0b8] border border-white/10'
                      }`}
                    >
                      {settings.enableEdgeFlow ? 'ENABLED' : 'DISABLED'}
                    </button>
                  </div>

                  {/* Glow Effects */}
                  <div className="flex items-center justify-between pt-2 border-t border-white/5">
                    <div>
                      <div className="font-semibold text-white">Node Glow & Outer Halo</div>
                      <div className="text-[11px] text-[#a0a0b8]">Render soft outer drop-shadows and selection wave halos</div>
                    </div>
                    <button
                      type="button"
                      onClick={() => updateSetting('enableGlow', !settings.enableGlow)}
                      className={`px-3 py-1 rounded-full text-xs font-mono font-bold transition-all cursor-pointer ${
                        settings.enableGlow
                          ? 'bg-[#00f2fe]/20 text-[#00f2fe] border border-[#00f2fe]/40'
                          : 'bg-white/5 text-[#a0a0b8] border border-white/10'
                      }`}
                    >
                      {settings.enableGlow ? 'ENABLED' : 'DISABLED'}
                    </button>
                  </div>

                  {/* Radial Atmosphere */}
                  <div className="flex items-center justify-between pt-2 border-t border-white/5">
                    <div>
                      <div className="font-semibold text-white">Background Atmosphere</div>
                      <div className="text-[11px] text-[#a0a0b8]">Render ambient background light pulses</div>
                    </div>
                    <button
                      type="button"
                      onClick={() => updateSetting('enableAtmosphere', !settings.enableAtmosphere)}
                      className={`px-3 py-1 rounded-full text-xs font-mono font-bold transition-all cursor-pointer ${
                        settings.enableAtmosphere
                          ? 'bg-[#a855f7]/20 text-[#a855f7] border border-[#a855f7]/40'
                          : 'bg-white/5 text-[#a0a0b8] border border-white/10'
                      }`}
                    >
                      {settings.enableAtmosphere ? 'ENABLED' : 'DISABLED'}
                    </button>
                  </div>

                  {/* Grid Lines */}
                  <div className="flex items-center justify-between pt-2 border-t border-white/5">
                    <div>
                      <div className="font-semibold text-white">Canvas Matrix Grid</div>
                      <div className="text-[11px] text-[#a0a0b8]">Show coordinate background grid pattern</div>
                    </div>
                    <button
                      type="button"
                      onClick={() => updateSetting('enableGrid', !settings.enableGrid)}
                      className={`px-3 py-1 rounded-full text-xs font-mono font-bold transition-all cursor-pointer ${
                        settings.enableGrid
                          ? 'bg-[#4facfe]/20 text-[#4facfe] border border-[#4facfe]/40'
                          : 'bg-white/5 text-[#a0a0b8] border border-white/10'
                      }`}
                    >
                      {settings.enableGrid ? 'ENABLED' : 'DISABLED'}
                    </button>
                  </div>
                </div>
              </div>

              {/* Section 2: Workspace & Pipeline Engine */}
              <div className="space-y-3">
                <h4 className="text-[11px] font-mono font-bold uppercase tracking-wider text-[#43e97b]">
                  WORKSPACE & ANALYSIS ENGINE
                </h4>
                <div className="p-3 rounded-xl bg-white/[0.02] border border-white/5 space-y-3">
                  {/* Column Badges */}
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="font-semibold text-white">Show Column Counts on Node Cards</div>
                      <div className="text-[11px] text-[#a0a0b8]">Display column count pill on graph nodes</div>
                    </div>
                    <button
                      type="button"
                      onClick={() => updateSetting('showColBadges', !settings.showColBadges)}
                      className={`px-3 py-1 rounded-full text-xs font-mono font-bold transition-all cursor-pointer ${
                        settings.showColBadges
                          ? 'bg-[#43e97b]/20 text-[#43e97b] border border-[#43e97b]/40'
                          : 'bg-white/5 text-[#a0a0b8] border border-white/10'
                      }`}
                    >
                      {settings.showColBadges ? 'ON' : 'OFF'}
                    </button>
                  </div>

                  {/* Auto-expand Folders */}
                  <div className="flex items-center justify-between pt-2 border-t border-white/5">
                    <div>
                      <div className="font-semibold text-white">Auto-Expand Repository Directories</div>
                      <div className="text-[11px] text-[#a0a0b8]">Automatically open all folders in sidebar after scanning</div>
                    </div>
                    <button
                      type="button"
                      onClick={() => updateSetting('autoExpandFolders', !settings.autoExpandFolders)}
                      className={`px-3 py-1 rounded-full text-xs font-mono font-bold transition-all cursor-pointer ${
                        settings.autoExpandFolders
                          ? 'bg-[#43e97b]/20 text-[#43e97b] border border-[#43e97b]/40'
                          : 'bg-white/5 text-[#a0a0b8] border border-white/10'
                      }`}
                    >
                      {settings.autoExpandFolders ? 'ON' : 'OFF'}
                    </button>
                  </div>

                  {/* High Blast Radius Threshold */}
                  <div className="flex items-center justify-between pt-2 border-t border-white/5">
                    <div>
                      <div className="font-semibold text-white">High Impact Alert Threshold</div>
                      <div className="text-[11px] text-[#a0a0b8]">Number of downstream dependents for High Risk label</div>
                    </div>
                    <div className="flex items-center gap-1">
                      {[2, 3, 5].map((val) => (
                        <button
                          key={val}
                          type="button"
                          onClick={() => updateSetting('impactThreshold', val)}
                          className={`w-8 h-7 rounded text-xs font-mono font-bold transition-all cursor-pointer ${
                            settings.impactThreshold === val
                              ? 'bg-[#fa709a]/20 text-[#fa709a] border border-[#fa709a]/40'
                              : 'bg-white/5 text-[#a0a0b8] hover:text-white border border-white/5'
                          }`}
                        >
                          {val}+
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </div>

              {/* Section 3: Data Management */}
              <div className="space-y-3">
                <h4 className="text-[11px] font-mono font-bold uppercase tracking-wider text-[#fa709a]">
                  DATA & CACHE CONTROLS
                </h4>
                <div className="p-3 rounded-xl bg-white/[0.02] border border-white/5 space-y-3">
                  {/* Reset and Clear Data */}
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="font-semibold text-white">Reset & Clear Map</div>
                      <div className="text-[11px] text-[#a0a0b8]">Wipe all loaded objects and return to an empty workspace</div>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        clearAllData()
                        setShowSettings(false)
                      }}
                      className="px-3.5 py-1.5 rounded-lg bg-rose-500/20 text-rose-300 hover:bg-rose-500/30 border border-rose-500/30 text-xs font-mono font-bold cursor-pointer transition-colors flex items-center gap-1.5"
                    >
                      <Trash2 size={13} />
                      <span>Clear All</span>
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </main>
  )
}
