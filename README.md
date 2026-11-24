# OpenChess

OpenChess is the source repository for the original-art edition of Chess Local. It includes local chess and Chess960, Stockfish opponents, Play Against Coach, Game Review, puzzles, lessons, and PGN import and export.

## Run locally

Use Node.js 24. For computer engine features, set `STOCKFISH_PATH` to an existing Stockfish executable.

```powershell
npm ci
$env:STOCKFISH_PATH = 'C:/path/to/stockfish.exe'
npm run build
npm start
```

Open [Chess Local on your computer](http://127.0.0.1:3001). The web server listens on loopback by default.

## Build the Android app

Install Python 3.12+, a JDK, and the Android SDK platform and build tools. Set `ANDROID_SDK_ROOT` if you use a custom SDK path. Use the ARM64 Stockfish 18 executable from the release archive named in [stockfish.json](android/engine/stockfish.json) as `android/engine/libstockfish.so`. The APK builder verifies its SHA-256. [Stockfish 18 source and release](https://github.com/official-stockfish/Stockfish/releases/tag/sf_18)

```powershell
npm ci
npm run build:apk
```

The resulting APK is `downloads/openchess.apk`. It includes the engine and works offline. A first build creates a local development key. For an update to an existing installation, use the original signing key and provide `OPENCHESS_SIGNING_KEY`, `OPENCHESS_SIGNING_ALIAS`, and `OPENCHESS_SIGNING_PASSWORD` in your local environment.

For an x86-64 emulator, keep the same verified Stockfish archive at `android/engine/stockfish-android-armv8.tar`. Set `OPENCHESS_NDK` to your installed NDK r30 and run `python android/build_emulator_engine.py`, then `python android/build.py --emulator` after building the web bundle with `npx vite build --mode apk`.

## Tests and licensing

Run `npm test` with `STOCKFISH_PATH` set. The application source uses the [MIT license](LICENSE). Stockfish is a separate [GPL-3.0 component](android/engine/COPYING.txt).
