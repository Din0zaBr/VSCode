# URSUS Insight — Design System

> **URSUS Insight SIEM** — система управления информационной безопасностью (SIEM) с ML-модулем.  
> Русскоязычный продукт для мониторинга событий безопасности, анализа инцидентов и корреляции угроз в реальном времени.

---

## Sources

- **Codebase**: GitHub `Din0zaBr/VSCode` @ `main` branch  
  - `web/static/css/style.css` — master stylesheet (Cyber Forest theme)  
  - `web/templates/` — Jinja2 HTML templates (base, dashboard, events, alerts, rules, agents, login)  
  - `config.py` — severity levels, colors, categories  
  - `Main.py` — application entry, palette annotation: `Primary #6A0DAD | Accent #BF40BF | BG #2F4F4F`

---

## Product Overview

URSUS Insight is a Python/Flask-based SIEM platform with the following core screens:

| Screen | Route | Purpose |
|---|---|---|
| Login | `/login` | Authentication gate with animated bear logo |
| Dashboard | `/` | KPI stat cards + Chart.js panels (timeline, severity, sources, categories) |
| Events | `/events` | Paginated log stream with search/filter by severity, category, IP |
| Alerts / Incidents | `/alerts` | Incident lifecycle management (OPEN → IN_PROGRESS → RESOLVED / FALSE_POSITIVE) |
| Rules | `/rules` | Correlation rule editor (threshold, pattern, keyword, port_scan) |
| Agents | `/agents` | Agent registration + setup guide (syslog, REST API, file tail) |

**Event categories:** Authentication, Network, Malware, Policy, System, Application, Intrusion, Privilege, Other  
**Severity levels:** CRITICAL · HIGH · MEDIUM · LOW · INFO

---

## Content Fundamentals

### Language & Tone
- **Russian-language UI** — all labels, nav items, breadcrumbs, and user-facing copy are in Russian.
- **Technical terminology** stays in English: severity names (CRITICAL, HIGH), status strings (OPEN, IN_PROGRESS, RESOLVED, FALSE_POSITIVE), and all JSON/API identifiers.
- **Tone**: professional, terse, cyber-military. No friendly marketing language. Short imperative labels.
- **Casing**: Section titles and table headers use `UPPERCASE` with letter-spacing. Sentence case for descriptions and help text.
- **No emoji in data/UI** — emoji only appears in the branded bear logo (`🐻`) and sidebar nav icons (⬡ ◈ ⚡ ⟁ ◉).
- **Unicode glyphs as icons**: The product relies on Unicode characters (⬡ ◈ ⚡ ⟁ ◉) rather than an icon font or SVGs. No external icon library.
- **Numbers**: Localized with `ru-RU` locale (`.toLocaleString()`). Timestamps in `DD.MM.YYYY HH:MM:SS` format.
- **Placeholders**: `—` (em dash) for empty/null values.
- **Version tag**: `v1.0.0 // PROTOTYPE` — monospace, subtle, footer placement.
- **Theme name**: "CYBER FOREST" — used in comments and the splash banner.

### Example copy patterns
```
ВСЕГО СОБЫТИЙ        за всё время
ОТКРЫТЫЕ ИНЦИДЕНТЫ   требуют внимания
АГЕНТЫ ONLINE        активных агентов
◈ ЖУРНАЛ СОБЫТИЙ
⚡ ПОСЛЕДНИЕ ИНЦИДЕНТЫ
⟁ ПРАВИЛО КОРРЕЛЯЦИИ
Система активна
```

---

## Visual Foundations

### Color System
The palette is called **"Cyber Forest"** and combines deep space navy backgrounds with purple/magenta primary + cyber-green accents and high-contrast severity colors.

| Token | Hex | Role |
|---|---|---|
| `--primary` | `#6A0DAD` | Purple — brand primary, borders, active states |
| `--accent` | `#BF40BF` | Magenta/orchid — glows, active text, panel titles |
| `--bg-deep` | `#0D0D1A` | Deepest background, content area |
| `--bg` | `#111122` | Base background |
| `--bg2` | `#16162A` | Sidebar, panels, cards |
| `--bg3` | `#1E1E36` | Panel headers, table headers, inputs |
| `--slate` | `#2F4F4F` | Legacy login theme background |
| `--slate-light` | `#3D6060` | Legacy login border |
| `--border` | `#2A2A4A` | Default borders |
| `--border2` | `#6A0DAD44` | Purple-tinted border (hover/active) |
| `--text` | `#D4D4E8` | Body text |
| `--text-dim` | `#7A7A9A` | Muted labels, meta |
| `--text-bright` | `#EEEEFF` | Headings, stat values |
| `--critical` | `#FF3131` | Critical severity / danger |
| `--high` | `#FF6B00` | High severity / orange |
| `--medium` | `#FFD700` | Medium severity / gold |
| `--low` | `#00BFFF` | Low severity / cyan |
| `--info` | `#888888` | Info / neutral |
| `--success` | `#39FF14` | Neon green — online/resolved states |

### Typography
Three font families, all from Google Fonts:

| Role | Family | Weights | Usage |
|---|---|---|---|
| `--font-title` | Orbitron | 400, 700, 900 | Logo, page titles, stat values |
| `--font-ui` | Rajdhani | 400, 500, 600, 700 | Body, nav, cards, buttons |
| `--font-mono` | Share Tech Mono | 400 | Labels, timestamps, code, badges, all-caps headers |

- **Font files**: Loaded from Google Fonts CDN. See `fonts/` for local copies.
- **Base size**: 14px body. 10–11px for labels. 28px for stat values. 18px for logo name.
- **Letter-spacing**: Aggressive — 2–6px on titles and labels. Intentional "cyber" feel.
- **Line height**: 1.5 body, 1 for display/stat values.

### Spacing & Layout
- `--sidebar-w`: 220px fixed left sidebar
- `--topbar-h`: 64px fixed top bar
- `--radius`: 6px (cards/buttons); 3–4px (badges, inputs)
- Content padding: 20–24px
- Grid gaps: 14px standard

### Backgrounds & Textures
- **Cyber grid**: `repeating-linear-gradient` at 40px spacing in `var(--border)` color — applied to content area
- **Scanlines**: Animated `repeating-linear-gradient` at 4px, moves vertically (8s infinite) — full-screen fixed overlay
- **Hex decoration**: Large `⬡` character at opacity 0.02 as background decoration

### Animation
- `fadeIn`: 0.3s ease `opacity + translateY(8px→0)` — all table rows on load
- `scanMove`: 8s linear infinite — scanline overlay
- `bearGlow`: 3s ease-in-out infinite alternate — logo glow pulse
- `pulseBadge`: 1.5s ease-in-out infinite — critical alert badge glow
- `dotPulse`: 2s ease-in-out infinite — status indicator
- `spin`: 0.7s linear infinite — loading spinner
- **Easing**: ease / ease-in-out. No bounces or spring physics.
- **Transitions**: 0.2s ease on all interactive elements (border-color, background, transform)

### Hover & Press States
- Cards: `border-color → var(--primary)` + `translateY(-1px)`
- Nav links: `background: rgba(106,13,173,0.12)` + `border-left: 3px solid var(--primary)`
- Active nav: `linear-gradient(90deg, rgba(106,13,173,0.25), transparent)` + `border-left: var(--accent)`
- Buttons: `border-color → primary` + `color → accent` + `background rgba(primary, 0.12)`
- Primary button hover: `background rgba(primary, 0.35)`
- Table rows: `background rgba(106,13,173,0.08)`

### Cards & Panels
- Background: `var(--bg2)` with `1px solid var(--border)` border
- Panel header: `var(--bg3)` background, bottom border, monospace title in `var(--accent)`
- Stat cards: top `2px` color accent bar (color-coded by severity)
- Hover: border → `var(--primary)`
- Sidebar: `4px 0 24px rgba(106,13,173,0.15)` right shadow + `2px gradient top bar`
- Modal: `0 0 40px rgba(106,13,173,0.3)` glow shadow + `1px solid var(--primary)` border

### Badges & Tags
- Severity badges: `font-mono`, uppercase, 10px, colored text + transparent background fill + tinted border
- IP tags: cyan (`var(--low)`) monospace inline chips
- Status badges: same pattern with green/red/gold/grey per state

### Liquid Glass Elements (user requirement)
- The user has requested **liquid glass** style additions. These should be implemented as:
  - `backdrop-filter: blur(12–16px)` on modal/overlay panels
  - `background: rgba(var(--bg2-rgb), 0.7)` semi-transparent backgrounds
  - `border: 1px solid rgba(255,255,255,0.08)` subtle light borders
  - Subtle `inset 0 0 0 1px rgba(255,255,255,0.03)` inner glow
  - The login panel already uses `inset 0 0 0 1px rgba(255,255,255,.03)` as a seed

### Corner Radii
- Cards, panels, modals: 6–8px
- Badges, inputs: 3px
- Status dots, toggle knob: 50%
- Scrollbar thumb: 3px

### Scrollbar
- Width: 6px
- Track: `var(--bg2)`
- Thumb: `var(--primary)` → hover `var(--accent)`

---

## Iconography

Unicode glyphs are the icon system — **no external icon font is used**.

| Glyph | Usage |
|---|---|
| ⬡ | Dashboard nav + hex decorative background |
| ◈ | Events / log stream |
| ⚡ | Alerts / incidents |
| ⟁ | Rules / correlation |
| ◉ | Agents |
| 🐻 | Brand logo / bear mascot (emoji) |
| ⊕ | Detail/expand action button |
| ↺ | Refresh action |
| ✕ | Close/dismiss |
| ✓ | Resolve/confirm |
| ✗ | Reject / false positive |
| ▶ | Start / in-progress action |
| ✎ | Edit |
| ⏻ | Power / logout |

**No SVG icons, no icon fonts (Lucide, Heroicons, etc.).** The product uses only Unicode characters. This is intentional and part of the "terminal/cyber" aesthetic.

**Logo**: The bear mascot (🐻 emoji with CSS glow animation) is the primary brand mark. No SVG logo exists in the codebase.

---

## File Index

```
README.md                    ← this file
SKILL.md                     ← agent skill descriptor
colors_and_type.css          ← CSS variables: colors, typography, spacing
assets/                      ← brand assets (logo, backgrounds)
fonts/                       ← Google Fonts local copies (Orbitron, Rajdhani, Share Tech Mono)
preview/                     ← Design System card previews
  colors-bg.html             ← Background color scale
  colors-brand.html          ← Brand primary/accent colors
  colors-severity.html       ← Severity color palette
  colors-semantic.html       ← Semantic (status/text) colors
  type-display.html          ← Orbitron display type specimens
  type-ui.html               ← Rajdhani UI type specimens
  type-mono.html             ← Share Tech Mono specimens
  type-scale.html            ← Full type scale
  spacing-tokens.html        ← Spacing, radius, layout tokens
  spacing-shadows.html       ← Shadow & glow system
  components-buttons.html    ← Button variants
  components-badges.html     ← Severity & status badges
  components-inputs.html     ← Form inputs & toggles
  components-cards.html      ← Stat cards & panels
  components-table.html      ← Data table
  components-modal.html      ← Modal pattern
  brand-logo.html            ← Logo & mascot
  brand-effects.html         ← Scanlines, cyber grid, glows
ui_kits/
  ursus_app/
    README.md                ← UI kit documentation
    index.html               ← Interactive SIEM prototype (click-thru)
    Sidebar.jsx              ← Sidebar navigation component
    TopBar.jsx               ← Top bar with clock/queue
    StatCard.jsx             ← KPI stat card
    DataTable.jsx            ← Sortable data table
    Badges.jsx               ← Severity/status badge components
    Modal.jsx                ← Modal overlay component
    Dashboard.jsx            ← Dashboard screen
    EventsScreen.jsx         ← Events log screen
    AlertsScreen.jsx         ← Incidents management screen
    LoginScreen.jsx          ← Login page
```
