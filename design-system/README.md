# Reyansh ERP — UI Design System

The component and token library for the Reyansh manufacturing ERP (React 18 + MUI v7).
Every card in this project is generated directly from the app's real theme
(`src/theme/buildAppTheme.js`) — colours, type, spacing, and component styles match
production 1:1.

## Foundations
- **Brand colours** — primary sky blue `#45ADE6`, secondary slate `#2D3D4C`
- **Semantic colours** — success `#059669`, error `#C0392B`, warning `#D97706`, info `#1E7DBE`
- **Neutrals & surfaces** — slate grey ramp, `background.default #F2F5F7`, `paper #FFFFFF`
- **Typography** — Montserrat (display/headings) + Inter (body/UI)
- **Spacing & radii** — 8px base grid, global radius 8 (chips 6)
- **Elevation** — soft slate-tinted shadows, elevations 1–3

## Components
Buttons · Status chips · Form inputs · Data table · Tabs · Cards

## Dashboard widgets
KPI stat cards · Client & order cards

## Editing
Each `preview/*.html` is self-contained and starts with a `<!-- @dsCard group="…" -->`
marker that the Design System pane uses to build its card index. Update the matching
token in `buildAppTheme.js` and the preview together so the system stays truthful.
