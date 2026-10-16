// Builds the starter pack in /starter: five recordings in the plugin's own .pulse format.
// They are generated, not recorded: each follows the rhythm of a typical Claude Code session
// (tool timings, thinking pauses, parallel calls, subagents, permission prompts, idle breaks).
// Run: node tools/make-starter.mjs   (the output is deterministic)
// Real sessions are welcome as pull requests: see starter/README.md.
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const OUT = fileURLToPath(new URL('../starter/', import.meta.url));
let seed = 1;
const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const R = (a, b) => a + rnd() * (b - a);
const L = (a, b) => Math.exp(R(Math.log(a), Math.log(b))); // log-uniform: most waits short, a few long
const I = (a, b) => Math.floor(R(a, b + 1));
const pick = a => a[Math.floor(rnd() * a.length)];
const chance = p => rnd() < p;

const DUR = {
  Read: [25, 260], Glob: [30, 320], Grep: [50, 650], LS: [20, 120], Edit: [60, 380], MultiEdit: [90, 520], Write: [90, 620],
  TodoWrite: [15, 70], WebSearch: [2200, 7500], WebFetch: [1400, 14000], quick: [90, 1600], test: [4000, 48000],
  build: [9000, 95000], install: [12000, 70000], mcp: [350, 3200],
};

class Rec {
  constructor(t) { this.t = t; this.lines = []; }
  ev(k, tool = '') { this.lines.push([Math.round(this.t), k, tool]); this.t += R(1, 6); }
  wait(ms) { this.t += ms; }
  think(a = 1200, b = 11000) { this.wait(L(a, b)); }
  call(tool, key = tool, ask = 0) {
    this.ev('T', tool);
    if (ask && chance(ask)) { this.wait(R(5, 40)); this.ev('N'); this.wait(L(1800, 26000)); }
    this.wait(L(...DUR[key])); this.ev('D', tool);
  }
  bash(kind = 'quick', ask = 0) { this.call('Bash', kind, ask); }
  /** Several calls from one message: they start together and finish in their own time. */
  parallel(list) {
    const start = this.t, ends = [];
    list.forEach(([tool, key = tool], i) => { this.t = start + i * R(2, 25); this.ev('T', tool); ends.push([this.t + L(...DUR[key]), tool]); });
    ends.sort((a, b) => a[0] - b[0]).forEach(([t, tool]) => { this.t = Math.max(this.t, t); this.ev('D', tool); });
  }
  /** Subagents run side by side, each with its own tool calls; each ends with A then the Agent tool finishing. */
  agents(plans) {
    const start = this.t, all = [];
    plans.forEach((plan, i) => {
      const sub = new Rec(start + i * R(3, 30));
      sub.ev('T', 'Agent'); sub.think(600, 3000);
      plan(sub);
      sub.think(1500, 9000); sub.ev('A'); sub.wait(R(10, 80)); sub.ev('D', 'Agent');
      all.push(...sub.lines);
    });
    all.sort((a, b) => a[0] - b[0]);
    this.lines.push(...all);
    this.t = all[all.length - 1][0] + R(5, 40);
  }
  turn(body, idle = [15000, 600000]) {
    this.ev('U'); this.think(1800, 9000);
    body(this);
    this.think(2500, 16000); this.ev('E');
    const gap = L(...idle);
    if (gap > 60000) { this.wait(60000); this.ev('N'); this.wait(gap - 60000); } else this.wait(gap);
  }
  compact() { this.ev('C'); this.wait(R(22000, 70000)); }
}

/* ---------- building blocks ---------- */
const explore = (r, n) => { for (let i = 0; i < n; i++) { r.think(900, 7000); chance(.35) ? r.parallel([['Grep'], ['Read'], ['Read']].slice(0, I(2, 3))) : r.call(pick(['Read', 'Read', 'Read', 'Grep', 'Glob'])); } };
const fixLoop = (r, rounds, ask = .15) => { for (let i = 0; i < rounds; i++) { r.think(); r.call('Read'); r.think(); r.call(pick(['Edit', 'Edit', 'MultiEdit']), undefined, ask); if (chance(.5)) { r.think(); r.call('Edit'); } r.think(); r.bash('test', ask / 2); } };
const research = (r, n) => { for (let i = 0; i < n; i++) { r.think(1500, 9000); chance(.4) ? r.parallel([['WebSearch'], ['WebSearch'], ['WebFetch']].slice(0, I(2, 3))) : r.call(pick(['WebSearch', 'WebFetch', 'WebFetch'])); } };
const writeUp = r => { r.think(9000, 45000); r.call('Write'); };
const todo = r => { r.think(800, 4000); r.call('TodoWrite'); };
const gitWrap = r => { r.think(); r.parallel([['Bash', 'quick'], ['Bash', 'quick']]); r.think(); r.bash('quick', .3); };
const subExplore = sub => { for (let i = I(6, 14); i > 0; i--) { sub.think(700, 5000); sub.call(pick(['Glob', 'Grep', 'Grep', 'Read', 'Read', 'Read'])); } };
const subResearch = sub => { for (let i = I(4, 8); i > 0; i--) { sub.think(900, 6000); sub.call(pick(['WebSearch', 'WebFetch', 'WebFetch'])); } };
const subBuild = sub => { explore(sub, I(2, 4)); fixLoop(sub, I(1, 3), 0); };
const mcp = (r, names) => names.forEach(n => { r.think(900, 6000); r.call(n, 'mcp'); });

/* ---------- the five sessions ---------- */
function session(project, startIso, s, turns) {
  seed = s;
  const r = new Rec(Date.parse(startIso));
  r.ev('S'); r.think(3000, 30000);
  turns.forEach(fn => fn(r));
  r.ev('Q');
  const date = startIso.slice(0, 16);
  return `${date} ${project}\n` + r.lines.map(([t, k, tool]) => tool ? `${t} ${k} ${tool}` : `${t} ${k}`).join('\n') + '\n';
}

const SESSIONS = [
  ['bug-hunt', 'Bug Hunt', 'A checkout bug: lots of reading, a failing test, fix after fix, then a regression test.', '2026-10-05T07:12:00Z', 7, [
    r => r.turn(r => { todo(r); explore(r, 14); r.think(); r.bash('quick'); explore(r, 8); r.think(); r.bash('test'); explore(r, 5); }, [40000, 180000]),
    r => r.turn(r => { fixLoop(r, 6, .3); explore(r, 3); fixLoop(r, 3); todo(r); }, [20000, 90000]),
    r => r.turn(r => { explore(r, 6); r.think(); r.bash('quick'); }, [30000, 200000]),
    r => r.turn(r => { r.think(); r.call('Glob'); explore(r, 3); writeUp(r); r.think(); r.bash('test'); fixLoop(r, 3); }, [30000, 120000]),
    r => r.turn(r => { gitWrap(r); r.think(); r.call('Edit'); r.think(); r.bash('quick'); }, [20000, 60000]),
    r => r.turn(() => {}, [5000, 20000]),
  ]],
  ['research-sprint', 'Research Sprint', 'Searching the web in bursts, three subagents reading side by side, then a write-up.', '2026-10-06T12:40:00Z', 21, [
    r => r.turn(r => { research(r, 14); writeUp(r); research(r, 5); }, [40000, 150000]),
    r => r.turn(r => { todo(r); r.agents([subResearch, subResearch, subResearch]); r.think(); r.call('Read'); writeUp(r); }, [60000, 200000]),
    r => r.turn(r => { research(r, 9); for (let i = 0; i < 6; i++) { r.think(); r.call('Edit'); } }, [30000, 100000]),
    r => r.turn(r => { r.agents([subResearch, subResearch]); research(r, 4); writeUp(r); }, [30000, 100000]),
    r => r.turn(r => { mcp(r, ['mcp__docs__create_document', 'mcp__docs__update_document', 'mcp__docs__update_document', 'mcp__docs__update_document']); }, [10000, 30000]),
  ]],
  ['refactor', 'Refactor', 'A big rename across the codebase: wide searches, many edits, type checks until green.', '2026-10-07T18:05:00Z', 33, [
    r => r.turn(r => { r.think(); r.parallel([['Grep'], ['Grep'], ['Glob']]); explore(r, 16); todo(r); }, [30000, 120000]),
    r => r.turn(r => { for (let i = 0; i < 22; i++) { r.think(800, 6000); r.call(pick(['MultiEdit', 'Edit', 'Edit'])); } r.think(); r.bash('build'); fixLoop(r, 4); }, [60000, 240000]),
    r => r.turn(r => { for (let i = 0; i < 18; i++) { r.think(800, 6000); r.call(pick(['MultiEdit', 'Edit'])); } r.think(); r.bash('build', .5); r.think(); r.call('Read'); r.think(); r.call('Edit'); r.think(); r.bash('build'); }, [40000, 160000]),
    r => r.turn(r => { r.think(); r.bash('test'); fixLoop(r, 7); todo(r); }, [30000, 140000]),
    r => r.turn(r => { explore(r, 6); for (let i = 0; i < 8; i++) { r.think(); r.call('Edit'); } r.think(); r.bash('test'); }, [20000, 80000]),
    r => r.turn(r => { gitWrap(r); }, [10000, 30000]),
  ]],
  ['agent-swarm', 'Agent Swarm', 'Four subagents explore at once, then two build while issues come in through a connector.', '2026-10-08T09:30:00Z', 45, [
    r => r.turn(r => { todo(r); r.agents([subExplore, subExplore, subExplore, subExplore]); r.think(); r.call('Read'); todo(r); }, [50000, 160000]),
    r => r.turn(r => { mcp(r, ['mcp__github__list_issues', 'mcp__github__get_issue', 'mcp__github__get_issue']); r.agents([subBuild, subBuild]); r.think(); r.bash('test'); }, [40000, 150000]),
    r => r.turn(r => { r.agents([subExplore, subExplore, subBuild]); fixLoop(r, 2); }, [30000, 120000]),
    r => r.turn(r => { fixLoop(r, 2); gitWrap(r); mcp(r, ['mcp__github__create_pull_request']); }, [10000, 40000]),
  ]],
];

SESSIONS.push(['quick-fix', 'Quick Fix', 'In and out: find the line, change it, run the tests, done.', '2026-10-08T15:02:00Z', 52, [
  r => r.turn(r => { r.think(); r.parallel([['Grep'], ['Glob']]); explore(r, 12); r.think(); r.call('Edit'); r.think(); r.bash('test'); fixLoop(r, 3); r.think(); r.bash('quick'); }, [8000, 20000]),
]]);

/* The hardcore edition: a whole night, about four and a half hours, two coffee breaks and two compactions. */
function allNighter() {
  const mixes = [
    r => { todo(r); explore(r, I(4, 10)); },
    r => fixLoop(r, I(2, 5), .2),
    r => { research(r, I(3, 6)); writeUp(r); },
    r => { explore(r, I(2, 4)); for (let i = I(3, 8); i > 0; i--) { r.think(); r.call(pick(['Edit', 'MultiEdit', 'Write'])); } r.think(); r.bash(pick(['test', 'build'])); },
    r => r.agents([subExplore, subExplore, subBuild].slice(0, I(2, 3))),
    r => { r.think(); r.bash('install', .5); r.think(); r.bash('build'); fixLoop(r, I(1, 3)); },
    r => mcp(r, ['mcp__db__run_sql', 'mcp__db__describe_table', 'mcp__db__run_sql', 'mcp__db__run_sql'].slice(0, I(2, 4))),
    r => gitWrap(r),
    () => {},
  ];
  const turns = [];
  for (let i = 0; i < 52; i++) {
    turns.push(r => {
      if (i === 18 || i === 38) r.compact();
      const idle = i === 13 || i === 31 ? [1100000, 1700000] : [20000, 480000]; // two coffee breaks
      r.turn(r => { pick(mixes)(r); if (chance(.4)) pick(mixes)(r); }, idle);
    });
  }
  return turns;
}
SESSIONS.push(['all-nighter', 'All-Nighter', 'The raw hardcore edition: a whole night of work in one recording.', '2026-10-09T21:47:00Z', 58, allNighter()]);

mkdirSync(OUT, { recursive: true });
const index = { about: 'Pulse starter pack. Each file is one recording in the .pulse format. See README.md.', recordings: [] };
for (const [file, title, about, start, s, turns] of SESSIONS) {
  const text = session(file, start, s, turns);
  writeFileSync(OUT + file + '.pulse', text);
  index.recordings.push({ id: 'starter-' + file, file: file + '.pulse', title, about });
  console.log(file.padEnd(16), (text.length / 1024).toFixed(1) + ' KB', text.split('\n').length - 2, 'events');
}
writeFileSync(OUT + 'index.json', JSON.stringify(index, null, 2) + '\n');
