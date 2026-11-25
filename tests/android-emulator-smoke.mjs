import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { once } from "node:events";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { chromium } from "playwright";
import { createRulesGame } from "../src/chess-rules.js";
import { REVIEW_CLASSES, runGameReview } from "../src/review-model.js";
import { createAppServer } from "../server.mjs";

const sdk = process.env.ANDROID_SDK_ROOT || process.env.ANDROID_HOME ||
  join(process.env.LOCALAPPDATA || "", "Android", "Sdk");
const adb = join(sdk, "platform-tools", process.platform === "win32" ? "adb.exe" : "adb");
const packageName = process.env.OPENCHESS_TEST_PACKAGE || "local.chess.openchess.smoke";
const serial = process.env.OPENCHESS_TEST_SERIAL || "emulator-5554";
const localPort = 9227;
const shell = (...args) => execFileSync(adb, ["-s", serial, "shell", ...args], {encoding:"utf8"}).trim();
assert.equal(shell("settings", "get", "global", "airplane_mode_on"), "1", "Turn airplane mode on for the test");
assert.equal(shell("settings", "get", "global", "wifi_on"), "0", "Turn Wi-Fi off for the test");
const pid = shell("pidof", packageName);
assert(pid, "Launch the OpenChess emulator test package first");
execFileSync(adb, ["-s", serial, "forward", "tcp:" + localPort, "localabstract:webview_devtools_remote_" + pid]);

const browser = await chromium.connectOverCDP("http://127.0.0.1:" + localPort);
const page = browser.contexts().flatMap(context => context.pages()).find(tab => tab.url().includes("android.html"));
assert(page, "OpenChess Android WebView is unavailable");
page.setDefaultTimeout(15000);
const errors = [];
const sounds = new Set();
let playedSounds = 0;
page.on("pageerror", error => errors.push(error.message));
page.on("response", response => {
  if (response.ok() && response.url().includes("/chess-local/audio/")) sounds.add(response.url());
});
const button = name => page.getByRole("button", {name, exact: true});
const screen = name => page.locator('[data-mobile-route="' + name + '"]');
const square = name => page.locator('[data-square="' + name + '"]').first();
const read = key => page.evaluate(key => JSON.parse(localStorage.getItem(key) || "null"), key);
const gamesKey = "chess-local-mobile-sessions-v1";
const activeGame = async mode => (await read(gamesKey))?.[mode];
await page.exposeBinding("recordOpenChessSound", () => { playedSounds++; });
function monitorAudio() {
  const start = AudioBufferSourceNode.prototype.start;
  AudioBufferSourceNode.prototype.start = function (...args) {
    const result = start.apply(this, args);
    if (this.buffer && this.context.state === "running") window.recordOpenChessSound();
    return result;
  };
}
await page.addInitScript(monitorAudio);
await page.evaluate(monitorAudio);
async function touchSquare(from, to) {
  const touch = await page.context().newCDPSession(page);
  async function center(id) {
    const box = await square(id).boundingBox();
    assert(box, "Missing square " + id);
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  }
  const a = await center(from), b = to && await center(to);
  try {
    await touch.send("Input.dispatchTouchEvent", {type:"touchStart", touchPoints:[a]});
    if (b) {
      for (const fraction of [.2, .4, .6, .8, 1]) {
        await touch.send("Input.dispatchTouchEvent", {type:"touchMove", touchPoints:[
          {x:a.x + (b.x-a.x)*fraction, y:a.y + (b.y-a.y)*fraction},
        ]});
      }
    }
    await touch.send("Input.dispatchTouchEvent", {type:"touchEnd", touchPoints:[]});
  } finally {
    await touch.detach();
  }
}
async function tapMove(from, to) {
  await touchSquare(from);
  await touchSquare(to);
}
const back = () => shell("input", "keyevent", "4");
const settle = id => screen(id).waitFor();
async function goHome() {
  await page.evaluate(() => { location.hash = "home"; });
  await settle("home");
}
async function checkLocal(onResult) {
  await button("Play").click();
  await button("More play options").click();
  await button("Play in Person").click();
  await button("Play").click();
  await settle("game");
  const boardPosition = () => page.locator(".chessboard").evaluate(node => [scrollY, node.getBoundingClientRect().top]);
  const before = await boardPosition();
  await tapMove("f2", "f3");
  await tapMove("e7", "e5");
  assert.deepEqual(await boardPosition(), before);
  const controls = page.getByRole("navigation", {name:"Game controls"});
  await controls.getByRole("button", {name:"Back", exact:true}).click();
  await button("Return to Game").waitFor();
  back();
  await button("Return to Game").waitFor({state:"hidden"});
  assert.deepEqual((await activeGame("local")).moves, ["f2f3","e7e5"]);
  await tapMove("g2", "g4");
  await touchSquare("d8", "h4");
  const result = page.getByRole("dialog", {name:"Game over"});
  await result.waitFor();
  if (onResult) await onResult(result);
  await result.getByRole("button", {name:"Game Review", exact:true}).click();
  await page.locator('[data-mobile-review-status="complete"]').waitFor({timeout:60000});
  const openedPgn = await read("chess-local-review-pgn");
  const review = (await read("chess-local-reviews-v1")).find(item => item.pgn === openedPgn);
  assert.equal(review.moves.at(-1).afterEval.winner, "b");
  assert.equal(review.moves.at(-1).san, "Qh4#");
  await page.reload({waitUntil:"domcontentloaded"});
  await button("Back from review").click();
  await settle("game");
  assert.equal(await square("h4").getAttribute("aria-label"), "h4 black queen");
  console.log("Guest play, touch and drag, stable board, history, mate, and offline review passed");
}

function tapNativeControl(label, attribute = "text") {
  const dump = "/data/local/tmp/openchess-smoke.xml";
  shell("uiautomator", "dump", dump);
  const xml = shell("cat", dump);
  const node = Array.from(xml.matchAll(/<node\b[^>]*>/g), match => match[0])
    .findLast(tag => tag.toLowerCase().includes(attribute + '="' + label.toLowerCase() + '"'));
  const bounds = node?.match(/bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/);
  assert(bounds, "Missing native control " + label);
  const [, left, top, right, bottom] = bounds.map(Number);
  shell("input", "tap", String(Math.round((left + right) / 2)), String(Math.round((top + bottom) / 2)));
}

async function checkPgnFiles() {
  const isChooser = () => /topResumedActivity=.*documentsui/.test(shell("dumpsys", "activity", "activities"));
  async function waitForChooser(expected) {
    for (let attempt = 0; attempt < 25; attempt++) {
      if (isChooser() === expected) return;
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    assert.fail(expected ? "The file picker did not open" : "The file picker did not close");
  }
  const downloads = () => shell("ls", "-1", "/sdcard/Download").split(/\r?\n/).filter(Boolean);
  function pickDownloads() {
    tapNativeControl("Show roots", "content-desc");
    tapNativeControl("Downloads");
  }
  let filename;
  await goHome();
  await checkLocal(async () => {
    const before = downloads();
    await button("Share game PGN").click();
    await waitForChooser(true);
    back();
    await waitForChooser(false);
    assert.deepEqual(downloads(), before);
    await button("Share game PGN").click();
    await waitForChooser(true);
    pickDownloads();
    tapNativeControl("SAVE");
    await waitForChooser(false);
    const added = downloads().filter(file => !before.includes(file));
    assert.equal(added.length, 1, added.join(", "));
    [filename] = added;
    assert.match(filename, /^chess-local-game(?: \(\d+\))?\.pgn$/);
  });
  const exported = createRulesGame();
  exported.loadPgn(shell("cat", "'/sdcard/Download/" + filename + "'"));
  assert.equal(exported.getHeaders().Result, "0-1");
  assert.equal(exported.history().at(-1), "Qh4#");
  await page.evaluate(() => {
    localStorage.setItem("chess-local-review-pgn", '""');
    history.replaceState(null, "", "#review");
  });
  await page.reload({ waitUntil: "domcontentloaded" });
  await button("Import PGN file").click();
  await waitForChooser(true);
  back();
  await waitForChooser(false);
  assert.equal(await page.locator("#mobile-review-pgn").inputValue(), "");
  await button("Import PGN file").click();
  await waitForChooser(true);
  pickDownloads();
  tapNativeControl(filename);
  await waitForChooser(false);
  await page.locator('[data-mobile-review-status="complete"]').waitFor({ timeout: 60000 });
  const imported = createRulesGame();
  imported.loadPgn(await read("chess-local-review-pgn"));
  assert.deepEqual(imported.history(), exported.history());
  console.log("Native PGN export and import passed after cancelling and reopening each document picker");
}

async function checkLanPairing() {
  const token = randomBytes(12).toString("hex");
  const server = createAppServer({ lanToken: token });
  const requests = [];
  server.on("request", request => requests.push([request.method, request.url, request.headers["x-chess-token"] === token]));
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = "10.0.2.2:" + server.address().port;
  const config = () => page.evaluate(() => JSON.parse(window.ChessLocalAndroid.getConfig()));
  const open = () => page.evaluate(() => window.ChessLocalAndroid.configure());
  const clearField = () => shell("input", "keycombination", "113", "29");
  try {
    assert((await config()).onDevice, "Start the isolated test app with its on-device engine");
    shell("cmd", "connectivity", "airplane-mode", "disable");
    shell("svc", "wifi", "enable");
    await open();
    tapNativeControl("192.168.1.20:3002");
    clearField();
    shell("input", "text", "8.8.8.8:3002");
    tapNativeControl("Save");
    assert((await config()).onDevice, "A public IP must be rejected by the pairing dialog");
    const rejectText = shell("cat", "/data/local/tmp/openchess-smoke.xml");
    assert(rejectText.includes("8.8.8.8"));
    tapNativeControl("8.8.8.8:3002");
    clearField();
    shell("input", "text", address);
    tapNativeControl("Pairing token");
    shell("input", "text", token);
    tapNativeControl("Save");
    await page.waitForFunction(() => !JSON.parse(window.ChessLocalAndroid.getConfig()).onDevice);
    const game = createRulesGame();
    const replies = await page.evaluate(async fen => {
      const bridge = window.ChessLocalAndroid;
      const oldResponse = window.__chessNativeResponse;
      function request(id, path, method, body = "") {
        return new Promise(resolve => {
          window.__chessNativeResponse = (key, reply) => {
            if (id === key) resolve(reply);
            else oldResponse(key, reply);
          };
          bridge.request(id, path, method, body);
        });
      }
      try {
        return await Promise.race([
          (async () => [
            await request("smoke-health", "/api/health", "GET"),
            await request("smoke-engine", "/api/engine", "POST", JSON.stringify({ fen, variant: "standard", movetime: 100 })),
          ])(),
          new Promise(resolve => setTimeout(() => resolve([]), 12000)),
        ]);
      } finally {
        window.__chessNativeResponse = oldResponse;
      }
    }, game.fen());
    assert.deepEqual(replies.map(reply => reply.status), [200, 200], JSON.stringify(replies));
    const move = JSON.parse(replies[1].body).bestmove;
    assert(game.move({ from: move.slice(0, 2), to: move.slice(2, 4), promotion: move[4] }));
    assert(requests.some(([method, path, code]) => method === "GET" && path === "/api/health" && code));
    assert(requests.some(([method, path, code]) => method === "POST" && path === "/api/engine" && code));
    console.log("Native LAN pairing refused a public IP and completed health and Stockfish requests with a private IP");
  } finally {
    try {
      if (!(await config()).onDevice) {
        await open();
        tapNativeControl("Use on device");
      } else {
        const dump = "/data/local/tmp/openchess-smoke.xml";
        shell("uiautomator", "dump", dump);
        if (shell("cat", dump).includes("Pairing token")) tapNativeControl("Cancel");
      }
    } finally {
      shell("cmd", "connectivity", "airplane-mode", "enable");
      shell("svc", "wifi", "disable");
      server.closeAllConnections();
      await new Promise(resolve => server.close(resolve));
    }
  }
}
async function checkCoach() {
  await goHome();
  await button("Learn").click();
  await button("Learning options").click();
  await button("Play Coach").click();
  await page.locator('select[name="coach"]').selectOption("Vale");
  await page.locator('select[name="strength"]').selectOption("400");
  await page.locator('select[name="color"]').selectOption("w");
  await button("Play Coach Game").or(button("Start New Coach Game")).click();
  await page.locator(".am-game-bot-avatar img[alt=Vale]").waitFor();
  await button("Hint").click();
  await page.waitForFunction(() => /Look for (a way|an active move)/.test(document.querySelector(".am-game-speech")?.textContent));
  const arrows = page.locator(".am-game-board svg.arrows line");
  assert.equal(await arrows.count(), 0);
  await button("Hint").click();
  await arrows.first().waitFor({state:"attached"});
  await tapMove("e2", "e4");
  await page.waitForFunction(() => JSON.parse(localStorage.getItem("chess-local-mobile-sessions-v1")).coach?.moves.length === 2);
  assert.match(await page.locator(".am-game-speech").innerText(), /e4/);
  await button("Options").click();
  const options = page.getByRole("dialog", {name:"Options"});
  await options.waitFor();
  back();
  await options.waitFor({state:"hidden"});
  await settle("game");
  back();
  await settle("lessons");
  await button("Continue Coach Game").click();
  await settle("game");
  assert.equal((await activeGame("coach")).moves[0], "e2e4");
  await button("Resign").click();
  await button("Resign").last().click();
  await button("Game Review").last().click();
  await page.locator('[data-mobile-review-status="complete"]').waitFor({timeout:60000});
  assert.match(await read("chess-local-review-pgn"), /\[Coach "Vale"\]/);
  await button("Review").click();
  const coach = name => page.locator(".am-review-coach").getByText("Coach " + name, {exact:true});
  await coach("Vale").waitFor();
  const setup = await read("chess-local-mobile-coach-setup");
  try {
    await page.evaluate(setup => {
      localStorage.setItem("chess-local-mobile-coach-setup", JSON.stringify({...setup, name:"Ember"}));
    }, setup);
    await goHome();
    await button("More").click();
    await button("Stats").click();
    await settle("stats");
    const saved = page.locator(".am-history-game").filter({ hasText: /vs\. Vale/ }).first();
    await saved.getByRole("button", {name:"Game Review", exact:true}).click();
    await page.locator('[data-mobile-review-status="complete"]').waitFor({timeout:60000});
    await button("Review").click();
    await coach("Vale").waitFor();

    await button("New PGN").click();
    await page.locator("#mobile-review-pgn").fill('[Coach "Unlisted"]\n\n1. d4 d5 *');
    await button("Start Review").click();
    await page.locator('[data-mobile-review-status="complete"]').waitFor({timeout:60000});
    await button("Review").click();
    await coach("Ember").waitFor();
    assert.equal(await page.locator(".am-review-coach").getByText("Coach Unlisted", {exact:true}).count(), 0);
  } finally {
    await page.evaluate(setup => {
      localStorage.setItem("chess-local-mobile-coach-setup", JSON.stringify(setup));
    }, setup);
  }
  console.log("Coach selection, two-stage hints, feedback, Back, resume, and review passed");
  console.log("Saved reviews retain their coach. Imported games with unknown coaches use the selected local coach.");
}
async function selectBot(opponent) {
  await goHome();
  await button("Play").click();
  await button("Play Bots").click();
  await button(opponent).click();
}

async function startBot(side) {
  await button(side === "w" ? "Play as White" : "Play as Black").click();
  await button("Play").or(button("New Game")).click();
  await settle("game");
}

async function checkBot(side, opponent = "Pebble, 300") {
  await selectBot(opponent);
  await startBot(side);
  if (side === "w") await tapMove("e2", "e4");
  await page.waitForFunction(color => {
    const game = JSON.parse(localStorage.getItem("chess-local-mobile-sessions-v1")).bot;
    return game?.side === color && game.moves.length === (color === "w" ? 2 : 1);
  }, side);
  console.log(opponent + " replied with the human playing " + (side === "w" ? "White" : "Black"));
}

async function checkStockfishSlider() {
  await page.evaluate(() => {
    const bridge = window.ChessLocalAndroid;
    const original = window.__chessNativeResponse;
    const requests = new Map();
    window.__sliderSearches = [];
    window.__chessNativeResponse = (id, response) => {
      const search = requests.get(id);
      if (search && response.status === 200) {
        window.__sliderSearches.push({search, depth: JSON.parse(response.body).depth});
      }
      requests.delete(id);
      original(id, response);
    };
    const descriptor = Object.getOwnPropertyDescriptor(window, "ChessLocalAndroid");
    Object.defineProperty(window, "ChessLocalAndroid", { ...descriptor, value: new Proxy(bridge, {
      get(target, key) {
        if (key === "request") return (id, path, method, body) => {
          if (path === "/api/engine" && body && JSON.parse(body).purpose === "bot") requests.set(id, JSON.parse(body));
          target.request(id, path, method, body);
        };
        const member = target[key];
        return typeof member === "function" ? member.bind(target) : member;
      },
    }) });
  });
  try {
    for (const [index, [level, key]] of [[0, "Home"], [20, "End"]].entries()) {
      await selectBot("Stockfish");
      const slider = page.getByRole("slider", { name: "Engine strength" });
      await slider.press(key);
      assert.equal(await slider.inputValue(), String(level));
      await startBot("b");
      await page.waitForFunction(index => window.__sliderSearches.length > index, index);
      await page.waitForFunction(level => {
        const game = JSON.parse(localStorage.getItem("chess-local-mobile-sessions-v1")).bot;
        return game.bot?.skill === level && game.moves.length === 1;
      }, level);
    }
    const [minimum, maximum] = await page.evaluate(() => window.__sliderSearches);
    assert.deepEqual([minimum.search.skill, maximum.search.skill], [0, 20]);
    assert.equal(maximum.search.depth, undefined);
    assert(maximum.search.movetime > minimum.search.movetime);
    assert(maximum.depth > 5);
    console.log("The Stockfish slider reached the native engine at levels 0 and 20. Maximum searched to depth " + maximum.depth + ".");
  } finally {
    await page.reload({ waitUntil: "domcontentloaded" });
  }
}
async function checkTraining() {
  await goHome();
  await button("Puzzles").click();
  await button("Puzzle 1: The back rank").or(button("Puzzle 1: The back rank, completed")).click();
  await tapMove("a1", "a8");
  await button("Next Puzzle").waitFor();
  assert((await read("chess-local-solved")).includes("back-rank"));
  await goHome();
  await button("Learn").click();
  await button("Lesson 1: King steps").or(button("Lesson 1: King steps, completed")).click();
  await tapMove("e4", "d5");
  await button("Continue").click();
  await page.getByText("Lesson Complete!", {exact:true}).waitFor();
  assert((await read("chess-local-progress")).includes("the-king"));
  await page.reload({waitUntil:"domcontentloaded"});
  assert((await read("chess-local-progress")).includes("the-king"));
  assert((await read("chess-local-solved")).includes("back-rank"));
  console.log("Puzzle and lesson completed offline and their progress survived a reload");
}

async function verifyUpgradeState(save) {
  const stateFile = process.env.OPENCHESS_TEST_STATE_FILE || join("android", "build", "smoke-state-before-upgrade.json");
  await goHome();
  const keys = ["games", "settings", "mobile-sessions-v1", "solved", "progress", "reviews-v1"];
  const state = Object.fromEntries(await Promise.all(keys.map(async key => [key, await read("chess-local-" + key)])));
  if (save) {
    assert(state.games?.length > 0, "Complete and save a game before upgrading");
    assert(state.settings && Object.keys(state.settings).length > 0);
    assert(state["mobile-sessions-v1"]?.bot?.moves.length > 0);
    assert(state.solved?.includes("back-rank"));
    assert(state.progress?.includes("the-king"));
    assert(state["reviews-v1"]?.length > 0);
    await mkdir(dirname(stateFile), { recursive: true });
    await writeFile(stateFile, JSON.stringify(state), "utf8");
    console.log("Captured saved games, preferences, a bot session, training progress, and reviews");
  } else {
    assert.deepEqual(state, JSON.parse(await readFile(stateFile, "utf8")));
    console.log("All saved data matched after a signed in-place upgrade and app restart");
  }
}

async function checkRotationAndTrainingBack() {
  await goHome();
  await button("Learn").click();
  await button("Learning options").click();
  const menu = page.getByRole("dialog", { name: "Learn", exact: true });
  await menu.waitFor();
  await back();
  await menu.waitFor({ state: "hidden" });
  await button("Learning options").click();
  await menu.getByRole("button", { name: "Learn an Opening" }).click();
  await settle("openings");
  await page.locator(".am-local-library button").first().waitFor();
  await back();
  await settle("lessons");

  const previousLock = shell("settings", "get", "system", "accelerometer_rotation");
  const previousAngle = shell("settings", "get", "system", "user_rotation");
  try {
    shell("settings", "put", "system", "accelerometer_rotation", "0");
    shell("settings", "put", "system", "user_rotation", "1");
    await page.waitForFunction(() => innerWidth > innerHeight);
    await button("Learning options").click();
    await menu.waitFor();
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    const close = await button("Close Learn").boundingBox();
    assert(close.y >= 0 && close.y + close.height <= await page.evaluate(() => innerHeight));
    await back();
    await menu.waitFor({ state: "hidden" });
  } finally {
    shell("settings", "put", "system", "user_rotation", previousAngle === "null" ? "0" : previousAngle);
    shell("settings", "put", "system", "accelerometer_rotation", previousLock === "null" ? "0" : previousLock);
  }
  await page.waitForFunction(() => innerHeight > innerWidth);
  console.log("Android Back closed the Learn sheet and returned from Openings. Rotation preserved reachable controls.");
}

async function checkWarmCancellation() {
  await goHome();
  await page.evaluate(() => localStorage.removeItem("chess-local-mobile-analysis-v1"));
  await page.reload({ waitUntil: "domcontentloaded" });
  await settle("home");
  await page.evaluate(() => { location.hash = "analysis"; });
  await settle("analysis");
  await tapMove("e2", "e4");
  await tapMove("e7", "e5");
  await button("Hint").click();
  await button("Previous move").click();
  await button("Hint").click();
  await button("Next move").click();
  await button("Hint").click();
  await page.waitForFunction(() => !!document.querySelector(".am-game-pv")?.textContent.trim());

  const stockfishPid = () => shell("ps", "-A", "-o", "PID,PPID,NAME").split(/\r?\n/)
    .map(line => line.trim().split(/\s+/))
    .find(([, parent, name]) => parent === pid && name === "libstockfish.so")?.[0];
  const started = stockfishPid();
  assert(started, "No Stockfish child running after Analysis");
  const positions = createRulesGame();
  const firstFen = positions.fen();
  positions.move("d4");
  const result = await page.evaluate(async ({ firstFen, secondFen }) => {
    const bridge = window.ChessLocalAndroid;
    const oldResponse = window.__chessNativeResponse;
    const replies = new Map();
    let finish;
    const final = new Promise(resolve => { finish = resolve; });
    window.__chessNativeResponse = (id, response) => {
      if (id.startsWith("smoke:")) {
        replies.set(id, response.status);
        if (id === "smoke:final") finish(response);
      } else oldResponse(id, response);
    };
    const request = (id, fen, movetime) => bridge.request(id, "/api/engine", "POST",
      JSON.stringify({ fen, movetime, skill: 20, purpose: "analysis" }));
    try {
      for (let index = 0; index < 4; index++) {
        const id = "smoke:cancel:" + index;
        request(id, firstFen, 3000);
        await new Promise(resolve => setTimeout(resolve, 160));
        bridge.cancel(id);
      }
      request("smoke:final", secondFen, 120);
      const response = await Promise.race([final, new Promise(resolve => setTimeout(resolve, 5000))]);
      return { response, cancelledReplies: replies.size - (response ? 1 : 0) };
    } finally {
      window.__chessNativeResponse = oldResponse;
    }
  }, { firstFen, secondFen: positions.fen() });
  assert.equal(result.response?.status, 200);
  assert.equal(result.cancelledReplies, 0);
  const best = JSON.parse(result.response.body).bestmove;
  assert(positions.move({ from: best.slice(0, 2), to: best.slice(2, 4), promotion: best[4] }));
  assert.equal(stockfishPid(), started);
  console.log("Rapid Analysis scrubbing and four cancelled native searches kept Stockfish PID " + started + " warm");
}

async function checkReviewBadges() {
  const report = await runGameReview("1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 4. Ba4 Nf6 5. O-O Be7 *", {
    request: async (_, options) => {
      const game = createRulesGame(JSON.parse(options.body).fen);
      const { from, to } = game.moves({ verbose: true })[0];
      return { ok: true, json: async () => ({ evaluation: 0, bestmove: from + to }) };
    },
  });
  const icons = ["!!", "!", "★", "✓", "✓", "?!", "?", "×", "??", "•"];
  const classes = REVIEW_CLASSES;
  for (const [index, move] of report.moves.entries()) {
    move.classification = classes[index];
    report.counts.w[move.classification] = 0;
    report.counts.b[move.classification] = 0;
    report.counts[move.color][move.classification] = 1;
  }
  await page.evaluate(report => {
    const key = "chess-local-reviews-v1";
    const previous = JSON.parse(localStorage.getItem(key) || "[]");
    localStorage.setItem(key, JSON.stringify([report, ...previous.filter(item => item.pgn !== report.pgn)]));
    localStorage.setItem("chess-local-review-pgn", JSON.stringify(report.pgn));
    history.replaceState(null, "", "#review");
  }, report);
  try {
    await page.reload({waitUntil:"domcontentloaded"});
    await page.locator('[data-mobile-review-status="complete"]').waitFor();
    for (const [index, classification] of classes.entries()) {
      const label = page.locator(".am-review-counts").getByText(icons[index] + " " + classification, { exact: true });
      assert(await label.evaluate(node => !!node.style.color));
    }
    assert.equal(await page.getByText("6 key moments", { exact: true }).count(), 1);
    for (const [index, move] of report.moves.entries()) {
      await button("Highlights").click();
      await button((move.color === "w" ? "White " : "Black ") + move.classification + " moves").click();
      const badge = page.locator(".am-review-notation button[aria-current=true] sup");
      assert.equal(await badge.textContent(), icons[index]);
      assert(await badge.evaluate(node => !!node.style.color));
      const headline = page.getByRole("heading", { name: move.san + " " + icons[index] + " " + move.classification, exact: true });
      assert(await headline.evaluate(node => !!node.style.color));
    }
    assert(!await page.locator(".am-review").getByText(/undefined/).count());
    await button("Review settings").click();
    await page.getByRole("dialog").waitFor();
    await back();
    await page.getByRole("dialog").waitFor({ state: "hidden" });
    await back();
    await page.locator('[data-mobile-review-status]').waitFor({ state: "hidden" });
  } finally {
    await page.evaluate(pgn => {
      const key = "chess-local-reviews-v1";
      const saved = JSON.parse(localStorage.getItem(key) || "[]");
      localStorage.setItem(key, JSON.stringify(saved.filter(item => item.pgn !== pgn)));
    }, report.pgn);
  }
  console.log("All ten cached review labels rendered with the expected symbols and colors in highlights, notation, and coach feedback");
}

async function reviewGameWithEngine(game) {
  await goHome();
  await page.evaluate(pgn => {
    const cacheKey = "chess-local-reviews-v1";
    const cached = JSON.parse(localStorage.getItem(cacheKey) || "[]");
    localStorage.setItem(cacheKey, JSON.stringify(cached.filter(item => item.pgn !== pgn)));
    localStorage.setItem("chess-local-review-pgn", JSON.stringify(pgn));
    history.replaceState(null, "", "#review");
  }, game.pgn());
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.locator('[data-mobile-review-status="complete"]').waitFor({ timeout: 120000 });
  const pgn = await read("chess-local-review-pgn");
  return (await read("chess-local-reviews-v1")).find(item => item.pgn === pgn);
}

async function benchmarkReview() {
  const warmup = createRulesGame();
  warmup.loadPgn("1. f3 e5 2. g4 Qh4# 0-1");
  await reviewGameWithEngine(warmup);

  const game = createRulesGame();
  game.loadPgn(`1. e4 d6 2. d4 Nf6 3. Nc3 g6 4. Be3 Bg7 5. Qd2 c6 6. f3 b5 7. Nge2 Nbd7 8. Bh6 Bxh6 9. Qxh6 Bb7 10. a3 e5
11. O-O-O Qe7 12. Kb1 a6 13. Nc1 O-O-O 14. Nb3 exd4 15. Rxd4 c5 16. Rd1 Nb6 17. g3 Kb8 18. Na5 Ba8 19. Bh3 d5 20. Qf4+ Ka7
21. Rhe1 d4 22. Nd5 Nbxd5 23. exd5 Qd6 24. Rxd4 cxd4 25. Re7+ Kb6 26. Qxd4+ Kxa5 27. b4+ Ka4 28. Qc3 Qxd5 29. Ra7 Bb7 30. Rxb7 Qc4
31. Qxf6 Kxa3 32. Qxa6+ Kxb4 33. c3+ Kxc3 34. Qa1+ Kd2 35. Qb2+ Kd1 36. Bf1 Rd2 37. Rd7 Rxd7 38. Bxc4 bxc4 39. Qxh8 Rd3 40. Qa8 c3 *`);
  const times = [];
  for (let trial = 1; trial <= 3; trial++) {
    const started = performance.now();
    const report = await reviewGameWithEngine(game);
    const elapsed = Math.round(performance.now() - started);
    assert.equal(report.moves.length, 80);
    times.push(elapsed);
    console.log(`40-move review ${trial}: ${elapsed} ms`);
  }
  console.log(`Median of three uncached reviews: ${times.sort((a, b) => a - b)[1]} ms`);
}

async function checkNativeEngineReviews() {
  const game = createRulesGame("1q3r1k/6pp/4Q2N/8/8/8/8/4K3 w - - 0 1");
  game.move("Qg8+");
  const report = await reviewGameWithEngine(game);
  assert.equal(report.moves[0].classification, "Brilliant");
  await button("White Brilliant moves").click();
  await page.getByRole("heading", { name: "Qg8+ !! Brilliant", exact: true }).waitFor();
  console.log("On-device Stockfish classified the sound queen sacrifice Qg8+ as Brilliant");
  const chess960 = createRulesGame("k7/8/8/8/8/8/8/6KR w H - 0 1", "chess960");
  for (const move of ["O-O", "Kb7", "Rf7+", "Kc6"]) chess960.move(move);
  const castling = await reviewGameWithEngine(chess960);
  assert.equal(castling.variant, "chess960");
  assert.equal(castling.moves[0].san, "O-O");
  assert.equal(castling.moves[0].to, "h1");
  for (const move of castling.moves) {
    const board = createRulesGame(move.before, "chess960");
    for (const san of move.bestLine) assert(board.move(san));
  }
  console.log("On-device Chess960 review retained castling metadata and replayable engine continuations");
}

try {
  await page.locator(".android-app").waitFor();
  const saveState = process.argv.includes("--save-state");
  if (saveState || process.argv.includes("--check-state")) {
    await verifyUpgradeState(saveState);
  } else if (process.argv.includes("--benchmark-review")) {
    await benchmarkReview();
    assert.deepEqual(errors, []);
  } else if (process.argv.includes("--stockfish-slider")) {
    await checkStockfishSlider();
    assert.deepEqual(errors, []);
  } else if (process.argv.includes("--coach-review")) {
    await checkCoach();
    assert.deepEqual(errors, []);
  } else if (process.argv.includes("--pgn-files")) {
    await checkPgnFiles();
  } else if (process.argv.includes("--lan")) {
    await checkLanPairing();
  } else if (process.argv.includes("--extended")) {
    await checkRotationAndTrainingBack();
    await checkWarmCancellation();
    await checkBot("b", "Apex, 2200");
    await checkReviewBadges();
    await checkNativeEngineReviews();
    assert.deepEqual(errors, []);
  } else {
    if (await screen("welcome").isVisible()) {
      await button("Play as Guest").click();
      await settle("home");
      console.log("First launch and guest onboarding passed");
    } else {
      assert(!process.argv.includes("--fresh"), "Use a fresh test package to verify guest onboarding");
      await goHome();
    }
    await checkLocal();
    await checkCoach();
    await checkBot("w");
    await checkBot("b");
    await checkTraining();
    assert(sounds.size > 0, "No packaged sound samples loaded");
    assert(playedSounds > 0, "The WebView did not start a decoded sound");
    assert.deepEqual(errors, []);
    console.log(sounds.size + " sound samples loaded and " + playedSounds + " playback starts observed, with zero WebView errors");
  }
} finally {
  await browser.close();
}
