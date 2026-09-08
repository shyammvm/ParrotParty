# TinTom Simulator — Audio Packs & Sound Library

## 🚀 100% Automatic Sound Pack Discovery!

**No code edits needed!** Whenever you create a new folder under `public/sounds/` with audio files (`.mp3`, `.wav`, `.ogg`, `.m4a`, `.aac`), the app **automatically detects it and creates a playable sound pack**.

All sounds in the game are **100% real audio clips** (synthesized placeholder sounds have been removed).

---

## 📁 How to Add a New Sound Pack

1. Create a new folder inside `public/sounds/` (e.g. `public/sounds/memes/` or `public/sounds/movies/`)
2. Drop your audio files into that folder:

```
public/
└── sounds/
    ├── japanese/
    │   ├── ara ara.mp3
    │   ├── arigatoo.mp3
    │   ├── cat girl.mp3
    │   ├── hoi hoi hoi.mp3
    │   ├── japanese.mp3
    │   ├── nani.mp3
    │   ├── onii chan.mp3
    │   ├── scream.mp3
    │   ├── sumi ma sen.mp3
    │   └── yada yada.mp3
    │
    └── memes/                  ← Just add a folder!
        ├── emotional_damage.mp3
        ├── bruh.mp3
        └── wow.mp3
```

3. **That's it!** The pack will automatically appear in the Lobby with:
   - Pack title generated from folder name (e.g. `memes` → `🤣 Memes Pack`)
   - Sound titles formatted from file names (e.g. `cat girl.mp3` → `Cat Girl`)
   - Real-time Hot Module Replacement during development.

---

## 🎵 Supported Formats

- **MP3** (recommended — lightweight and universally supported)
- **WAV** (lossless quality)
- **OGG** (Chrome, Firefox, Edge)
- **M4A / AAC** (iOS, Safari)
- **FLAC**

> **Tip**: For best gameplay and voice comparison, keep audio clips between **1.0 and 6.0 seconds** long.

---

## 🌐 Automatic Deployment

When building with `npm run build` for GitHub Pages or production hosting, Vite automatically bundles and hashes all discovered audio files into the distribution bundle with zero extra configuration.
