// Builds assets/commit-langs.svg from the lines actually committed in the
// last N days, across every owned repo (private included).

const TOKEN = process.env.GH_TOKEN;
const LOGIN = process.env.LOGIN;
const DAYS = Number(process.env.DAYS || 30);

if (!TOKEN || !LOGIN) {
  console.error("GH_TOKEN and LOGIN are required");
  process.exit(1);
}

const SINCE = new Date(Date.now() - DAYS * 864e5).toISOString();

const HEADERS = {
  Authorization: `bearer ${TOKEN}`,
  Accept: "application/vnd.github+json",
  "User-Agent": "commit-langs",
};

// file extension -> language
const EXT = {
  php: "PHP", blade: "Blade",
  js: "JavaScript", mjs: "JavaScript", cjs: "JavaScript", jsx: "JavaScript",
  ts: "TypeScript", tsx: "TypeScript",
  py: "Python", ipynb: "Jupyter",
  java: "Java", kt: "Kotlin", dart: "Dart", go: "Go", rs: "Rust", rb: "Ruby",
  c: "C", h: "C", cpp: "C++", cc: "C++", hpp: "C++", cs: "C#",
  html: "HTML", htm: "HTML", vue: "Vue", svelte: "Svelte",
  css: "CSS", scss: "SCSS", sass: "SCSS", less: "Less",
  sql: "SQL", sh: "Shell", bash: "Shell", ps1: "PowerShell",
  json: "JSON", yml: "YAML", yaml: "YAML", toml: "TOML", xml: "XML",
  md: "Markdown", txt: "Text", env: "Config", ino: "Arduino", sol: "Solidity",
};

// noise that would otherwise dominate the chart
const SKIP = [
  /(^|\/)vendor\//i, /(^|\/)node_modules\//i, /(^|\/)dist\//i, /(^|\/)build\//i,
  /(^|\/)public\/(build|hot)\//i, /\.min\.(js|css)$/i, /-lock\.(json|yaml)$/i,
  /(^|\/)composer\.lock$/i, /(^|\/)yarn\.lock$/i, /(^|\/)\.git/i,
  /(^|\/)profile-3d-contrib\//i, /(^|\/)assets\/stats\.svg$/i,
];

async function api(path) {
  const res = await fetch(`https://api.github.com${path}`, { headers: HEADERS });
  if (res.status === 404 || res.status === 409) return null; // empty repo
  if (!res.ok) throw new Error(`GET ${path} -> ${res.status}: ${await res.text()}`);
  return res.json();
}

async function graphql(query, variables) {
  const res = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: { ...HEADERS, "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json();
  if (json.errors) throw new Error(JSON.stringify(json.errors));
  return json.data;
}

async function listRepos() {
  const q = `
  query ($login: String!, $cursor: String) {
    user(login: $login) {
      repositories(first: 100, after: $cursor, ownerAffiliations: OWNER, isFork: false) {
        pageInfo { hasNextPage endCursor }
        nodes { name owner { login } pushedAt }
      }
    }
  }`;

  const out = [];
  let cursor = null;
  do {
    const data = await graphql(q, { login: LOGIN, cursor });
    const r = data.user.repositories;
    out.push(...r.nodes);
    cursor = r.pageInfo.hasNextPage ? r.pageInfo.endCursor : null;
  } while (cursor);

  // only repos touched inside the window are worth scanning
  return out.filter((r) => r.pushedAt && r.pushedAt >= SINCE);
}

async function collect() {
  const repos = await listRepos();
  const lines = new Map();
  let commitCount = 0;

  for (const repo of repos) {
    const slug = `${repo.owner.login}/${repo.name}`;
    const commits = await api(
      `/repos/${slug}/commits?author=${encodeURIComponent(LOGIN)}&since=${SINCE}&per_page=100`
    );
    if (!commits || !commits.length) continue;

    for (const { sha } of commits) {
      const detail = await api(`/repos/${slug}/commits/${sha}`);
      if (!detail || !detail.files) continue;
      commitCount++;

      for (const file of detail.files) {
        if (SKIP.some((re) => re.test(file.filename))) continue;
        const ext = file.filename.split(".").pop().toLowerCase();
        const lang = EXT[ext];
        if (!lang) continue;
        const touched = (file.additions || 0) + (file.deletions || 0);
        lines.set(lang, (lines.get(lang) || 0) + touched);
      }
    }
  }

  const total = [...lines.values()].reduce((a, b) => a + b, 0);
  const top = [...lines.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([name, n]) => ({ name, lines: n, pct: total ? (n / total) * 100 : 0 }));

  return { top, total, commitCount, repos: repos.length };
}

const COLORS = ["#06B6D4", "#8A2BE2", "#4F46E5", "#22d3ee", "#a855f7", "#6366f1"];

const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" }[c])
  );

const fmt = (n) => n.toLocaleString("en-US");

function render(d) {
  const W = 1000;
  const rows = d.top.length || 1;
  const H = 118 + rows * 38;
  const barX = 300;
  const barW = 480;

  const bars = d.top
    .map((lang, i) => {
      const y = 104 + i * 38;
      const w = Math.max(3, (lang.pct / 100) * barW);
      const color = COLORS[i % COLORS.length];
      return `
    <g opacity="0">
      <animate attributeName="opacity" values="0;1" dur="0.5s" begin="${0.12 + i * 0.1}s" fill="freeze"/>
      <text x="56" y="${y + 13}" font-family="'Segoe UI', Inter, system-ui, sans-serif" font-size="14.5" font-weight="600" fill="#e6edf3">${esc(lang.name)}</text>
      <text x="${barX - 24}" y="${y + 13}" text-anchor="end" font-family="'JetBrains Mono', ui-monospace, monospace" font-size="12" fill="#8b949e">${fmt(lang.lines)} lines</text>
      <rect x="${barX}" y="${y + 2}" width="${barW}" height="13" rx="6.5" fill="#161b22"/>
      <rect x="${barX}" y="${y + 2}" width="0" height="13" rx="6.5" fill="${color}">
        <animate attributeName="width" from="0" to="${w}" dur="1.1s" begin="${0.12 + i * 0.1}s"
                 fill="freeze" calcMode="spline" keySplines="0.2 0.7 0.3 1"/>
      </rect>
      <text x="${barX + barW + 20}" y="${y + 13}" font-family="'JetBrains Mono', ui-monospace, monospace" font-size="13" font-weight="600" fill="${color}">${lang.pct.toFixed(1)}%</text>
    </g>`;
    })
    .join("");

  const empty = `
    <text x="56" y="120" font-family="'JetBrains Mono', ui-monospace, monospace" font-size="14" fill="#8b949e">No commits in the last ${DAYS} days.</text>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" fill="none" role="img" aria-label="Languages committed in the last ${DAYS} days">
  <title>Languages committed in the last ${DAYS} days</title>
  <defs>
    <linearGradient id="accent" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="#8A2BE2"/>
      <stop offset="50%" stop-color="#4F46E5"/>
      <stop offset="100%" stop-color="#06B6D4"/>
    </linearGradient>
    <clipPath id="card"><rect width="${W}" height="${H}" rx="16"/></clipPath>
  </defs>

  <g clip-path="url(#card)">
    <rect width="${W}" height="${H}" fill="#0D1117"/>
    <rect width="${W}" height="3" fill="url(#accent)"/>

    <text x="56" y="56" font-family="'JetBrains Mono', ui-monospace, monospace" font-size="13" font-weight="600" fill="#8b949e" letter-spacing="1.8">WHAT I ACTUALLY COMMITTED · LAST ${DAYS} DAYS</text>

    ${d.top.length ? bars : empty}

    <text x="56" y="${H - 26}" font-family="'JetBrains Mono', ui-monospace, monospace" font-size="11" fill="#8b949e">${fmt(
      d.commitCount
    )} commits · ${fmt(d.total)} lines changed · ${d.repos} active repos · private included</text>
  </g>

  <rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" rx="16" fill="none" stroke="#30363d" stroke-opacity="0.7"/>
</svg>
`;
}

const data = await collect();
const { writeFile, mkdir } = await import("node:fs/promises");
await mkdir("assets", { recursive: true });
await writeFile("assets/commit-langs.svg", render(data), "utf8");

console.log(
  `commit-langs.svg — ${data.commitCount} commits, ${data.total} lines, ` +
    `top: ${data.top.map((l) => `${l.name} ${l.pct.toFixed(1)}%`).join(", ") || "none"}`
);
