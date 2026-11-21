// Completed-turn folding (App.foldTurn): a completed turn's process — tool
// calls, thinking, context notes — folds behind one summary row under the
// prompt, as the Web UI's detailed view does, and expands again on toggle.
import { App } from "../lib/ui.js"
import { setLocale } from "../lib/i18n.js"

setLocale("en")
let failed = 0
const ok = (name, cond, extra = "") => {
  if (cond) console.log("ok   " + name)
  else { failed++; console.log("FAIL " + name + (extra ? "  " + extra : "")) }
}

const COLS = 110, ROWS = 60
function screenText(app) {
  const screen = app.render()
  return screen.cells.map((row) => row.map((cell) => cell.ch).join("")).join("\n")
}

// One completed turn: two thinking steps, two tool calls, a context note, an
// intermediate reply and the final answer.
function turn(app, { start = 1_000 } = {}) {
  app.addUser("Can check this project", { time: start })
  app.addNote("workspace instructions", "system-reminder")
  const first = app.ensureAssistantBlock(start + 100)
  first.text = "I'll start by getting oriented."
  first.reasoning = "The user wants a check of the project directory."
  first.thinkingCollapsed = true
  first.rev++
  app.startTool({ callId: "c1", name: "run_code", args: { code: "ls -la" } })
  app.updateTool("c1", { status: "ok", result: "total 0" })
  const second = app.ensureAssistantBlock(start + 200)
  second.reasoning = "Directory is empty; check siblings."
  second.thinkingCollapsed = true
  second.rev++
  app.startTool({ callId: "c2", name: "run_code", args: { code: "ls .." } })
  app.updateTool("c2", { status: "ok", result: "jira ocr-model" })
  app.setAssistantText("Result: there is no project here to check.", start + 9_300)
}

{
  const app = new App({ cols: COLS, rows: ROWS, on() {} })
  app.setSession({ id: "s", title: "Session" })
  turn(app)
  const before = screenText(app)
  ok("before folding the process is on screen", before.includes("run_code") && before.includes("system-reminder") && before.includes("thinking ·"))

  const summary = app.foldTurn({ endTime: 10_300, steps: 4 })
  ok("a completed turn gets a summary block", summary?.kind === "process" && summary.tools === 2 && summary.steps === 4)
  ok("the summary sits right under the prompt", app.blocks[app.blocks.indexOf(summary) - 1].kind === "user")
  const folded = screenText(app)
  ok("the summary reads duration, steps and tool calls", /Worked for 9\.3s · 4 steps · 2 tool calls/.test(folded), folded.split("\n").find((l) => l.includes("Worked")) ?? "")
  ok("tool calls are folded away", !folded.includes("run_code"))
  ok("context notes are folded away", !folded.includes("system-reminder"))
  ok("thinking rows are folded away", !folded.includes("thinking ·"))
  ok("the final answer stays visible", folded.includes("Result: there is no project here to check."))
  ok("intermediate replies stay visible by default (like the Web UI)", folded.includes("I'll start by getting oriented."))
  ok("folding twice is a no-op", app.foldTurn({ endTime: 10_300 }) === null)

  app.toggleProcess(summary)
  const expanded = screenText(app)
  ok("expanding restores the process", expanded.includes("run_code") && expanded.includes("system-reminder") && expanded.includes("thinking ·"))
  ok("the expanded summary offers to collapse", /Worked for .*click to collapse/.test(expanded))
  app.toggleProcess(summary)
  ok("collapsing hides it again", !screenText(app).includes("run_code"))
}

{
  const app = new App({ cols: COLS, rows: ROWS, on() {} })
  app.setSession({ id: "s", title: "Session" })
  turn(app)
  app.foldTurn({ endTime: 10_300, steps: 4, replies: "final" })
  const text = screenText(app)
  ok("replies: final folds the intermediate reply", !text.includes("I'll start by getting oriented."))
  ok("replies: final keeps the final answer", text.includes("Result: there is no project here to check."))
}

{
  const app = new App({ cols: COLS, rows: ROWS, on() {} })
  app.setSession({ id: "s", title: "Session" })
  app.addUser("hi", { time: 0 })
  app.setAssistantText("Hello!", 500)
  ok("a turn with no process gets no summary", app.foldTurn({ endTime: 600 }) === null)
  ok("...and its answer is untouched", screenText(app).includes("Hello!"))
}

{
  // A steering message inside a turn is not where the turn starts.
  const app = new App({ cols: COLS, rows: ROWS, on() {} })
  app.setSession({ id: "s", title: "Session" })
  app.addUser("first prompt", { time: 0 })
  app.startTool({ callId: "c1", name: "read", args: { path: "a.txt" } })
  app.updateTool("c1", { status: "ok", result: "a" })
  app.addUser("also check b", { steering: true, time: 100 })
  app.startTool({ callId: "c2", name: "read", args: { path: "b.txt" } })
  app.updateTool("c2", { status: "ok", result: "b" })
  app.setAssistantText("Both read.", 900)
  const summary = app.foldTurn({ endTime: 1_000, steps: 2 })
  ok("a steered turn folds from its first prompt", app.blocks.indexOf(summary) === 1 && summary.tools === 2)
}

{
  // Two turns: each folds its own process only.
  const app = new App({ cols: COLS, rows: ROWS, on() {} })
  app.setSession({ id: "s", title: "Session" })
  turn(app, { start: 0 })
  const one = app.foldTurn({ endTime: 9_400, steps: 4 })
  app.markTurnEnd()
  turn(app, { start: 20_000 })
  const two = app.foldTurn({ endTime: 29_400, steps: 4 })
  ok("each turn gets its own summary", one && two && one !== two && app.blocks.filter((b) => b.kind === "process").length === 2)
  app.toggleProcess(two)
  const text = screenText(app)
  ok("expanding the second turn leaves the first folded", app.blocks.filter((b) => b.fold === one).every((b) => b.fold.expanded !== true))
}

{
  // Replay: a prompt delivered through the inbox is labelled steering even
  // when it opened the turn; the turn boundary still finds it.
  const app = new App({ cols: COLS, rows: ROWS, on() {} })
  app.setSession({ id: "s", title: "Session" })
  app.addUser("Can check this project", { steering: true, time: 0 })
  app.startTool({ callId: "c1", name: "run_code", args: { code: "ls" } })
  app.updateTool("c1", { status: "ok", result: "" })
  app.setAssistantText("Empty directory.", 4_000)
  const summary = app.foldTurn({ endTime: 4_100, steps: 2 })
  ok("a turn opened by an inbox-delivered prompt still folds", summary?.kind === "process" && app.blocks.indexOf(summary) === 1)
  app.markTurnEnd()
  app.addUser("and now?", { time: 10_000 })
  app.setAssistantText("Nothing else.", 10_500)
  ok("the next turn without process does not fold", app.foldTurn({ endTime: 10_600 }) === null)
  app.markTurnEnd()
  ok("the earlier fold is unaffected", !screenText(app).includes("run_code") && screenText(app).includes("Empty directory."))
}

if (failed > 0) process.exit(1)
console.log("fold tests passed")
