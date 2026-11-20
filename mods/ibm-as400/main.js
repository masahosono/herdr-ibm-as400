// IBM AS/400: Herdr as a 5250 green screen. The whole layout is this one mod;
// props().view picks what each copy draws:
//   header   the screen title (program, title, system, space, date)
//   spaces   "Work with Spaces": spaces as a WRKxxx list with an Opt column
//   jobs     "Work with Active Jobs": agents as WRKACTJOB rows
//   tabs     the active space's tabs as a numbered menu line
//   pane     a pane's header (Job / Number / Dir, its status)
//   console  the ===> command line, function keys, message line and the OIA
//   opt      a popup window with a row's options (opened by the mod itself)
//   boot     the full-window title screen shown for 3s when Herdr starts

import { View, div } from "gpui-kit";
import { h_flex, v_flex, InputState, Input } from "gpui-base";
import {
  spaces, agents, panes, focused, props, run, exec, home, checking,
  openOverlay, closeOverlay, setAgentOrder,
} from "herdr";

const MOD = "ibm-as400";

// The 5250's colors.
const C = {
  bg: "#000000",
  green: "#33ff33",
  dim: "#1f9a1f",
  line: "#145214",
  white: "#ffffff",
  red: "#ff3b3b",
  yellow: "#ffff3c",
  blue: "#6e9bff",
  turq: "#3cffff",
  pink: "#ff5cff",
};
const ROW = 20;
const TEXT = 15;

// Agent status as a job status on WRKACTJOB.
const JOB = {
  working: ["RUN", C.white],
  blocked: ["MSGW", C.red],
  done: ["OUTQ", C.yellow],
  idle: ["DEQW", C.green],
};
const jobStatus = (status) => JOB[status] ?? ["DSPW", C.dim];

const txt = (s, color) => div().flex_none().whitespace_nowrap().text_color(color).child(String(s));
const cell = (s, w, color) => div().flex_none().w(w).overflow_hidden().whitespace_nowrap().text_color(color).child(String(s));
const fill = (s, color) => div().flex_1().min_w(0).truncate().text_color(color).child(String(s));
const blink = (el, on) => (on ? el.loop("opacity", { from: 0.15, to: 1, period: 1000 }) : el);

// "Space" -> "Space . . . . :"
function dots(label, n) {
  let s = label + " ";
  while (s.length < n) s += ". ";
  return s.slice(0, n) + ":";
}
// Object names are upper case, at most 10 characters, no blanks.
const objName = (s) => String(s ?? "").toUpperCase().replace(/\s+/g, "").slice(0, 10) || "*NONE";
const upper = (s) => String(s ?? "").toUpperCase();
function tilde(p) {
  if (!p) return "";
  const h = home();
  return h && p.startsWith(h) ? "~" + p.slice(h.length) : p;
}
const pad2 = (n) => String(n).padStart(2, "0");
const pad3 = (n) => String(n).padStart(3, "0");

function tabLabel(t) {
  if (t.named) return t.name;
  const p = panes().find((x) => x.tab === t.id && x.focused) ?? panes().find((x) => x.tab === t.id);
  if (!p) return t.name;
  if (p.mod) return p.mod;
  return p.program?.name ?? t.name;
}

// A row's options, as on a WRKxxx screen: "1=Select", "4=End", ...
function options(kind, id, extra) {
  if (kind === "space") return [
    ["1", "Select", () => run("space.select", { id })],
    ["2", "Rename", () => run("space.rename", { id })],
    ["4", "End", () => run("space.close", { id })],
    ["7", "New tab", () => run("tab.new", { space: id })],
  ];
  if (kind === "tab") return [
    ["1", "Select", () => run("tab.select", { id })],
    ["2", "Rename", () => run("tab.rename", { id })],
    ["4", "End", () => run("tab.close", { id })],
  ];
  return [
    ["5", "Work with", () => run("agent.focus", { terminal: id })],
    ["8", "Peek", () => run("terminal.peek", { terminal: id })],
    ["4", "End", () => run("terminal.kill", { terminal: id })],
  ];
}
function openOpt(kind, id, name) {
  const n = options(kind, id).length;
  openOverlay({
    mod: MOD, kind: "popup", frame: "none",
    width: 300, height: ROW * (n + 5) + 18,
    props: { view: "opt", kind, id, name },
  });
}

// ---- the title screen (view "boot")

const BOOT_MS = 3000;

// "AS/400" in block letters, each drawn with its own character, slanted.
const GLYPHS = {
  A: ["  #####  ", " ##   ## ", "##     ##", "##     ##", "#########", "##     ##", "##     ##"],
  S: [" ####### ", "##     ##", "##       ", " ####### ", "       ##", "##     ##", " ####### "],
  "/": ["      ##", "     ## ", "    ##  ", "   ##   ", "  ##    ", " ##     ", "##      "],
  4: ["     ### ", "    #### ", "   ## ## ", "  ##  ## ", " ########", "      ## ", "      ## "],
  0: [" ####### ", "##     ##", "##     ##", "##     ##", "##     ##", "##     ##", " ####### "],
};
const INK = { A: "A", S: "$", "/": "/", 4: "4", 0: "0" };
const LOGO = GLYPHS.A.map((_, r) =>
  " ".repeat(GLYPHS.A.length - 1 - r) +
  [..."AS/400"].map((ch) => GLYPHS[ch][r].replace(/#/g, INK[ch])).join("  "));

// The falling characters under the logo: one drop per column.
const RAIN_COLS = 260;
const RAIN_ROWS = 70;
const RAIN_CHARS = "0123456789ABCDEF$#@%&*+=<>/\\:;";
const rainChar = () => RAIN_CHARS[Math.floor(Math.random() * RAIN_CHARS.length)];
const newDrop = (top) => ({
  y: top ? Math.random() * RAIN_ROWS : -Math.random() * RAIN_ROWS * 0.25,
  speed: 0.35 + Math.random() * 0.9,
  len: 12 + Math.floor(Math.random() * 40),
});

function openBoot() {
  openOverlay({ mod: MOD, kind: "dialog", frame: "none", modal: true, width: 1, height: 1, props: { view: "boot" } });
}

// Seconds since Herdr started (its process is the mod's parent), or null.
async function appAge() {
  try {
    const r = await exec("sh", ["-c", 'ps -o etime= -p "$PPID"']);
    const m = r.stdout.trim().match(/^(?:(\d+)-)?(?:(\d+):)?(\d+):(\d+)$/);
    if (!m) return null;
    const [, d, h, mi, s] = m.map((x) => Number(x) || 0);
    return ((d * 24 + h) * 60 + mi) * 60 + s;
  } catch {
    return null;
  }
}

// The function keys. F24 shows the other set.
const KEYS = [
  [
    ["F3", "Exit", (c) => run("layout.switch", {})],
    ["F4", "Prompt", (c) => run("app.palette", {})],
    ["F6", "Create", (c) => run("space.new", {})],
    ["F9", "Retrieve", (c) => c.retrieve()],
    ["F10", "Split", (c) => run("pane.split", { direction: "right" })],
    ["F11", "Zoom", (c) => run("pane.zoom", {})],
    ["F12", "Cancel", (c) => c.cancel()],
    ["F24", "More keys", (c) => c.moreKeys()],
  ],
  [
    ["F7", "Prev tab", (c) => run("tab.prev", {})],
    ["F8", "Next tab", (c) => run("tab.next", {})],
    ["F13", "New tab", (c) => run("tab.new", {})],
    ["F14", "Split down", (c) => run("pane.split", { direction: "down" })],
    ["F16", "End pane", (c) => run("pane.close", {})],
    ["F17", "Settings", (c) => run("app.settings", {})],
    ["F18", "Help", (c) => run("app.help", {})],
    ["F24", "More keys", (c) => c.moreKeys()],
  ],
];

export default class As400 extends View {
  init(p, cx) {
    this.view = (props() ?? p ?? {}).view ?? "spaces";
    const init = this[`init_${this.view}`];
    if (init) init.call(this, cx);
  }

  render(cx) {
    const draw = this[`draw_${this.view}`];
    if (!draw) return div().text_color(C.red).child(`${MOD}: no view "${this.view}"`);
    return draw.call(this, cx);
  }

  // ---------------------------------------------------------------- header

  init_header(cx) {
    this.system = "HERDR";
    this.now = new Date();
    cx.timer.every(10000, (cx) => { this.now = new Date(); cx.notify(); });
    if (checking()) return;
    // Herdr just started with this layout on: the title screen.
    cx.spawn(async () => {
      const age = await appAge();
      if (age !== null && age < 45) openBoot();
    });
    cx.spawn(async (cx) => {
      try {
        const r = await exec("hostname", ["-s"]);
        const h = r.stdout.trim();
        if (h) this.system = objName(h).slice(0, 8);
        cx.notify();
      } catch { /* keep HERDR */ }
    });
  }

  draw_header() {
    const sp = spaces().find((s) => s.active);
    const tab = sp?.tabs.find((t) => t.active);
    const d = this.now;
    const date = `${pad2(d.getMonth() + 1)}/${pad2(d.getDate())}/${pad2(d.getFullYear() % 100)}`;
    const time = `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
    const line = () => h_flex().h(ROW).w_full().items_center();
    return v_flex().id("hdr").size_full().bg(C.bg).pl(84).pr(14).pt(4).text_size(TEXT)
      .child(line()
        .child(cell("MAIN", 150, C.green))
        .child(div().flex_1().flex().justify_center().child(txt("Herdr/400 Main Menu", C.white)))
        .child(h_flex().w(150).justify_end().child(txt("System:  ", C.green)).child(txt(this.system, C.white))))
      .child(line()
        .child(cell(dots("Space", 10), 96, C.green))
        .child(fill(sp ? upper(sp.name) : "*NONE", C.white))
        .child(cell(dots("Tab", 8), 80, C.green))
        .child(cell(tab ? `${tab.index} of ${sp.tabs.length}` : "", 80, C.white))
        .child(cell(dots("Branch", 10), 96, C.green))
        .child(cell(sp?.branch ?? "*NONE", 160, C.white))
        .child(h_flex().w(150).justify_end().child(txt(`${date}  ${time}`, C.green))));
  }

  // ---------------------------------------------------------------- spaces

  draw_spaces() {
    const list = spaces();
    const head = (s) => h_flex().h(ROW).px(8).items_center().child(txt(s, C.white));
    return v_flex().id("wrkspc").size_full().bg(C.bg).pt(6).text_size(TEXT)
      .child(h_flex().h(ROW).justify_center().items_center().child(txt("Work with Spaces", C.white)))
      .child(h_flex().h(ROW).px(8).items_center().child(txt("Click Opt for options.", C.blue)))
      .child(h_flex().h(ROW).px(8).items_center().child(txt("  1=Select  2=Rename  4=End  7=New tab", C.blue)))
      .child(div().h(6))
      .child(head("").child(cell("Opt", 36, C.white)).child(fill("Space", C.white)).child(cell("Tabs", 44, C.white)).child(cell("Status", 52, C.white)))
      .child(v_flex().id("wrkspc-rows").flex_1().min_h(0).overflow_y_scrollbar()
        .children(list.map((s) => this.spaceRow(s)))
        .child(h_flex().h(ROW).px(10).justify_end().items_center()
          .child(txt(list.length ? "Bottom" : "(No spaces)", C.white))));
  }

  spaceRow(s) {
    const [st, color] = s.status ? jobStatus(s.status) : ["", C.dim];
    const on = s.active;
    const fg = (c) => (on ? C.bg : c);
    return h_flex().id(`sp-${s.id}`).h(ROW).mx(4).px(4).items_center().cursor_pointer()
      .when(on, (el) => el.bg(C.green))
      .when(!on, (el) => el.hover((h) => h.bg(C.line)))
      .on_click(() => run("space.select", { id: s.id }))
      .on_mouse_down("right", () => openOpt("space", s.id, s.name))
      .child(div().flex_none().w(36).child(
        div().id(`spo-${s.id}`).w(12).text_color(fg(C.green)).child("_")
          .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
          .on_click((_e, cx) => { cx.stop_propagation(); openOpt("space", s.id, s.name); })))
      .child(fill(upper(s.name), fg(on ? C.bg : C.green)))
      .child(cell(String(s.tabs.length).padStart(3), 44, fg(C.green)))
      .child(blink(cell(st, 52, fg(color)), s.status === "blocked" && !on));
  }

  // ---------------------------------------------------------------- jobs

  draw_jobs() {
    const list = agents();
    setAgentOrder(list.map((a) => a.address));
    const n = (st) => list.filter((a) => a.status === st).length;
    return v_flex().id("wrkactjob").size_full().bg(C.bg).pt(6).text_size(TEXT)
      .child(h_flex().h(ROW).justify_center().items_center().child(txt("Work with Active Jobs", C.white)))
      .child(h_flex().h(ROW).px(8).items_center()
        .child(txt(dots("Active jobs", 14) + " ", C.green)).child(txt(String(list.length), C.white))
        .child(txt("   MSGW: ", C.green)).child(txt(String(n("blocked")), n("blocked") ? C.red : C.white)))
      .child(h_flex().h(ROW).px(8).items_center().child(txt("  4=End  5=Work with  8=Peek", C.blue)))
      .child(div().h(6))
      .child(h_flex().h(ROW).px(8).items_center()
        .child(cell("Opt", 36, C.white)).child(cell("Job", 96, C.white)).child(fill("Space", C.white)).child(cell("Status", 52, C.white)))
      .child(v_flex().id("wrkactjob-rows").flex_1().min_h(0).overflow_y_scrollbar()
        .children(list.map((a) => this.jobRow(a)))
        .child(h_flex().h(ROW).px(10).justify_end().items_center()
          .child(txt(list.length ? "Bottom" : "(No active jobs)", C.white))));
  }

  jobRow(a) {
    const [st, color] = jobStatus(a.status);
    const on = a.focused;
    const fg = (c) => (on ? C.bg : c);
    return h_flex().id(`job-${a.address}`).h(ROW).mx(4).px(4).items_center().cursor_pointer()
      .when(on, (el) => el.bg(C.green))
      .when(!on, (el) => el.hover((h) => h.bg(C.line)))
      .on_click(() => run("agent.focus", { terminal: a.address }))
      .on_mouse_down("right", () => openOpt("job", a.address, a.program?.name ?? a.app))
      .child(div().flex_none().w(36).child(
        div().id(`jbo-${a.address}`).w(12).text_color(fg(C.green)).child("_")
          .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
          .on_click((_e, cx) => { cx.stop_propagation(); openOpt("job", a.address, a.program?.name ?? a.app); })))
      .child(cell(objName(a.program?.name ?? a.app), 96, fg(C.green)))
      .child(fill(upper(a.space_name), fg(C.green)))
      .child(blink(cell(st, 52, fg(color)), a.status === "blocked" && !on));
  }

  // ---------------------------------------------------------------- tabs

  draw_tabs() {
    const sp = spaces().find((s) => s.active);
    const tabs = sp?.tabs ?? [];
    const stop = (_e, cx) => cx.stop_propagation();
    return h_flex().id("tabbar").size_full().bg(C.bg).px(10).gap(6).items_center().text_size(TEXT)
      .border_b_1().border_color(C.line)
      .child(txt(dots("Tabs", 7) + " ", C.green))
      .children(tabs.map((t) => {
        const [st, color] = t.status ? jobStatus(t.status) : ["", C.dim];
        const on = t.active;
        return h_flex().id(`tab-${t.id}`).h(ROW).px(6).gap(6).items_center().cursor_pointer()
          .when(on, (el) => el.bg(C.green))
          .when(!on, (el) => el.hover((h) => h.bg(C.line)))
          .on_mouse_down("left", stop)
          .on_click(() => run("tab.select", { id: t.id }))
          .on_mouse_down("right", () => openOpt("tab", t.id, tabLabel(t)))
          .child(txt(`${t.index}.`, on ? C.bg : C.white))
          .child(div().max_w(180).truncate().text_color(on ? C.bg : C.green).child(upper(tabLabel(t))))
          .when(Boolean(st), (el) => el.child(blink(txt(st, on ? C.bg : color), t.status === "blocked" && !on)));
      }))
      .child(h_flex().id("tab-new").h(ROW).px(6).items_center().cursor_pointer()
        .hover((h) => h.bg(C.line))
        .on_mouse_down("left", stop)
        .on_click(() => run("tab.new", { space: sp?.id }))
        .child(txt("F13=New tab", C.blue)));
  }

  // ---------------------------------------------------------------- pane header

  draw_pane() {
    const id = props()?.pane;
    const p = panes().find((x) => x.pane === id);
    if (!p) return div().size_full().bg(C.bg);
    const on = p.focused;
    const fg = (c) => (on ? C.bg : c);
    const name = p.mod ? p.mod : (p.program?.name ?? "shell");
    const [st, color] = p.status ? jobStatus(p.status) : jobStatus(null);
    const btn = (key, label, act) => h_flex().id(`${key}-${id}`).px(4).cursor_pointer()
      .hover((h) => h.bg(on ? C.dim : C.line))
      .on_click((_e, cx) => { cx.stop_propagation(); act(); })
      .child(txt(`${key}=${label}`, on ? C.bg : C.blue));
    return h_flex().id(`pane-${id}`).size_full().px(8).gap(14).items_center().text_size(TEXT)
      .bg(on ? C.green : C.bg).cursor_pointer()
      .on_click((e) => (e.click_count >= 2 ? run("pane.zoom", { pane: id }) : run("pane.focus", { pane: id })))
      .child(h_flex().flex_none().child(txt(dots("Job", 6) + " ", fg(C.green))).child(txt(objName(name), fg(C.white))))
      .child(h_flex().flex_none().child(txt(dots("Number", 8) + " ", fg(C.green))).child(txt(p.terminal ?? p.pane, fg(C.white))))
      .child(h_flex().flex_1().min_w(0).child(txt(dots("Dir", 5) + " ", fg(C.green))).child(fill(tilde(p.cwd), fg(C.white))))
      .child(blink(txt(st, fg(color)), p.status === "blocked" && !on))
      .child(btn("F11", p.zoomed ? "Restore" : "Zoom", () => run("pane.zoom", { pane: id })))
      .child(btn("F16", "End", () => run("pane.close", { pane: id })));
  }

  // ---------------------------------------------------------------- console

  init_console(cx) {
    this.keySet = 0;
    this.history = [];
    this.back = 0;
    this.msg = null;
    this.input = InputState.new({ placeholder: "" });
    this.input.on("submit", (_e, cx) => { this.submit(this.input.value()); cx.notify(); });
    this.handle = cx.focus_handle();
  }

  say(text, err = false) { this.msg = { text, err }; }
  retrieve() {
    if (!this.history.length) return this.say("No command to retrieve.");
    this.back = (this.back % this.history.length) + 1;
    this.input.set_value(this.history[this.history.length - this.back]);
    this.input.focus();
  }
  cancel() { this.input.set_value(""); this.msg = null; this.back = 0; }
  moreKeys() { this.keySet = (this.keySet + 1) % KEYS.length; }

  submit(line) {
    const s = String(line ?? "").trim();
    if (!s) return;
    this.history.push(s);
    this.back = 0;
    this.input.set_value("");
    this.msg = null;
    const [verb, ...rest] = s.split(/\s+/);
    const V = verb.toUpperCase();
    // PGM(claude) or PGM('claude --resume') as in CALL PGM(...)
    const pgm = /PGM\(\s*'?([^')]+)'?\s*\)/i.exec(s);
    const argv = pgm ? pgm[1].trim().split(/\s+/) : rest;
    const arg = rest.join(" ");
    const pick = (n) => {
      const sp = spaces()[n - 1];
      if (!sp) return this.say(`CPD0084 Space ${n} not found.`, true);
      run("space.select", { id: sp.id });
    };
    if (/^\d+$/.test(V)) return pick(Number(V));
    switch (V) {
      case "GO": return /^\d+$/.test(arg) ? pick(Number(arg)) : this.say("GO needs a space number: GO 2", true);
      case "CRTSPC": run("space.new", arg ? { name: arg } : {}); return this.say(`Space ${upper(arg || "*GEN")} created.`);
      case "ENDSPC": return run("space.close", {});
      case "RNMSPC": return run("space.rename", arg ? { name: arg } : {});
      case "CRTTAB": run("tab.new", arg ? { name: arg } : {}); return this.say("Tab created.");
      case "ENDTAB": return run("tab.close", {});
      case "RNMTAB": return run("tab.rename", arg ? { name: arg } : {});
      case "CALL":
      case "STRAGT":
        if (!argv.length) return this.say(`${V} needs a program: ${V} claude`, true);
        run("tab.new", { argv });
        return this.say(`Program ${objName(argv[0])} called.`);
      case "SBMJOB":
        if (!argv.length) return this.say("SBMJOB needs a program: SBMJOB claude", true);
        run("tab.new", { argv, focus: false });
        return this.say(`Job ${objName(argv[0])} submitted to job queue QBATCH in library QGPL.`);
      case "SPLIT":
        return run("pane.split", { direction: /^down$/i.test(arg) ? "down" : "right" });
      case "WRKCFG":
      case "CFGHERDR": return run("app.settings", {});
      case "HELP": return run("app.help", {});
      case "SIGNOFF": return run("layout.switch", {});
      case "DSPLOGO": return openBoot();
      default:
        return this.say(`CPD0030 Command ${V} in library *LIBL not found.`, true);
    }
  }

  fkey(e, cx) {
    const k = String(e.key ?? "").toLowerCase();
    if (!/^f\d+$/.test(k)) return;
    const hit = KEYS.flat().find(([f]) => f.toLowerCase() === k);
    if (!hit) return;
    hit[2](this);
    cx.stop_propagation();
    cx.notify();
  }

  draw_console() {
    const all = agents();
    const blocked = all.filter((a) => a.status === "blocked").length;
    const working = all.filter((a) => a.status === "working").length;
    const sp = spaces().find((s) => s.active);
    const tab = sp?.tabs.find((t) => t.active);
    const keys = KEYS[this.keySet];
    const line = () => h_flex().h(ROW).w_full().px(14).items_center();
    const key = ([f, label, act]) => h_flex().id(`key-${f}`).px(2).cursor_pointer()
      .hover((h) => h.bg(C.line))
      .on_click((_e, cx) => { act(this); cx.notify(); })
      .child(txt(`${f}=${label}`, C.blue));
    const ind = (s, on, color = C.green) => div().flex_none().w(s.length * 8 + 16).whitespace_nowrap()
      .text_color(on ? color : C.bg).child(s);
    return v_flex().id("console").size_full().bg(C.bg).text_size(TEXT)
      .track_focus(this.handle).on_key_down((e, cx) => this.fkey(e, cx))
      .child(line().pt(2).border_t_1().border_color(C.line)
        .child(txt("===> ", C.green))
        .child(Input.new(this.input).flex_1().h(ROW).px(2).bg(C.bg).text_size(TEXT).text_color(C.white)
          .border_b_1().border_color(C.green)))
      .child(line().gap(14).children(keys.map(key)))
      .child(line().child(this.msg ? fill(this.msg.text, this.msg.err ? C.red : C.white) : div()))
      .child(h_flex().h(ROW).w_full().px(14).items_center().border_t_1().border_color(C.dim)
        .child(div().flex_none().px(3).bg(C.green).text_color(C.bg).child("MA"))
        .child(div().w(12))
        .child(ind("a", true))
        .child(blink(ind("MW", blocked > 0, C.red), blocked > 0))
        .child(ind("X SYSTEM", working > 0, C.white))
        .child(div().flex_1())
        .child(txt(`RUN ${working}  MSGW ${blocked}`, C.dim))
        .child(div().w(28))
        .child(txt(`${pad2(sp?.index ?? 0)}/${pad3(tab?.index ?? 0)}`, C.green)));
  }

  // ---------------------------------------------------------------- boot

  init_boot(cx) {
    this.handle = cx.focus_handle();
    this.handle.focus();
    this.grid = Array.from({ length: RAIN_ROWS }, () => Array.from({ length: RAIN_COLS }, rainChar));
    this.drops = Array.from({ length: RAIN_COLS }, () => newDrop(true));
    this.rain = this.rainLayers();
    cx.timer.every(70, (cx) => { this.stepRain(); cx.notify(); });
    cx.timer.after(BOOT_MS, () => this.closeBoot());
  }

  closeBoot() {
    if (this.closed) return;
    this.closed = true;
    closeOverlay(props()?.overlay);
  }

  stepRain() {
    for (let i = 0; i < 60; i++) {
      this.grid[Math.floor(Math.random() * RAIN_ROWS)][Math.floor(Math.random() * RAIN_COLS)] = rainChar();
    }
    this.drops.forEach((d, c) => {
      d.y += d.speed;
      if (d.y - d.len > RAIN_ROWS) this.drops[c] = newDrop(false);
      const h = Math.floor(this.drops[c].y);
      if (h >= 0 && h < RAIN_ROWS) this.grid[h][c] = rainChar();
    });
    this.rain = this.rainLayers();
  }

  // Three layers of text, one per brightness: the heads white, the tails
  // green fading to dim. Blanks elsewhere so the monospace layers line up.
  rainLayers() {
    const layers = [[], [], []];
    for (let r = 0; r < RAIN_ROWS; r++) {
      const rows = ["", "", ""];
      for (let c = 0; c < RAIN_COLS; c++) {
        const d = this.drops[c].y - r;
        const k = d < 0 || d >= this.drops[c].len ? -1 : d < 1 ? 0 : d < this.drops[c].len * 0.45 ? 1 : 2;
        for (let l = 0; l < 3; l++) rows[l] += l === k ? this.grid[r][c] : " ";
      }
      for (let l = 0; l < 3; l++) layers[l].push(rows[l]);
    }
    return layers;
  }

  draw_boot() {
    const title = (s) => div().whitespace_nowrap().child(s);
    const layer = (rows, color) => v_flex().absolute().top(0).left(0)
      .text_color(color).text_size(14).line_height("16px")
      .children(rows.map((s) => div().whitespace_nowrap().child(s)));
    return v_flex().id("boot").size_full().bg(C.bg).items_center().overflow_hidden()
      .track_focus(this.handle).on_key_down((_e, cx) => { cx.stop_propagation(); this.closeBoot(); })
      .on_click(() => this.closeBoot())
      .child(v_flex().pt(48).items_center().text_color(C.green).text_size(42).line_height("50px")
        .child(title("HERDR GUIDE TO"))
        .child(title("WORK WITH AGENTS"))
        .child(title("IN THE")))
      .child(div().mt(18).h(8).w("78%").rounded(4).bg(C.green))
      .child(v_flex().mt(28).text_color(C.green).text_size(18).line_height("20px")
        .children(LOGO.map((s) => div().whitespace_nowrap().child(s))))
      .child(div().relative().mt(28).w("88%").flex_1().min_h(0).overflow_hidden()
        .child(layer(this.rain[2], C.dim))
        .child(layer(this.rain[1], C.green))
        .child(layer(this.rain[0], C.white)))
      .child(h_flex().w("88%").h(64).items_center().text_size(TEXT)
        .child(blink(txt("Starting system . . .", C.white), true))
        .child(div().flex_1())
        .child(v_flex().items_end()
          .child(txt("HERDR/400", C.green).text_size(22))
          .child(txt("VERSION 1 RELEASE 1", C.white))));
  }

  // ---------------------------------------------------------------- opt popup

  init_opt(cx) {
    this.handle = cx.focus_handle();
    this.handle.focus();
    cx.timer.after(100, () => this.handle.focus());
  }

  draw_opt() {
    const p = props() ?? {};
    const list = options(p.kind, p.id);
    const close = () => closeOverlay(p.overlay);
    const pickKey = (e, cx) => {
      const k = String(e.key ?? "");
      const hit = list.find(([n]) => n === k);
      if (hit) { close(); hit[2](); cx.stop_propagation(); }
      else if (k.toLowerCase() === "f12" || k === "escape") { close(); cx.stop_propagation(); }
    };
    const title = p.kind === "space" ? "Work with Space" : p.kind === "tab" ? "Work with Tab" : "Work with Job";
    return v_flex().id("opt").track_focus(this.handle).on_key_down(pickKey)
      .size_full().bg(C.bg).border_2().border_color(C.blue).p(8).text_size(TEXT)
      .child(h_flex().h(ROW).justify_center().items_center().child(txt(title, C.white)))
      .child(h_flex().h(ROW).items_center()
        .child(txt(dots(p.kind === "job" ? "Job" : p.kind === "tab" ? "Tab" : "Space", 8) + " ", C.green))
        .child(fill(upper(p.name), C.white)))
      .child(h_flex().h(ROW).items_center().child(txt("Type option or click:", C.blue)))
      .children(list.map(([n, label, act]) => h_flex().id(`o-${n}`).h(ROW).px(10).items_center().cursor_pointer()
        .hover((h) => h.bg(C.green).text_color(C.bg))
        .text_color(C.green)
        .on_click(() => { close(); act(); })
        .child(div().whitespace_nowrap().child(`${n}=${label}`))))
      .child(h_flex().id("o-cancel").h(ROW).mt(4).items_center().cursor_pointer()
        .on_click(close)
        .child(txt("F12=Cancel", C.blue)));
  }
}
