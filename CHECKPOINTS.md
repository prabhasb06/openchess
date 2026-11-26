# Chess Local Android checkpoints

## 2.6.6 release

The release target is a signed, standalone Android build from this repository.

- [x] **Mobile play.** Start as a guest, play by touch and drag, navigate move history, and return from game and review screens on the Android emulator.
- [x] **Offline features.** Play both colors against Stockfish, finish a coach game, solve a puzzle, complete a lesson, and review a game with Wi-Fi off.
- [x] **Saved data and files.** The emulator kept games, preferences, a bot session, puzzle and lesson progress, and cached reviews across a signed in-place update from 2.6.5. Native PGN export and re-import reproduced the same game after cancelling and reopening both document pickers.
- [x] **Release packaging.** Rebuilt both signed APKs byte for byte from the React bundle. Verified the ARM64 Stockfish 18 hash, rebuilt the matching x86-64 Stockfish binary from the pinned distribution, and confirmed both embedded network hashes.

The Android runtime checks use the Medium Phone API 37 x86-64 emulator. The offline runs use airplane mode with Wi-Fi disabled. The isolated test app uses the same React bundle and Android source as the phone release.

The 2.6.6 app passed fresh guest onboarding, touch and drag, both colors against the beginner bot, a reply from the strongest preset, coach feedback and hints, training, Back navigation, rotation, and native PGN round-trip. The WebView started 21 sounds while offline. Stockfish retained its process through scrubbing and four cancelled searches. It classified the queen sacrifice `Qg8+` as Brilliant and reviewed a Chess960 castle with replayable continuations. A ten-label review fixture verified the highlight, notation, and coach symbols and colors. The native pairing dialog rejected a public address and completed health and engine requests to a private address using the entered pairing code.

The source checks passed 18 OpenChess tests, 119 Chess Local tests, 42 mobile browser scenarios, and strict Java 17 compilation with zero warnings. Both APKs passed 16 KB ZIP alignment and APK signature verification and requested only the Internet permission.

| Build | Package | SHA-256 |
| --- | --- | --- |
| ARM64 Chess Local 2.6.6 update | `local.chess.app` | `968b127d8dae6662560650e3a78f0afca3c6d75726eacb5f9fd6ae93fe9b6e86` |
| x86-64 Android emulator 2.6.6 smoke build | `local.chess.openchess.smoke` | `8e3b5f2668f0e99de87856549c2a5330a937c1c4c44c0aeb2037c7b41d198a02` |

Both builds use Android version code 18. The ARM64 update uses the original Chess Local signing certificate. The x86-64 test build uses the OpenChess development certificate.

## Game Review update 2.6.7

The Android 17 emulator completed the fixed 40-move PGN three times per version after a warm-up game and with the saved report cleared before each trial. Review 2.6.6 took 23.917, 23.342, and 23.082 seconds. Review 2.6.7 took 24.572, 20.308, and 21.311 seconds. The median fell from 23.342 to 21.311 seconds, an 8.7% reduction.

After cancellation, the Android UI reused all six completed Stockfish searches on retry and finished the report. The offline smoke suite covered two-player, bot, and coach games. The extended suite verified the Brilliant queen sacrifice, Chess960 continuations, and all ten move-classification badges. All 20 source tests passed.

The local ARM64 update `downloads/chess-local-2.6.7-offline.apk` uses `local.chess.app`, Android version code 19, and the original Chess Local signing certificate. Its SHA-256 is `c1df99d849647f54da52b3d902c6f6cccb603b1d584c8a50709ad70cbfec3ee2`. Runtime checks ran on the emulator.

## Game Review performance target in 2.6.8

The same fixed 40-move game ran on the Android 17 x86-64 emulator in airplane mode with Wi-Fi disabled. The benchmark warms Stockfish on a separate game, then clears the saved report and reloads the WebView before each timed review.

| Build | Run 1 | Run 2 | Run 3 | Median |
| --- | --- | --- | --- | --- |
| 2.6.6 | 23.917 s | 23.342 s | 23.082 s | 23.342 s |
| 2.6.8 | 14.794 s | 15.489 s | 14.795 s | 14.795 s |

The median fell by 36.62%, exceeding the 30% target. Game Review queues one extra request on the on-device engine, shares completed evaluations between adjacent positions, and escalates uncertain tactical searches. All 23 source tests passed. An in-place emulator update from 2.6.7 preserved the saved games, settings, bot session, training progress, and reviews.

The installed build kept Stockfish running during four cancelled Analysis searches. Game Review cancelled its outstanding work, reused 13 completed searches on retry, and finished on the same Stockfish process. The emulator also verified all ten move-classification badges, the Brilliant queen sacrifice `Qg8+`, and legal Chess960 continuations.

The local ARM64 update `downloads/chess-local-2.6.8-offline.apk` uses `local.chess.app`, Android version code 20, and the original Chess Local signing certificate. Its SHA-256 is `19adbba7f8882088bc1af2ad0a82b6e173db7f78a13bb0daae1aa2c15131d636`. Android runtime verification used the emulator.

## Bot strength update in 2.6.9

The Stockfish slider applies its selected engine skill and gives stronger levels more search time. Rated opponents use their profile skill to set search depth. Beginner profiles still sample from the full legal move list. Advanced profiles consider only Stockfish alternatives close to the best expected score.

The calibration sampled 120 seeded selections per bot in eight positions across both colors, covering openings, attacks, and pawn endings. Pebble, Signal, and Vector conceded 26.89, 7.45, and 0.05 expected-score points on average against the Stockfish reference. On the two attack positions, Vector's costly-move counts fell from 7 of 120 to 0 of 120 for each color. These samples describe the bot policies in this position set. Displayed ratings remain approximate.

All 25 source tests passed. The Android emulator received the slider's minimum and maximum skill values and searched to depth 16 at maximum. The signed in-place upgrade preserved the test profile's saved data. Offline checks covered bot play from both sides, coach play, hints, and Chess960 Game Review.

The local ARM64 update `downloads/chess-local-2.6.9-offline.apk` uses `local.chess.app`, Android version code 21, and the original Chess Local signing certificate. Its SHA-256 is `85f6cf143f02f778ded816f353b84c73f85dd6c5356890b45c824137087b6865`.

## Coach review continuity in 2.6.10

Game Review names the coach stored in the game's PGN and uses the current local selection if the game has no recognized coach. The emulator verified that a Vale game still shows Vale from the saved-games list after switching the current choice to Ember. An imported PGN with an unfamiliar coach showed Ember. The in-place update preserved saved data, and all 25 source tests and extended emulator checks passed.

The local ARM64 update `downloads/chess-local-2.6.10-offline.apk` uses `local.chess.app`, Android version code 22, and the original Chess Local signing certificate. Its SHA-256 is `358250267076637501e880f0b2460a8875ba8cb6e44c54b3bb975e87a90617d3`. Runtime checks ran on the Android emulator.

## Complete bot-game benchmark

The 2.6.10 bot policies played 18 games using Windows Stockfish 18 and the app's search settings. Each pairing played the Italian Game, Sicilian Defense, and Queen's Gambit with colors reversed. The sampler used fixed seeds per bot and opening. Timed engine searches can vary across runs.

| Pairing | Higher-rated wins | Draws | Lower-rated wins |
| --- | --- | --- | --- |
| Signal vs. Pebble | 6 | 0 | 0 |
| Vector vs. Signal | 6 | 0 | 0 |
| Apex vs. Vector | 1 | 5 | 0 |

Signal and Vector each won three games with each color. Apex won one game as White. All 18 PGNs replayed legally. Thirteen games ended in checkmate and five in legal draws. These outcomes describe the benchmark sample. Displayed ratings remain approximate.

To repeat the benchmark with the existing Stockfish executable, run `node tests/bot-match-benchmark.mjs android/build/bot-match-2.6.10.pgn`.

## Published 2.6.10 release verification

The signed ARM64 APK rebuilt from commit `6c5f5b97d481120b0baeb2a5edee3cc75170750a` matched the APK downloaded from GitHub, the release digest, and the downloadable `SHA256SUMS.txt`. Use an LF checkout when reproducing this APK on Windows. Vite's generated Android HTML and the packaged Stockfish license both changed when Git converted their source files to CRLF.

| Release check | Result |
| --- | --- |
| Application | `local.chess.app`, 2.6.10, version code 22 |
| APK SHA-256 | `358250267076637501e880f0b2460a8875ba8cb6e44c54b3bb975e87a90617d3` |
| Original signing certificate SHA-256 | `e17f8270c7a1b2b63ab2efc8365476df63ede994a63a37bcf16d77e699519cdc` |
| APK signature and alignment | Android signature schemes v2 and v3 verified. 16 KB alignment passed. |
| Shared application payload | 39 matching web assets and DEX entries in the ARM64 and x86-64 APKs. |

All 25 source tests passed at the published commit. A clean Android 17 emulator install in airplane mode covered guest onboarding, two-player games, beginner bots from both colors, the advanced bot, coach feedback and hints, Back and resume, training, rotation, and audio. Game Review rendered all ten badges, classified the sound queen sacrifice `Qg8+` as Brilliant, and kept the Chess960 continuations legal. The 2.6.9-to-2.6.10 signed upgrade preserved the saved test profile after restart. Native PGN export and import round-tripped a game after each picker was cancelled and reopened. In a separate network-enabled check, LAN pairing rejected a public address and completed health and engine requests to a private address.

Three uncached Game Reviews of the same 40-move game took 16.474, 13.862, and 14.940 seconds. The 14.940-second median was 36.0% lower than the 2.6.6 baseline of 23.342 seconds. The review cancellation check cancelled two outstanding searches, reused eight completed searches on retry, and finished with the same Stockfish process.

Android runtime verification ran on the emulator. The Samsung was unavailable through ADB during these checks.

## Run the checks

Launch the debuggable emulator build with the package ID `local.chess.openchess.smoke`. Set `OPENCHESS_TEST_SERIAL` or `OPENCHESS_TEST_PACKAGE` if your emulator uses a different serial or package ID.

```powershell
npm test
node tests/android-emulator-smoke.mjs
node tests/android-emulator-smoke.mjs --extended
node tests/android-emulator-smoke.mjs --benchmark-review
node tests/android-emulator-smoke.mjs --review-resume
node tests/android-emulator-smoke.mjs --stockfish-slider
node tests/android-emulator-smoke.mjs --coach-review
node tests/android-emulator-smoke.mjs --pgn-files
node tests/android-emulator-smoke.mjs --lan
```

Use `--fresh` on a clean test install. For a signed upgrade, run the smoke suite on the earlier build, capture the populated state with `--save-state`, then install the newer build over the same test package and run `--check-state`. Set `OPENCHESS_TEST_STATE_FILE` to keep upgrade snapshots for different version pairs. The LAN check temporarily enables the emulator network and uses the PC's local engine. Set `STOCKFISH_PATH` to the existing Windows executable for the Node and LAN checks.
