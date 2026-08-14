# ⚡ LineageForge

> **Interactive Data Pipeline Lineage, Topology & Blast Radius Diagnostic Engine**

LineageForge is a modern, high-performance web application designed to parse, visualize, and analyze complex SQL and data pipeline architectures in real time. It delivers an intuitive, interactive canvas for tracing table and column-level dependencies, evaluating impact blast radius, detecting orphan objects, and exploring workspace files—all running **100% locally in your browser**.

---

## ✨ Features

### 🔍 1. Intelligent SQL & Pipeline Parser
- **Smart Node Classification**:
  - 🟦 **Tables**: Physical DDL tables and data warehouse storage objects.
  - 🟩 **Views**: Virtual views and materialized views (`CREATE VIEW`, `v_` prefixes).
  - 🔷 **Models**: Data transformation models, dbt models, CTEs, and staging/mart pipelines (`stg_`, `fct_`, `dim_`, `int_`, `marts/`).
  - 🟪 **Sources**: Upstream external tables, raw databases, ingested seed files, and `{{ source() }}` declarations.
- **Dialect & Pattern Support**:
  - `CREATE TABLE [AS SELECT]`, `CREATE VIEW`, `INSERT INTO`
  - CTE extraction (`WITH ... AS (...)`) to prevent false-positive external node generation
  - dbt Jinja macros (`{{ ref('...') }}`, `{{ source('...', '...') }}`)
  - YAML schema and source definitions (`.yml`, `.yaml`)

### 🗺️ 2. Interactive Lineage Canvas
- **Fluid Canvas Navigation**: Full click-and-drag panning via Pointer Capture, mouse-wheel / trackpad panning, and `Ctrl` / `⌘` + wheel zooming.
- **Dynamic Flow Indicators**: Visual glowing animated particle streams along dependency edges.
- **Topological Layout Engine**: Automatic multi-tier depth calculations and layered node positioning.
- **Responsive Fit & Zoom**: Instant 1-click **Fit Graph** to center and frame large pipeline architectures.

### 💥 3. Property Diagnostics & Blast Radius Impact
- **Blast Radius Analysis**: Automatically calculates downstream impact scores when a model or table is modified.
- **Upstream & Downstream Tracing**: Inspect immediate parents and downstream dependents with 1-click inspection navigation.
- **Column-Level Lineage**: Trace individual column mappings from upstream sources to final analytical models.

### 🛡️ 4. Orphan & Pipeline Health Audit
- **Orphan Report**: Identifies unreferenced / disconnected tables, root sources, and terminal leaf sinks.
- **High-Impact Identification**: Pinpoints bottleneck models with the highest downstream blast radius.

### 📂 5. Scanned Workspace File Explorer
- **Show Files Modal**: Inspect all scanned `.sql`, `.yml`, and code files.
- **Built-in Code Previewer**: Real-time syntax and content viewer with character counts and a 1-click **Copy Code** button.

### 📐 6. Publication-Grade SVG Export
- Export complete pipeline diagrams to standalone vector `.svg` files with preserved color coding, gradients, and arrowheads.

### 🔒 7. Privacy First
- **Zero Cloud Uploads**: All directory reading and parsing happens entirely client-side using the HTML5 File API and File System Access API. Your SQL code and data schemas never leave your machine.

---

## 🚀 Quick Start

### Prerequisites
- [Node.js](https://nodejs.org/) (version 18.18 or higher recommended)
- [npm](https://www.npmjs.com/) or [pnpm](https://pnpm.io/)

### Installation

1. Clone or navigate to the project directory:
   ```bash
   cd lineage-forge
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Run the development server:
   ```bash
   npm run dev
   ```

4. Open your browser and navigate to:
   ```text
   http://localhost:3000
   ```

---

## 🛠️ Build for Production

To create an optimized production build:

```bash
npm run build
npm start
```

---

## 📁 Project Structure

```text
lineage-forge/
├── app/
│   ├── globals.css        # Core styles, design tokens, glowing animations
│   ├── layout.tsx         # Root application layout & metadata
│   └── page.tsx           # Main LineageForge workspace, canvas & inspection UI
├── lib/
│   └── lineage.ts         # SQL/YAML parser, DAG builder, layout & export engine
├── public/                # Static assets & icons
├── next.config.mjs        # Next.js configuration
├── package.json           # Dependencies and build scripts
├── tsconfig.json          # TypeScript configuration
└── README.md              # Project documentation
```

---

## ⌨️ Controls & Shortcuts

| Action | Shortcut / Gesture |
| :--- | :--- |
| **Pan Canvas** | Click & drag anywhere on the canvas background / Scroll mouse wheel |
| **Zoom In / Out** | `+` / `−` buttons, or `Ctrl` / `⌘` + Mouse Wheel |
| **Reset View** | Click **Fit Graph** or the maximize button in the HUD |
| **Inspect Node** | Click any node card on the canvas or in the Object Explorer |
| **Filter Objects** | Click `All`, `Table`, `View`, `Model`, or `Source` pills in the sidebar |
| **Show Files** | Click the **Show Files** pill in the top header |
| **Clear Workspace** | Click **Reset Workspace Data** in Settings or Clear Selection |

---

## 📄 License

MIT License. Free for personal and commercial use.
