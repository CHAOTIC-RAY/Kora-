# Plan: Heavy UI Skins Implementation

## Goal
Add new full-aesthetic "skins" that redesign the entire UI chrome and components following specific design systems. Each skin is a cohesive visual overhaul — not just a color palette swap.

## Context
- Existing infrastructure: `src/lib/appSkin.ts` defines `APP_SKINS` array with 4 light skins: kora, paper, studio, soft. Each applied as `body.skin-<name>` with CSS overrides for chrome, cards, nav, etc.
- Display themes (mint/amoled/etc.) are orthogonal color palettes handled via CSS class tokens.
- App.tsx passes `appSkin` state and `skinBodyClass(appSkin)` applies the body class.

## New Skins to Add
| Skin ID | Design System | Key Characteristics |
|---|---|---|
| `ios-glass` | Apple iOS 18 | Frosted glass, vibrant BG blur, liquid glass icons, rounded, SF Pro stack |
| `material-ex` | Google Material 3 Expressive | Tonal palettes, elevated surfaces, expressive typography, motion |
| `nothing` | Nothing OS | NDOT Sans font, matrix-style dotted icons, monochrome accents |
| `cyberpunk` | Cyberpunk | Neon grids, dark mode only, glowing borders, glitch effects |
| `library` | Wood/Library | Walnut/wood textures, warm amber tones, paper-like surfaces |

## Implementation Steps

### Phase 1: Register skins in data model (src/lib/appSkin.ts)
- Add 5 new entries to `APP_SKINS` array with `id`, `label`, `description`, `uiFont`.

### Phase 2: CSS skins (src/styles/app-skins.css)
- Append 5 new `body.skin-<id>` rule blocks following the existing pattern.
- Each uses CSS variables + scoped component overrides.
- Ensure dark-mode compatibility where relevant.

### Phase 3: Settings UI (src/components/SettingsView.tsx)
- Update skin radio group to render 5 new options with preview swatches.

## Verification
- `bun run lint` + `bun run build` pass.
- Manual: switch skins in Settings → see body class change + visual overhaul.
- Existing 4 skins render correctly (regression check).