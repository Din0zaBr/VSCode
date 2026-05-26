# URSUS Insight — App UI Kit

A high-fidelity React component kit for the URSUS Insight SIEM web application.

## Structure

| File | Purpose |
|---|---|
| `index.html` | Interactive click-thru prototype (Login → Dashboard → Events → Alerts) |
| `Sidebar.jsx` | Fixed left sidebar with nav links and status indicator |
| `TopBar.jsx` | Top bar with page title, clock, queue counter |
| `StatCard.jsx` | KPI stat cards with top accent bar |
| `DataTable.jsx` | Sortable/filterable data table |
| `Badges.jsx` | Severity, status, IP tag badge components |
| `Modal.jsx` | Modal overlay with purple glow |
| `Dashboard.jsx` | Dashboard screen (stats + chart panels + recent tables) |
| `EventsScreen.jsx` | Events log with search + filters |
| `AlertsScreen.jsx` | Incidents management with status workflow |
| `LoginScreen.jsx` | Login page with animated bear + cyber grid |

## Design System

- **Theme**: Cyber Forest — deep navy + purple/magenta
- **Fonts**: Orbitron (titles), Rajdhani (UI), Share Tech Mono (labels/code)
- **Primary**: `#6A0DAD` | **Accent**: `#BF40BF`
- **Glass**: `backdrop-filter: blur(14px)` on modals and elevated panels
- **Scanlines**: Fixed overlay with subtle animated scanline texture
- **Cyber grid**: 40px repeating grid on content areas
- **Icons**: Unicode glyphs only — ⬡ ◈ ⚡ ⟁ ◉ (no icon font)

## Usage

Open `index.html` in a browser. Use sidebar navigation to move between screens.
The prototype uses fake/demo data — no backend required.
