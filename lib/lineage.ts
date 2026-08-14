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
  'lateral','unnest','generate_series','information_schema',
])

function stripCommentsAndStrings(sql: string): string {
  return sql
    .replace(/--[^\n]*/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/'[^']*'/g, "''")
}

function extractCteNames(sql: string): Set<string> {
  const clean = stripCommentsAndStrings(sql)
  const ctes = new Set<string>()
  const withMatch = clean.match(/\bwith\s+([a-zA-Z_]\w*)\s+as\s*\(/i)
  if (withMatch) {
    ctes.add(withMatch[1].toLowerCase())
    // Multiple CTEs separated by commas: , cte_name as (
    const extraCtes = clean.matchAll(/,\s*([a-zA-Z_]\w*)\s+as\s*\(/gi)
    for (const match of extraCtes) {
      ctes.add(match[1].toLowerCase())
    }
  }
  return ctes
}

function splitStatements(sql: string): string[] {
  const stmts: string[] = []
  let depth = 0
  let start = 0
  for (let i = 0; i < sql.length; i++) {
    if (sql[i] === '(') depth++
    else if (sql[i] === ')') depth--
    else if (sql[i] === ';' && depth === 0) {
      stmts.push(sql.substring(start, i).trim())
      start = i + 1
    }
  }
  const rem = sql.substring(start).trim()
  if (rem) stmts.push(rem)
  return stmts
}

function extractTableRefs(sql: string, selfName: string): string[] {
  const clean = stripCommentsAndStrings(sql)
  const refs = new Set<string>()
  const cteNames = extractCteNames(sql)

  const fromJoinPattern = /\b(?:from|join|into|table)\s+([a-zA-Z_][\w.]*)/gi
  let match
  while ((match = fromJoinPattern.exec(clean)) !== null) {
    const raw = match[1].toLowerCase()
    const name = raw.split('.').pop()!
    if (!SQL_RESERVED.has(name) && name !== selfName && !cteNames.has(name) && !/^\d+$/.test(name)) {
      refs.add(name)
    }
  }

  const dbtRefPattern = /\{\{\s*ref\s*\(\s*['"]([^'"]+)['"]\s*\)\s*\}\}/g
  while ((match = dbtRefPattern.exec(clean)) !== null) {
    const name = match[1].toLowerCase()
    if (name !== selfName) refs.add(name)
  }

  const dbtSourcePattern = /\{\{\s*source\s*\(\s*['"][^'"]+['"]\s*,\s*['"]([^'"]+)['"]\s*\)\s*\}\}/g
  while ((match = dbtSourcePattern.exec(clean)) !== null) {
    refs.add(match[1].toLowerCase())
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
    if (parts.length >= 2 && !SQL_RESERVED.has(parts[0].toLowerCase())) {
      columns.push({
        name: parts[0].replace(/["`]/g, '').toLowerCase(),
        type: parts[1].replace(/["`]/g, '').toUpperCase(),
        sources: [],
      })
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

    const asMatch = trimmed.match(/\s+as\s+([\w"`]+)$/i)
    let colName = ''
    let expr = trimmed

    if (asMatch) {
      colName = asMatch[1].replace(/["`]/g, '').toLowerCase()
      expr = trimmed.substring(0, asMatch.index).trim()
    } else {
      const parts = trimmed.split(/\s+/)
      colName = parts[parts.length - 1].replace(/["`]/g, '').toLowerCase()
    }

    if (SQL_RESERVED.has(colName) || /^\d+$/.test(colName)) continue

    const sources: { table: string; column: string }[] = []
    const dotMatches = expr.matchAll(/([a-zA-Z_]\w*)\.([a-zA-Z_]\w*)/g)
    for (const dm of dotMatches) {
      const tbl = dm[1].toLowerCase()
      const col = dm[2].toLowerCase()
      if (!SQL_RESERVED.has(col)) {
        sources.push({ table: tbl, column: col })
      }
    }

    if (sources.length === 0 && sourceRefs.length > 0) {
      const bareCol = expr.trim()
      const funcMatch = bareCol.match(/^(\w+)\s*\(/)
      if (funcMatch) {
        const innerCols = bareCol.matchAll(/\b(\w+)\b/g)
        for (const ic of innerCols) {
          const icName = ic[1].toLowerCase()
          if (!SQL_RESERVED.has(icName) && icName !== funcMatch[1].toLowerCase() && !/^\d+$/.test(icName)) {
            sources.push({ table: sourceRefs[0], column: icName })
          }
        }
      } else {
        const simpleCol = bareCol.replace(/["`]/g, '').toLowerCase()
        if (!SQL_RESERVED.has(simpleCol) && !/^\d+$/.test(simpleCol)) {
          sources.push({ table: sourceRefs[0], column: simpleCol })
        }
      }
    }

    cols.push({ name: colName, sources })
  }

  return cols
}

/**
 * Smart classification of node kind:
 * - 'source': Raw input tables, ingested seeds, external databases, or tables referenced in FROM/JOIN that are not defined inside workspace
 * - 'model': Data transformation models, dbt models, staging/marts/intermediate queries, SELECT pipelines
 * - 'view': Virtual views (CREATE VIEW / MATERIALIZED VIEW)
 * - 'table': Physical storage tables / DDL created tables
 */
function classifyNodeKind(
  name: string,
  filePath: string,
  explicitKind?: NodeKind,
): NodeKind {
  if (explicitKind) return explicitKind

  const lowerPath = filePath.toLowerCase()
  const lowerName = name.toLowerCase()

  // 1. Source checks
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

  // 2. View checks
  if (
    lowerPath.includes('views/') ||
    lowerPath.includes('views\\') ||
    lowerName.startsWith('v_') ||
    lowerName.startsWith('vw_') ||
    lowerName.startsWith('view_')
  ) {
    return 'view'
  }

  // 3. Model checks
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

  // Default to model for transformation SQL files
  return 'model'
}

export function parseFiles(files: { name: string; path: string; content: string }[]) {
  const nodeMap = new Map<string, ParsedObject>()

  // 1. Parse YAML Schema / Source Files
  for (const file of files) {
    if (file.name.endsWith('.yml') || file.name.endsWith('.yaml')) {
      const content = file.content
      // Simple regex parser for dbt-style sources
      const sourceMatches = content.matchAll(/name:\s*([a-zA-Z_]\w*)/g)
      for (const sm of sourceMatches) {
        const objName = sm[1].toLowerCase()
        if (objName && !nodeMap.has(objName)) {
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
      const baseFileName = file.name.replace(/\.[^.]+$/, '').toLowerCase()

      for (const stmt of statements) {
        const tableMatch = stmt.match(
          /create\s+(?:or\s+replace\s+)?table\s+(?:if\s+not\s+exists\s+)?(?:[\w"`.]+\.)?([\w"`.]+)/i,
        )
        const viewMatch = stmt.match(
          /create\s+(?:or\s+replace\s+)?(?:materialized\s+)?view\s+(?:if\s+not\s+exists\s+)?(?:[\w"`.]+\.)?([\w"`.]+)/i,
        )
        const insertMatch = stmt.match(
          /insert\s+into\s+(?:[\w"`.]+\.)?([\w"`.]+)/i,
        )

        if (tableMatch) {
          const objectName = tableMatch[1].replace(/["`]/g, '').toLowerCase()
          const columns = extractTableColumns(stmt)
          const refs = extractTableRefs(stmt, objectName)

          const isCTAS = /\bas\s+select\b/i.test(stmt)
          if (isCTAS && refs.length > 0) {
            const selectCols = extractSelectColumns(stmt, refs)
            if (selectCols.length > 0) columns.push(...selectCols)
          }

          // If it's a CTAS or inside models/staging/marts directory, classify as 'model', else 'table'
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
          const objectName = viewMatch[1].replace(/["`]/g, '').toLowerCase()
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
          const objectName = insertMatch[1].replace(/["`]/g, '').toLowerCase()
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
          // Standard transformation SQL / dbt model file
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

        // dbt jinja ref & source parsing
        const stmtObjectName = tableMatch?.[1]?.replace(/["`]/g, '').toLowerCase()
          ?? viewMatch?.[1]?.replace(/["`]/g, '').toLowerCase()
          ?? baseFileName

        const dbtRefPattern = /\{\{\s*ref\s*\(\s*['"]([^'"]+)['"]\s*\)\s*\}\}/g
        let dbtMatch
        while ((dbtMatch = dbtRefPattern.exec(stmt)) !== null) {
          const ref = dbtMatch[1].toLowerCase()
          if (ref !== stmtObjectName) {
            const entry = nodeMap.get(stmtObjectName)
            if (entry) entry.refs.push(ref)
          }
        }

        const dbtSourcePattern = /\{\{\s*source\s*\(\s*['"][^'"]+['"]\s*,\s*['"]([^'"]+)['"]\s*\)\s*\}\}/g
        while ((dbtMatch = dbtSourcePattern.exec(stmt)) !== null) {
          const ref = dbtMatch[1].toLowerCase()
          if (!nodeMap.has(ref)) {
            nodeMap.set(ref, { kind: 'source', filePath: `sources/${ref}`, refs: [], columns: [] })
          }
          const entry = nodeMap.get(stmtObjectName)
          if (entry) entry.refs.push(ref)
        }
      }
    }
  }

  // 3. Process Inferred Upstream Tables (Tables referenced in FROM/JOIN that are external/source inputs)
  for (const [name, data] of [...nodeMap.entries()]) {
    for (const ref of data.refs) {
      if (!nodeMap.has(ref)) {
        // Any referenced table that was not explicitly defined inside the workspace is an external SOURCE or model
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

  // 4. Build Edge List
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

  // 5. Compute Depth & Topological Layout
  const depths = new Map<string, number>()
  const visited = new Set<string>()

  function computeDepth(name: string): number {
    if (depths.has(name)) return depths.get(name)!
    if (visited.has(name)) return 0
    visited.add(name)
    const incoming = edges.filter((e) => e.to === name)
    const depth = incoming.length === 0 ? 0 : Math.max(...incoming.map((e) => computeDepth(e.from) + 1))
    depths.set(name, depth)
    return depth
  }

  for (const name of nodeMap.keys()) computeDepth(name)

  const maxDepth = Math.max(0, ...depths.values())
  const layoutCols = new Map<number, string[]>()
  for (const [name, depth] of depths) {
    if (!layoutCols.has(depth)) layoutCols.set(depth, [])
    layoutCols.get(depth)!.push(name)
  }

  const nodes: LineageNode[] = []
  for (const [name, data] of nodeMap) {
    const depth = depths.get(name) ?? 0
    const col = layoutCols.get(depth) ?? [name]
    const idx = col.indexOf(name)
    const colCount = col.length
    const x = maxDepth === 0 ? 50 : 8 + (depth / maxDepth) * 82
    const y = colCount === 1 ? 48 : 12 + (idx / (colCount - 1)) * 74

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

export function buildConnectorPaths(nodesArr: LineageNode[], edgesArr: Edge[], selectedId: string | null) {
  const pos = new Map(nodesArr.map((n) => [n.id, { x: n.x, y: n.y }]))
  const normal: string[] = []
  const highlight: string[] = []

  for (const edge of edgesArr) {
    const from = pos.get(edge.from)
    const to = pos.get(edge.to)
    if (!from || !to) continue
    const x1 = from.x * 12 + 80
    const y1 = from.y * 7 + 25
    const x2 = to.x * 12 + 10
    const y2 = to.y * 7 + 25
    const dx = Math.max(30, (x2 - x1) * 0.5)
    const d = `M${x1},${y1} C${x1 + dx},${y1} ${x2 - dx},${y2} ${x2},${y2}`
    if (selectedId && (edge.from === selectedId || edge.to === selectedId)) {
      highlight.push(d)
    } else {
      normal.push(d)
    }
  }

  return { normal: normal.join(' '), highlight: highlight.join(' ') }
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
  const nodes: LineageNode[] = [
    {
      id: 'raw_stripe_charges',
      name: 'raw_stripe_charges',
      kind: 'source',
      meta: 'SOURCE • sources/stripe.yml',
      filePath: 'sources/stripe.yml',
      x: 6,
      y: 18,
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
      x: 6,
      y: 48,
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
      x: 6,
      y: 78,
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
      x: 32,
      y: 22,
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
      x: 32,
      y: 52,
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
      x: 60,
      y: 26,
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
      x: 60,
      y: 64,
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
      x: 88,
      y: 24,
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
      x: 88,
      y: 68,
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
  const width = 1400
  const height = 900
  const pos = new Map(nodes.map((n) => [n.id, { x: (n.x / 100) * (width - 300) + 50, y: (n.y / 100) * (height - 160) + 80 }]))

  const paths = edges.map((e) => {
    const from = pos.get(e.from)
    const to = pos.get(e.to)
    if (!from || !to) return ''
    const x1 = from.x + 160, y1 = from.y + 28
    const x2 = to.x, y2 = to.y + 28
    const dx = (x2 - x1) * 0.5
    return `<path d="M${x1},${y1} C${x1 + dx},${y1} ${x2 - dx},${y2} ${x2},${y2}" stroke="#a855f7" stroke-width="2" fill="none" opacity="0.75" marker-end="url(#arrow)" />`
  }).filter(Boolean).join('\n')

  const nodeElements = nodes.map((n) => {
    const p = pos.get(n.id)
    if (!p) return ''
    const color = n.kind === 'table' ? '#4facfe' : n.kind === 'view' ? '#43e97b' : n.kind === 'source' ? '#fa709a' : '#00f2fe'
    return `
      <g transform="translate(${p.x}, ${p.y})">
        <rect width="160" height="56" rx="8" fill="#121222" stroke="${color}" stroke-width="1.5" filter="url(#glow)" />
        <circle cx="20" cy="28" r="8" fill="${color}" opacity="0.3" />
        <circle cx="20" cy="28" r="4" fill="${color}" />
        <text x="36" y="24" fill="#ffffff" font-family="Inter, sans-serif" font-size="11" font-weight="600">${n.name}</text>
        <text x="36" y="38" fill="#a0a0b8" font-family="JetBrains Mono, monospace" font-size="9">${n.kind.toUpperCase()}</text>
      </g>
    `
  }).join('\n')

  return `<?xml version="1.0" standalone="no"?>
<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <radialGradient id="bg-glow" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="#1a1a2e" />
      <stop offset="100%" stop-color="#0a0a0f" />
    </radialGradient>
    <filter id="glow" x="-20%" y="-20%" width="140%" height="140%">
      <feGaussianBlur stdDeviation="4" result="blur" />
      <feComposite in="SourceGraphic" in2="blur" operator="over" />
    </filter>
    <marker id="arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
      <path d="M 0 1 L 10 5 L 0 9 z" fill="#a855f7" />
    </marker>
  </defs>
  <rect width="100%" height="100%" fill="url(#bg-glow)" />
  <text x="50" y="45" fill="#4facfe" font-family="Inter, sans-serif" font-size="18" font-weight="bold">${title}</text>
  <g>${paths}</g>
  <g>${nodeElements}</g>
</svg>`
}
