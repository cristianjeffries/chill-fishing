# 🎣 Chill Fishing

A cozy, browser-based fishing RPG built from scratch in vanilla JavaScript on an HTML5 Canvas — no frameworks, no build step, no dependencies. Cast a line, explore deeper waters, fill out your journal, and unwind.

**▶️ [Play it here](https://YOUR_USERNAME.github.io/chill-fishing/)**  ← _(update this link after enabling GitHub Pages)_

![Chill Fishing](https://img.shields.io/badge/play-in%20browser-1D9E75) ![Vanilla JS](https://img.shields.io/badge/vanilla-JavaScript-f7df1e) ![No dependencies](https://img.shields.io/badge/dependencies-0-brightgreen)

---

## About

Chill Fishing is a relaxing collectathon in the spirit of cozy games like *Stardew Valley* and *A Short Hike*. Sail across a continuous ocean, cast into different depth zones, and reel in 50+ species of fish across a progression that gently smooths out the more you play.

The whole game runs in a single Canvas element and persists your progress locally, so you can close the tab and pick up right where you left off.

## Features

- **Eight fishing spots across four depth zones** — from the Shallow Bay down to the Abyss, each unlocked through progression.
- **50+ fish species** with a three-level journal to catalogue them all — including size and value records for each catch.
- **Timing-based cast & reel** — set your depth, nail the perfect cast, and fight fish with distinct reel behaviors.
- **Day / night cycle** with a shared sun-and-moon arc and smooth, continuous lighting transitions.
- **Weather system** — rain speeds up bites, fog closes in the horizon, and rare storms surface exclusive storm-only fish.
- **Boats & upgrades** — swap between boats with different speed/cargo tradeoffs, and buy an Autopilot to auto-sail between zones.
- **A living title screen** — the world (and its weather) continues behind the menu.
- **Persistent saves** via local storage.

## Controls

| Action | Key |
| --- | --- |
| Move boat | `A` / `D` or `←` / `→` |
| Set casting depth | `W` / `S` or `↑` / `↓` |
| Cast / reel | `Space` (hold to charge, tap to reel) |
| Retrieve line | `R` |
| Auto-sail (with Autopilot) | `T`, then `←` / `→` to change destination |
| Menus / close | `Esc` |

## Running locally

No build step required. Clone the repo and serve the folder with any static file server:

```bash
git clone https://github.com/YOUR_USERNAME/chill-fishing.git
cd chill-fishing
python3 -m http.server 8000
```

Then open <http://localhost:8000> in your browser. (Opening `index.html` directly via `file://` also works for most features.)

## Project structure

```
chill-fishing/
├── index.html   # markup + canvas container
├── style.css    # UI, panels, and menu styling
├── game.js      # all game logic and Canvas rendering
└── README.md
```

The game is intentionally kept to three files with zero dependencies, so it's easy to read, hack on, and host anywhere.

## Tech

- Vanilla JavaScript (ES6+)
- HTML5 Canvas 2D
- `localStorage` for saves
- No frameworks, no bundler, no dependencies

## License

MIT — see [LICENSE](LICENSE).
