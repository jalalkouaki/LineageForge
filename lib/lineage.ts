export type NodeKind = 'table' | 'view' | 'model' | 'source'
export type ColumnLineage = { name: string; type?: string; sources: { table: string; column: string }[] }
export type LineageNode = { 
  id: string
  name: string
  kind: NodeKind
  meta: string
  x: number
  y: number
  filePath?: string
  columns?: ColumnLineage[] 
}
export type Edge = { from: string; to: string; columns?: { fromCol: string; toCol: string }[] }
export type ParsedObject = { kind: NodeKind; filePath: string; refs: string[]; columns: ColumnLineage[] }
export type TreeGroup = { dir: string; items: LineageNode[] }

export type ConnectorEdge = {
  id: string
  from: string
  to: string
  d: string
  x1: number
  y1: number
  x2: number
  y2: number
  isHighlighted: boolean
  isUpstream: boolean
  isDownstream: boolean
  columns?: { fromCol: string; toCol: string }[]
}

export const NODE_WIDTH = 220
export const NODE_HEIGHT = 60
export const COL_GAP = 140
export const ROW_GAP = 36
export const START_X = 60
export const START_Y = 80

export async function readDirectoryRecursive(
  dirHandle: FileSystemDirectoryHandle,
  path = '',
): Promise<{ name: string; path: string; content: string }[]> {
  const files: { name: string; path: string; content: string }[] = []
  const extensions = ['.sql', '.yml', '.yaml', '.py', '.json']
  const skipDirs = new Set(['node_modules', '.git', '__pycache__', '.venv', 'venv', '.next', 'dist', 'build'])

  for await (const [name, handle] of dirHandle as any) {
    const fullPath = path ? `${path}/${name}` : name
    if (handle.kind === 'directory') {
      if (skipDirs.has(name)) continue
      const subFiles = await readDirectoryRecursive(handle, fullPath)
      files.push(...subFiles)
    } else if (handle.kind === 'file' && extensions.some((ext) => name.toLowerCase().endsWith(ext))) {
      try {
        const file = await (handle as FileSystemFileHandle).getFile()
        if (file.size > 512_000) continue
        const content = await file.text()
        files.push({ name, path: fullPath, content })
      } catch {
        /* skip unreadable */
      }
    }
  }
  return files
}

const SQL_RESERVED = new Set([
  'select','where','group','order','limit','union','having','set','values',
  'into','dual','null','true','false','as','on','and','or','not','in','is',
  'case','when','then','else','end','exists','between','like','with','distinct',
  'by','from','join','left','right','inner','outer','cross','full','natural',
  'all','any','some','asc','desc','offset','fetch','top','percent','rows',
  'first','next','only','over','partition','row_number','rank','dense_rank',
  'insert','update','delete','drop','alter','index','constraint','primary',
  'foreign','key','references','default','check','unique','cascade','restrict',
  'lateral','unnest','generate_series','information_schema','using','table',
  'view','database','schema','temporary','temp','unlogged','materialized',
])

function stripComments(sql: string): string {
  return sql
    .replace(/--[^\n]*/g, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
}

function stripCommentsAndStrings(sql: string): string {
  return stripComments(sql)
    .replace(/'(?:''|[^'])*'/g, "''")
    .replace(/\$\$[\s\S]*?\$\$/g, "''")
}

function cleanIdentifier(raw: string): string {
  if (!raw) return ''
  return raw
    .trim()
    .replace(/^[\["`']+|[\]"`']+$/g, '')
    .split('.')
    .pop()!
    .toLowerCase()
}

function extractCteNames(sql: string): Set<string> {
  const clean = stripCommentsAndStrings(sql)
  const ctes = new Set<string>()
  const withMatch = clean.match(/\bwith\s+([a-zA-Z_`"\[][\w.`"\]]*)\s+as\s*\(/i)
  if (withMatch) {
    const name = cleanIdentifier(withMatch[1])
    if (name && !SQL_RESERVED.has(name)) ctes.add(name)
    const extraCtes = clean.matchAll(/,\s*([a-zA-Z_`"\[][\w.`"\]]*)\s+as\s*\(/gi)
    for (const match of extraCtes) {
      const extraName = cleanIdentifier(match[1])
      if (extraName && !SQL_RESERVED.has(extraName)) ctes.add(extraName)
    }
  }
  return ctes
}

function splitStatements(sql: string): string[] {
  const clean = stripComments(sql)
  const stmts: string[] = []
  let depth = 0
  let start = 0
  let inSingleQuote = false

  for (let i = 0; i < clean.length; i++) {
    const char = clean[i]
    if (char === "'" && clean[i - 1] !== '\\') {
      inSingleQuote = !inSingleQuote
      continue
    }
    if (inSingleQuote) continue

    if (char === '(') depth++
    else if (char === ')' && depth > 0) depth--
    else if (char === ';' && depth === 0) {
      const stmt = clean.substring(start, i).trim()
      if (stmt) stmts.push(stmt)
      start = i + 1
    }
  }
  const rem = clean.substring(start).trim()
  if (rem) stmts.push(rem)
  return stmts
}

function extractTableRefs(sql: string, selfName: string): string[] {
  const clean = stripCommentsAndStrings(sql)
  const refs = new Set<string>()
  const cteNames = extractCteNames(sql)
  const normalizedSelf = cleanIdentifier(selfName)

  // 1. Standard FROM / JOIN / INTO clauses
  const fromJoinPattern = /\b(?:from|join|into|table|references)\s+([a-zA-Z_`"\[][\w.`"\]]*)/gi
  let match: RegExpExecArray | null
  while ((match = fromJoinPattern.exec(clean)) !== null) {
    const name = cleanIdentifier(match[1])
    if (name && !SQL_RESERVED.has(name) && name !== normalizedSelf && !cteNames.has(name) && !/^\d+$/.test(name)) {
      refs.add(name)
    }
  }

  // 2. Comma-separated tables in FROM clause: FROM a, b, c
  const fromClauseMatch = clean.match(/\bfrom\s+([^;]+?)(?:\bwhere\b|\bgroup\b|\border\b|\bhaving\b|\bjoin\b|\bleft\b|\bright\b|\bfull\b|\binner\b|\bcross\b|\bunion\b|\blimit\b|;|$)/i)
  if (fromClauseMatch) {
    const rawList = fromClauseMatch[1].split(',')
    for (const item of rawList) {
      const candidate = item.trim().split(/\s+/)[0]
      const name = cleanIdentifier(candidate)
      if (name && !SQL_RESERVED.has(name) && name !== normalizedSelf && !cteNames.has(name) && !/^\d+$/.test(name)) {
        refs.add(name)
      }
    }
  }

  // 3. dbt ref() macro
  const dbtRefPattern = /\{\{\s*ref\s*\(\s*['"]([^'"]+)['"]\s*\)\s*\}\}/g
  while ((match = dbtRefPattern.exec(clean)) !== null) {
    const name = cleanIdentifier(match[1])
    if (name && name !== normalizedSelf) refs.add(name)
  }

  // 4. dbt source() macro
  const dbtSourcePattern = /\{\{\s*source\s*\(\s*['"][^'"]+['"]\s*,\s*['"]([^'"]+)['"]\s*\)\s*\}\}/g
  while ((match = dbtSourcePattern.exec(clean)) !== null) {
    const name = cleanIdentifier(match[1])
    if (name && name !== normalizedSelf) refs.add(name)
  }

  return [...refs]
}

function extractTableColumns(stmt: string): ColumnLineage[] {
  const parenMatch = stmt.match(/\(([\s\S]+)\)/)
  if (!parenMatch) return []

  const colDefs = parenMatch[1].split(',')
  const columns: ColumnLineage[] = []

  for (const def of colDefs) {
    const trimmed = def.trim()
    if (/^(primary|foreign|constraint|unique|check|index)/i.test(trimmed)) continue
    const parts = trimmed.split(/\s+/)
    if (parts.length >= 2) {
      const colName = cleanIdentifier(parts[0])
      if (colName && !SQL_RESERVED.has(colName)) {
        columns.push({
          name: colName,
          type: parts[1].replace(/["`]/g, '').toUpperCase(),
          sources: [],
        })
      }
    }
  }
  return columns
}

function extractSelectColumns(stmt: string, sourceRefs: string[]): ColumnLineage[] {
  const clean = stripCommentsAndStrings(stmt)
  const selectMatch = clean.match(/select\s+([\s\S]+?)\s+from/i)
  if (!selectMatch) return []

  const rawCols = selectMatch[1].split(/,(?![^(]*\))/)
  const cols: ColumnLineage[] = []

  for (const rawCol of rawCols) {
    const trimmed = rawCol.trim()
    if (!trimmed || trimmed === '*') continue

    const asMatch = trimmed.match(/\s+as\s+([a-zA-Z_`"\[][\w.`"\]]*)$/i)
    let colName = ''
    let expr = trimmed

    if (asMatch) {
      colName = cleanIdentifier(asMatch[1])
      expr = trimmed.substring(0, asMatch.index).trim()
    } else {
      const parts = trimmed.split(/\s+/)
      colName = cleanIdentifier(parts[parts.length - 1])
    }

    if (!colName || SQL_RESERVED.has(colName) || /^\d+$/.test(colName)) continue

    const sources: { table: string; column: string }[] = []
    const dotMatches = expr.matchAll(/([a-zA-Z_]\w*)\.([a-zA-Z_]\w*)/g)
    for (const dm of dotMatches) {
      const tbl = cleanIdentifier(dm[1])
      const col = cleanIdentifier(dm[2])
      if (tbl && col && !SQL_RESERVED.has(col)) {
        sources.push({ table: tbl, column: col })
      }
    }

    if (sources.length === 0 && sourceRefs.length > 0) {
      const bareCol = expr.trim()
      const funcMatch = bareCol.match(/^(\w+)\s*\(/)
      if (funcMatch) {
        const innerCols = bareCol.matchAll(/\b(\w+)\b/g)
        for (const ic of innerCols) {
          const icName = cleanIdentifier(ic[1])
          if (icName && !SQL_RESERVED.has(icName) && icName !== funcMatch[1].toLowerCase() && !/^\d+$/.test(icName)) {
            sources.push({ table: sourceRefs[0], column: icName })
          }
        }
      } else {
        const simpleCol = cleanIdentifier(bareCol)
        if (simpleCol && !SQL_RESERVED.has(simpleCol) && !/^\d+$/.test(simpleCol)) {
          sources.push({ table: sourceRefs[0], column: simpleCol })
        }
      }
    }

    cols.push({ name: colName, sources })
  }

  return cols
}

function classifyNodeKind(
  name: string,
  filePath: string,
  explicitKind?: NodeKind,
): NodeKind {
  if (explicitKind) return explicitKind

  const lowerPath = filePath.toLowerCase()
  const lowerName = name.toLowerCase()

  if (
    lowerPath.includes('sources/') ||
    lowerPath.includes('sources\\') ||
    lowerPath.includes('seeds/') ||
    lowerName.startsWith('raw_') ||
    lowerName.startsWith('src_') ||
    lowerName.startsWith('source_') ||
    lowerName.startsWith('ext_') ||
    lowerName.startsWith('input_') ||
    lowerName.startsWith('landing_') ||
    lowerName.startsWith('seed_') ||
    lowerName.includes('postgres_') ||
    lowerName.includes('stripe_') ||
    lowerName.includes('kafka_') ||
    lowerName.includes('mongodb_') ||
    lowerName.includes('mysql_')
  ) {
    return 'source'
  }

  if (
    lowerPath.includes('views/') ||
    lowerPath.includes('views\\') ||
    lowerName.startsWith('v_') ||
    lowerName.startsWith('vw_') ||
    lowerName.startsWith('view_')
  ) {
    return 'view'
  }

  if (
    lowerPath.includes('models/') ||
    lowerPath.includes('models\\') ||
    lowerPath.includes('staging/') ||
    lowerPath.includes('staging\\') ||
    lowerPath.includes('marts/') ||
    lowerPath.includes('marts\\') ||
    lowerPath.includes('intermediate/') ||
    lowerName.startsWith('stg_') ||
    lowerName.startsWith('int_') ||
    lowerName.startsWith('fct_') ||
    lowerName.startsWith('dim_') ||
    lowerName.startsWith('agg_') ||
    lowerName.startsWith('rpt_') ||
    lowerName.startsWith('mart_') ||
    lowerName.startsWith('model_') ||
    lowerName.startsWith('fact_')
  ) {
    return 'model'
  }

  return 'table'
}

export function parseFiles(files: { name: string; path: string; content: string }[]) {
  const nodeMap = new Map<string, ParsedObject>()

  // 1. Parse YAML Schema / Source Files
  for (const file of files) {
    if (file.name.endsWith('.yml') || file.name.endsWith('.yaml')) {
      const content = file.content
      const sourceMatches = content.matchAll(/name:\s*([a-zA-Z_`"\[][\w.`"\]]*)/g)
      for (const sm of sourceMatches) {
        const objName = cleanIdentifier(sm[1])
        if (objName && !nodeMap.has(objName) && !SQL_RESERVED.has(objName)) {
          const kind: NodeKind = file.path.includes('sources') || objName.startsWith('raw_') || objName.startsWith('src_')
            ? 'source'
            : 'model'
          nodeMap.set(objName, {
            kind,
            filePath: file.path,
            refs: [],
            columns: [],
          })
        }
      }
    }
  }

  // 2. Parse SQL Files
  for (const file of files) {
    if (file.name.endsWith('.sql')) {
      const statements = splitStatements(file.content)
      const baseFileName = cleanIdentifier(file.name.replace(/\.[^.]+$/, ''))

      for (const stmt of statements) {
        const tableMatch = stmt.match(
          /create\s+(?:or\s+replace\s+)?(?:temporary\s+|temp\s+|unlogged\s+)?table\s+(?:if\s+not\s+exists\s+)?([a-zA-Z_`"\[][\w.`"\]]*)/i,
        )
        const viewMatch = stmt.match(
          /create\s+(?:or\s+replace\s+)?(?:materialized\s+)?view\s+(?:if\s+not\s+exists\s+)?([a-zA-Z_`"\[][\w.`"\]]*)/i,
        )
        const insertMatch = stmt.match(
          /insert\s+into\s+([a-zA-Z_`"\[][\w.`"\]]*)/i,
        )

        if (tableMatch) {
          const objectName = cleanIdentifier(tableMatch[1])
          if (!objectName) continue
          const columns = extractTableColumns(stmt)
          const refs = extractTableRefs(stmt, objectName)

          const isCTAS = /\bas\s+select\b/i.test(stmt)
          if (isCTAS && refs.length > 0) {
            const selectCols = extractSelectColumns(stmt, refs)
            if (selectCols.length > 0) columns.push(...selectCols)
          }

          const kind: NodeKind = isCTAS || file.path.includes('models') || file.path.includes('staging') || objectName.startsWith('stg_') || objectName.startsWith('fct_') || objectName.startsWith('dim_')
            ? classifyNodeKind(objectName, file.path, 'model')
            : classifyNodeKind(objectName, file.path, 'table')

          const existing = nodeMap.get(objectName)
          if (existing) {
            existing.refs.push(...refs)
            if (columns.length > 0) existing.columns = columns
            existing.kind = kind
          } else {
            nodeMap.set(objectName, { kind, filePath: file.path, refs, columns })
          }
        } else if (viewMatch) {
          const objectName = cleanIdentifier(viewMatch[1])
          if (!objectName) continue
          const refs = extractTableRefs(stmt, objectName)
          const columns = extractSelectColumns(stmt, refs)

          const existing = nodeMap.get(objectName)
          if (existing) {
            existing.refs.push(...refs)
            if (columns.length > 0) existing.columns = columns
            existing.kind = 'view'
          } else {
            nodeMap.set(objectName, { kind: 'view', filePath: file.path, refs, columns })
          }
        } else if (insertMatch) {
          const objectName = cleanIdentifier(insertMatch[1])
          if (!objectName) continue
          const refs = extractTableRefs(stmt, objectName)
          const columns = extractSelectColumns(stmt, refs)
          const kind = classifyNodeKind(objectName, file.path)

          const existing = nodeMap.get(objectName)
          if (existing) {
            existing.refs.push(...refs)
            if (columns.length > 0 && existing.columns.length === 0) existing.columns = columns
          } else {
            nodeMap.set(objectName, { kind, filePath: file.path, refs, columns })
          }
        } else if (/select\b/i.test(stmt)) {
          const refs = extractTableRefs(stmt, baseFileName)
          const columns = extractSelectColumns(stmt, refs)
          const kind = classifyNodeKind(baseFileName, file.path, 'model')

          const existing = nodeMap.get(baseFileName)
          if (existing) {
            existing.refs.push(...refs)
            if (columns.length > 0 && existing.columns.length === 0) existing.columns = columns
            existing.kind = kind
          } else {
            nodeMap.set(baseFileName, { kind, filePath: file.path, refs, columns })
          }
        }

        const stmtObjectName = tableMatch ? cleanIdentifier(tableMatch[1])
          : viewMatch ? cleanIdentifier(viewMatch[1])
          : insertMatch ? cleanIdentifier(insertMatch[1])
          : baseFileName

        if (stmtObjectName) {
          const dbtRefPattern = /\{\{\s*ref\s*\(\s*['"]([^'"]+)['"]\s*\)\s*\}\}/g
          let dbtMatch: RegExpExecArray | null
          while ((dbtMatch = dbtRefPattern.exec(stmt)) !== null) {
            const ref = cleanIdentifier(dbtMatch[1])
            if (ref && ref !== stmtObjectName) {
              const entry = nodeMap.get(stmtObjectName)
              if (entry && !entry.refs.includes(ref)) entry.refs.push(ref)
            }
          }

          const dbtSourcePattern = /\{\{\s*source\s*\(\s*['"][^'"]+['"]\s*,\s*['"]([^'"]+)['"]\s*\)\s*\}\}/g
          while ((dbtMatch = dbtSourcePattern.exec(stmt)) !== null) {
            const ref = cleanIdentifier(dbtMatch[1])
            if (ref && ref !== stmtObjectName) {
              if (!nodeMap.has(ref)) {
                nodeMap.set(ref, { kind: 'source', filePath: `sources/${ref}`, refs: [], columns: [] })
              }
              const entry = nodeMap.get(stmtObjectName)
              if (entry && !entry.refs.includes(ref)) entry.refs.push(ref)
            }
          }
        }
      }
    }
  }

  // 3. Inferred external upstream references
  for (const [name, data] of [...nodeMap.entries()]) {
    for (const ref of data.refs) {
      if (!nodeMap.has(ref)) {
        const inferredKind: NodeKind = ref.startsWith('v_') || ref.startsWith('vw_')
          ? 'view'
          : ref.startsWith('stg_') || ref.startsWith('int_') || ref.startsWith('fct_') || ref.startsWith('dim_')
          ? 'model'
          : 'source'

        nodeMap.set(ref, {
          kind: inferredKind,
          filePath: inferredKind === 'source' ? `sources/${ref}` : '',
          refs: [],
          columns: [],
        })
      }
    }
  }

  // 4. Build unique edges
  const edges: Edge[] = []
  for (const [targetName, data] of nodeMap) {
    for (const sourceRef of data.refs) {
      if (nodeMap.has(sourceRef) && sourceRef !== targetName) {
        if (!edges.some((e) => e.from === sourceRef && e.to === targetName)) {
          const columnMappings: { fromCol: string; toCol: string }[] = []
          for (const col of data.columns) {
            for (const src of col.sources) {
              if (src.table === sourceRef) {
                columnMappings.push({ fromCol: src.column, toCol: col.name })
              }
            }
          }
          edges.push({
            from: sourceRef,
            to: targetName,
            columns: columnMappings.length > 0 ? columnMappings : undefined,
          })
        }
      }
    }
  }

  // 5. Robust DAG Topological Layering with Cycle Prevention
  const depths = new Map<string, number>()
  const inDegree = new Map<string, number>()
  const adj = new Map<string, string[]>()

  for (const name of nodeMap.keys()) {
    inDegree.set(name, 0)
    adj.set(name, [])
  }

  for (const edge of edges) {
    if (adj.has(edge.from) && inDegree.has(edge.to)) {
      adj.get(edge.from)!.push(edge.to)
      inDegree.set(edge.to, (inDegree.get(edge.to) || 0) + 1)
    }
  }

  // Kahn's algorithm queue
  const queue: string[] = []
  for (const [name, deg] of inDegree.entries()) {
    if (deg === 0) {
      queue.push(name)
      depths.set(name, 0)
    }
  }

  let processedCount = 0
  while (queue.length > 0) {
    const curr = queue.shift()!
    processedCount++
    const currDepth = depths.get(curr) ?? 0

    for (const neighbor of adj.get(curr) || []) {
      const nextDepth = Math.max(depths.get(neighbor) ?? 0, currDepth + 1)
      depths.set(neighbor, nextDepth)

      const remaining = (inDegree.get(neighbor) || 1) - 1
      inDegree.set(neighbor, remaining)
      if (remaining === 0) {
        queue.push(neighbor)
      }
    }
  }

  // Handle any remaining cycle nodes
  for (const name of nodeMap.keys()) {
    if (!depths.has(name)) {
      depths.set(name, 0)
    }
  }

  // Group into columns
  const layoutCols = new Map<number, string[]>()
  for (const [name, depth] of depths) {
    if (!layoutCols.has(depth)) layoutCols.set(depth, [])
    layoutCols.get(depth)!.push(name)
  }

  // Barycentric sorting for clean horizontal alignment
  const sortedDepths = [...layoutCols.keys()].sort((a, b) => a - b)
  const nodeOrder = new Map<string, number>()

  for (const depth of sortedDepths) {
    const colNodes = layoutCols.get(depth)!
    if (depth > 0) {
      colNodes.sort((a, b) => {
        const parentsA = edges.filter((e) => e.to === a).map((e) => nodeOrder.get(e.from) ?? 0)
        const parentsB = edges.filter((e) => e.to === b).map((e) => nodeOrder.get(e.from) ?? 0)
        const avgA = parentsA.length > 0 ? parentsA.reduce((sum, v) => sum + v, 0) / parentsA.length : 0
        const avgB = parentsB.length > 0 ? parentsB.reduce((sum, v) => sum + v, 0) / parentsB.length : 0
        return avgA - avgB
      })
    }
    colNodes.forEach((name, idx) => nodeOrder.set(name, idx))
  }

  // Build final positioned nodes
  const nodes: LineageNode[] = []
  for (const [name, data] of nodeMap) {
    const depth = depths.get(name) ?? 0
    const col = layoutCols.get(depth) ?? [name]
    const idx = col.indexOf(name)

    const x = START_X + depth * (NODE_WIDTH + COL_GAP)
    const y = START_Y + idx * (NODE_HEIGHT + ROW_GAP)

    nodes.push({
      id: name,
      name,
      kind: data.kind,
      meta: `${data.kind.toUpperCase()} • ${data.filePath ? data.filePath.split('/').pop() : 'external'}`,
      x,
      y,
      filePath: data.filePath,
      columns: data.columns.length > 0 ? data.columns : undefined,
    })
  }

  return { nodes, edges }
}

/**
 * Pixel-Perfect Connector Curve Generator
 * Calculates individual cubic bezier paths linking exactly from right-center port
 * of the source card directly to the left-center port of the target card.
 */
export function buildConnectorPaths(
  nodesArr: LineageNode[],
  edgesArr: Edge[],
  selectedId: string | null,
): { edges: ConnectorEdge[]; normal: string; highlight: string } {
  const pos = new Map(nodesArr.map((n) => [n.id, { x: n.x, y: n.y }]))
  const connectors: ConnectorEdge[] = []
  const normalPaths: string[] = []
  const highlightPaths: string[] = []

  for (const edge of edgesArr) {
    const from = pos.get(edge.from)
    const to = pos.get(edge.to)
    if (!from || !to) continue

    // Start at right middle of source node card
    const x1 = from.x + NODE_WIDTH
    const y1 = from.y + NODE_HEIGHT / 2

    // End at left middle of target node card
    const x2 = to.x
    const y2 = to.y + NODE_HEIGHT / 2

    let d: string
    if (x2 >= x1) {
      // Standard left-to-right flow with smooth horizontal tangents
      const dx = Math.max(35, Math.min(140, (x2 - x1) * 0.48))
      d = `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`
    } else {
      // Backward or same-column curve
      const dy = y2 >= y1 ? 55 : -55
      d = `M ${x1} ${y1} C ${x1 + 60} ${y1 + dy}, ${x2 - 60} ${y2 + dy}, ${x2} ${y2}`
    }

    const isUpstream = selectedId === edge.to
    const isDownstream = selectedId === edge.from
    const isHighlighted = isUpstream || isDownstream

    if (isHighlighted) {
      highlightPaths.push(d)
    } else {
      normalPaths.push(d)
    }

    connectors.push({
      id: `${edge.from}-->${edge.to}`,
      from: edge.from,
      to: edge.to,
      d,
      x1,
      y1,
      x2,
      y2,
      isHighlighted,
      isUpstream,
      isDownstream,
      columns: edge.columns,
    })
  }

  return {
    edges: connectors,
    normal: normalPaths.join(' '),
    highlight: highlightPaths.join(' '),
  }
}

export function groupByDir(nodesArr: LineageNode[]): TreeGroup[] {
  const map = new Map<string, LineageNode[]>()
  for (const node of nodesArr) {
    let dir = '(root)'
    if (node.filePath) {
      const parts = node.filePath.split('/')
      dir = parts.length > 1 ? parts.slice(0, -1).join('/') : parts[0].includes('.') ? '(root)' : parts[0]
    } else if (node.kind === 'source') {
      dir = 'sources (external)'
    } else if (node.kind === 'model') {
      dir = 'models'
    }

    if (!map.has(dir)) map.set(dir, [])
    map.get(dir)!.push(node)
  }
  return [...map.entries()]
    .map(([dir, items]) => ({ dir, items }))
    .sort((a, b) => a.dir.localeCompare(b.dir))
}

export function getDemoPipeline(): { nodes: LineageNode[]; edges: Edge[]; projectName: string } {
  const col0_x = START_X
  const col1_x = START_X + (NODE_WIDTH + COL_GAP)
  const col2_x = START_X + 2 * (NODE_WIDTH + COL_GAP)
  const col3_x = START_X + 3 * (NODE_WIDTH + COL_GAP)

  const nodes: LineageNode[] = [
    {
      id: 'raw_stripe_charges',
      name: 'raw_stripe_charges',
      kind: 'source',
      meta: 'SOURCE • sources/stripe.yml',
      filePath: 'sources/stripe.yml',
      x: col0_x,
      y: START_Y,
      columns: [
        { name: 'id', type: 'VARCHAR', sources: [] },
        { name: 'amount', type: 'DECIMAL', sources: [] },
        { name: 'currency', type: 'VARCHAR', sources: [] },
        { name: 'customer_id', type: 'VARCHAR', sources: [] },
        { name: 'created_at', type: 'TIMESTAMP', sources: [] },
      ],
    },
    {
      id: 'raw_postgres_users',
      name: 'raw_postgres_users',
      kind: 'source',
      meta: 'SOURCE • sources/postgres.yml',
      filePath: 'sources/postgres.yml',
      x: col0_x,
      y: START_Y + (NODE_HEIGHT + ROW_GAP),
      columns: [
        { name: 'user_id', type: 'VARCHAR', sources: [] },
        { name: 'email', type: 'VARCHAR', sources: [] },
        { name: 'signup_date', type: 'DATE', sources: [] },
        { name: 'region', type: 'VARCHAR', sources: [] },
      ],
    },
    {
      id: 'raw_clickstream_events',
      name: 'raw_clickstream_events',
      kind: 'source',
      meta: 'SOURCE • sources/kafka.yml',
      filePath: 'sources/kafka.yml',
      x: col0_x,
      y: START_Y + 2 * (NODE_HEIGHT + ROW_GAP),
      columns: [
        { name: 'event_id', type: 'VARCHAR', sources: [] },
        { name: 'user_id', type: 'VARCHAR', sources: [] },
        { name: 'event_type', type: 'VARCHAR', sources: [] },
        { name: 'timestamp', type: 'TIMESTAMP', sources: [] },
      ],
    },
    {
      id: 'stg_payments',
      name: 'stg_payments',
      kind: 'model',
      meta: 'MODEL • staging/stg_payments.sql',
      filePath: 'models/staging/stg_payments.sql',
      x: col1_x,
      y: START_Y,
      columns: [
        { name: 'payment_id', type: 'VARCHAR', sources: [{ table: 'raw_stripe_charges', column: 'id' }] },
        { name: 'amount_usd', type: 'DECIMAL', sources: [{ table: 'raw_stripe_charges', column: 'amount' }] },
        { name: 'customer_id', type: 'VARCHAR', sources: [{ table: 'raw_stripe_charges', column: 'customer_id' }] },
      ],
    },
    {
      id: 'stg_customers',
      name: 'stg_customers',
      kind: 'model',
      meta: 'MODEL • staging/stg_customers.sql',
      filePath: 'models/staging/stg_customers.sql',
      x: col1_x,
      y: START_Y + (NODE_HEIGHT + ROW_GAP),
      columns: [
        { name: 'customer_id', type: 'VARCHAR', sources: [{ table: 'raw_postgres_users', column: 'user_id' }] },
        { name: 'email_domain', type: 'VARCHAR', sources: [{ table: 'raw_postgres_users', column: 'email' }] },
        { name: 'region', type: 'VARCHAR', sources: [{ table: 'raw_postgres_users', column: 'region' }] },
      ],
    },
    {
      id: 'fct_orders_mart',
      name: 'fct_orders_mart',
      kind: 'table',
      meta: 'TABLE • marts/fct_orders.sql',
      filePath: 'models/marts/fct_orders.sql',
      x: col2_x,
      y: START_Y,
      columns: [
        { name: 'order_key', type: 'VARCHAR', sources: [{ table: 'stg_payments', column: 'payment_id' }] },
        { name: 'customer_id', type: 'VARCHAR', sources: [{ table: 'stg_customers', column: 'customer_id' }] },
        { name: 'gross_revenue', type: 'DECIMAL', sources: [{ table: 'stg_payments', column: 'amount_usd' }] },
      ],
    },
    {
      id: 'dim_customer_ltv',
      name: 'dim_customer_ltv',
      kind: 'table',
      meta: 'TABLE • marts/dim_customer_ltv.sql',
      filePath: 'models/marts/dim_customer_ltv.sql',
      x: col2_x,
      y: START_Y + (NODE_HEIGHT + ROW_GAP),
      columns: [
        { name: 'customer_id', type: 'VARCHAR', sources: [{ table: 'stg_customers', column: 'customer_id' }] },
        { name: 'total_spend', type: 'DECIMAL', sources: [{ table: 'fct_orders_mart', column: 'gross_revenue' }] },
        { name: 'segment', type: 'VARCHAR', sources: [] },
      ],
    },
    {
      id: 'exec_revenue_dashboard',
      name: 'exec_revenue_dashboard',
      kind: 'view',
      meta: 'VIEW • views/exec_revenue.sql',
      filePath: 'views/exec_revenue.sql',
      x: col3_x,
      y: START_Y,
      columns: [
        { name: 'mrr_usd', type: 'DECIMAL', sources: [{ table: 'fct_orders_mart', column: 'gross_revenue' }] },
        { name: 'active_paying_customers', type: 'INTEGER', sources: [{ table: 'dim_customer_ltv', column: 'customer_id' }] },
      ],
    },
    {
      id: 'churn_risk_analyzer',
      name: 'churn_risk_analyzer',
      kind: 'view',
      meta: 'VIEW • views/churn_risk.sql',
      filePath: 'views/churn_risk.sql',
      x: col3_x,
      y: START_Y + (NODE_HEIGHT + ROW_GAP),
      columns: [
        { name: 'customer_id', type: 'VARCHAR', sources: [{ table: 'dim_customer_ltv', column: 'customer_id' }] },
        { name: 'churn_probability', type: 'FLOAT', sources: [] },
      ],
    },
  ]

  const edges: Edge[] = [
    { from: 'raw_stripe_charges', to: 'stg_payments' },
    { from: 'raw_postgres_users', to: 'stg_customers' },
    { from: 'stg_payments', to: 'fct_orders_mart' },
    { from: 'stg_customers', to: 'fct_orders_mart' },
    { from: 'stg_customers', to: 'dim_customer_ltv' },
    { from: 'fct_orders_mart', to: 'dim_customer_ltv' },
    { from: 'fct_orders_mart', to: 'exec_revenue_dashboard' },
    { from: 'dim_customer_ltv', to: 'exec_revenue_dashboard' },
    { from: 'dim_customer_ltv', to: 'churn_risk_analyzer' },
  ]

  return { nodes, edges, projectName: 'production-dbt-analytics' }
}

export function generateSvgExport(nodes: LineageNode[], edges: Edge[], title = 'LineageForge Graph'): string {
  let maxX = 1200
  let maxY = 800
  for (const n of nodes) {
    if (n.x + NODE_WIDTH + 80 > maxX) maxX = n.x + NODE_WIDTH + 80
    if (n.y + NODE_HEIGHT + 80 > maxY) maxY = n.y + NODE_HEIGHT + 80
  }

  const pos = new Map(nodes.map((n) => [n.id, { x: n.x, y: n.y }]))

  const paths = edges.map((e) => {
    const from = pos.get(e.from)
    const to = pos.get(e.to)
    if (!from || !to) return ''
    const x1 = from.x + NODE_WIDTH
    const y1 = from.y + NODE_HEIGHT / 2
    const x2 = to.x
    const y2 = to.y + NODE_HEIGHT / 2
    const dx = Math.max(35, Math.min(140, (x2 - x1) * 0.48))
    return `<path d="M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}" stroke="#00f2fe" stroke-width="2.2" fill="none" opacity="0.85" marker-end="url(#arrow)" />`
  }).filter(Boolean).join('\n')

  const nodeElements = nodes.map((n) => {
    const color = n.kind === 'table' ? '#4facfe' : n.kind === 'view' ? '#43e97b' : n.kind === 'source' ? '#fa709a' : '#00f2fe'
    return `
      <g transform="translate(${n.x}, ${n.y})">
        <rect width="${NODE_WIDTH}" height="${NODE_HEIGHT}" rx="12" fill="#121428" stroke="${color}" stroke-width="1.5" filter="url(#glow)" />
        <circle cx="22" cy="30" r="10" fill="${color}" opacity="0.25" />
        <circle cx="22" cy="30" r="5" fill="${color}" />
        <text x="42" y="26" fill="#ffffff" font-family="JetBrains Mono, monospace" font-size="12" font-weight="bold">${n.name}</text>
        <text x="42" y="42" fill="#a0a0b8" font-family="JetBrains Mono, monospace" font-size="9" font-weight="bold" letter-spacing="1px">${n.kind.toUpperCase()}</text>
      </g>
    `
  }).join('\n')

  return `<?xml version="1.0" standalone="no"?>
<svg width="${maxX}" height="${maxY}" viewBox="0 0 ${maxX} ${maxY}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <radialGradient id="bg-glow" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="#1a1a2e" />
      <stop offset="100%" stop-color="#0a0a0f" />
    </radialGradient>
    <filter id="glow" x="-20%" y="-20%" width="140%" height="140%">
      <feGaussianBlur stdDeviation="4" result="blur" />
      <feComposite in="SourceGraphic" in2="blur" operator="over" />
    </filter>
    <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto">
      <path d="M 0 1.5 L 9 5 L 0 8.5 z" fill="#00f2fe" />
    </marker>
  </defs>
  <rect width="100%" height="100%" fill="url(#bg-glow)" />
  <text x="50" y="45" fill="#4facfe" font-family="Inter, sans-serif" font-size="18" font-weight="bold">${title}</text>
  <g>${paths}</g>
  <g>${nodeElements}</g>
</svg>`
}
