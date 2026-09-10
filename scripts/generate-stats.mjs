// Generates assets/stats.svg from the GitHub GraphQL API.
// Runs in Actions with a PAT, so private repositories are included.

const TOKEN = process.env.GH_TOKEN;
const LOGIN = process.env.LOGIN;

if (!TOKEN || !LOGIN) {
  console.error("GH_TOKEN and LOGIN are required");
  process.exit(1);
}

const THEME = {
  bg: "#0D1117",
  border: "#30363d",
  text: "#e6edf3",
  dim: "#8b949e",
  violet: "#8A2BE2",
  indigo: "#4F46E5",
  cyan: "#06B6D4",
};

async function graphql(query, variables) {
  const res = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: {
      Authorization: `bearer ${TOKEN}`,
      "Content-Type": "application/json",
      "User-Agent": "profile-stats",
    },
    body: JSON.stringify({ query, variables }),
  });

  if (!res.ok) throw new Error(`GraphQL HTTP ${res.status}: ${await res.text()}`);

  const json = await res.json();
  if (json.errors) throw new Error(`GraphQL: ${JSON.stringify(json.errors)}`);
  return json.data;
}

const PROFILE_QUERY = `
query ($login: String!) {
  user(login: $login) {
    followers { totalCount }
    contributionsCollection {
      totalCommitContributions
      totalPullRequestContributions
      totalIssueContributions
      totalPullRequestReviewContributions
      restrictedContributionsCount
      contributionCalendar { totalContributions }
    }
  }
}`;

const REPO_QUERY = `
query ($login: String!, $cursor: String) {
  user(login: $login) {
    repositories(first: 100, after: $cursor, ownerAffiliations: OWNER, isFork: false) {
      totalCount
      pageInfo { hasNextPage endCursor }
      nodes {
        stargazerCount
        languages(first: 12, orderBy: { field: SIZE, direction: DESC }) {
          edges { size node { name color } }
        }
      }
    }
  }
}`;

async function collect() {
  const profile = await graphql(PROFILE_QUERY, { login: LOGIN });
  const c = profile.user.contributionsCollection;

  let cursor = null;
  let stars = 0;
  let repoCount = 0;
  const langBytes = new Map();
  const langColor = new Map();

  do {
    const data = await graphql(REPO_QUERY, { login: LOGIN, cursor });
    const repos = data.user.repositories;
    repoCount = repos.totalCount;

    for (const repo of repos.nodes) {
      stars += repo.stargazerCount;
      for (const edge of repo.languages.edges) {
        const name = edge.node.name;
        langBytes.set(name, (langBytes.get(name) || 0) + edge.size);
        if (edge.node.color) langColor.set(name, edge.node.color);
      }
    }

    cursor = repos.pageInfo.hasNextPage ? repos.pageInfo.endCursor : null;
  } while (cursor);

  const totalBytes = [...langBytes.values()].reduce((a, b) => a + b, 0) || 1;
  const languages = [...langBytes.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([name, size]) => ({
      name,
      pct: (size / totalBytes) * 100,
      color: langColor.get(name) || THEME.cyan,
    }));

  return {
    contributions: c.contributionCalendar.totalContributions,
    commits: c.totalCommitContributions,
    prs: c.totalPullRequestContributions,
    issues: c.totalIssueContributions,
    reviews: c.totalPullRequestReviewContributions,
    followers: profile.user.followers.totalCount,
    repos: repoCount,
    stars,
    languages,
  };
}

const esc = (s) =>
  String(s).replace(/[&<>"']/g, (ch) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" }[ch])
  );

const fmt = (n) => n.toLocaleString("en-US");

function statCell(x, y, value, label, color, delay) {
  return `
    <g class="rise" style="animation-delay:${delay}s">
      <text x="${x}" y="${y}" class="stat-num" fill="${color}">${fmt(value)}</text>
      <text x="${x}" y="${y + 22}" class="stat-label">${esc(label)}</text>
    </g>`;
}

function langRow(x, y, lang, i) {
  const barW = 250;
  const w = Math.max(4, (lang.pct / 100) * barW);
  return `
    <g class="rise" style="animation-delay:${0.5 + i * 0.08}s">
      <text x="${x}" y="${y}" class="lang-name">${esc(lang.name)}</text>
      <text x="${x + barW}" y="${y}" class="lang-pct" text-anchor="end">${lang.pct.toFixed(1)}%</text>
      <rect x="${x}" y="${y + 8}" width="${barW}" height="7" rx="3.5" fill="#21262d"/>
      <rect x="${x}" y="${y + 8}" width="${w}" height="7" rx="3.5" fill="${lang.color}">
        <animate attributeName="width" from="0" to="${w}" dur="1.1s" fill="freeze"
                 calcMode="spline" keySplines="0.2 0.7 0.3 1" begin="${0.5 + i * 0.08}s"/>
      </rect>
    </g>`;
}

function render(d) {
  const W = 1000;
  const H = 300;

  const stats = [
    [64, 118, d.contributions, "Contributions (1y)", THEME.cyan],
    [290, 118, d.commits, "Commits", THEME.violet],
    [452, 118, d.prs, "Pull Requests", THEME.indigo],
    [64, 205, d.repos, "Repositories", THEME.violet],
    [290, 205, d.stars, "Stars Earned", THEME.cyan],
    [452, 205, d.followers, "Followers", THEME.indigo],
  ];

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" fill="none" role="img" aria-label="GitHub statistics">
  <title>GitHub statistics for ${esc(LOGIN)}</title>
  <defs>
    <linearGradient id="accent" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="${THEME.violet}"/>
      <stop offset="50%" stop-color="${THEME.indigo}"/>
      <stop offset="100%" stop-color="${THEME.cyan}"/>
    </linearGradient>
    <radialGradient id="glow" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="${THEME.indigo}" stop-opacity="0.22"/>
      <stop offset="100%" stop-color="${THEME.indigo}" stop-opacity="0"/>
    </radialGradient>
    <clipPath id="card"><rect width="${W}" height="${H}" rx="16"/></clipPath>
  </defs>

  <style>
    .stat-num   { font: 700 30px 'Segoe UI', Inter, system-ui, sans-serif; }
    .stat-label { font: 500 12.5px 'JetBrains Mono', ui-monospace, monospace; fill: ${THEME.dim}; letter-spacing: .3px; }
    .heading    { font: 600 14px 'JetBrains Mono', ui-monospace, monospace; fill: ${THEME.dim}; letter-spacing: 1.6px; }
    .lang-name  { font: 600 13px 'Segoe UI', Inter, system-ui, sans-serif; fill: ${THEME.text}; }
    .lang-pct   { font: 500 12px 'JetBrains Mono', ui-monospace, monospace; fill: ${THEME.dim}; }
    .foot       { font: 500 11px 'JetBrains Mono', ui-monospace, monospace; fill: ${THEME.dim}; }
    .rise { animation: rise .8s cubic-bezier(.2,.7,.3,1) both; }
    @keyframes rise { from { opacity: 0; transform: translateY(10px) } to { opacity: 1; transform: none } }
  </style>

  <g clip-path="url(#card)">
    <rect width="${W}" height="${H}" fill="${THEME.bg}"/>
    <ellipse cx="820" cy="60" rx="300" ry="200" fill="url(#glow)"/>
    <rect width="${W}" height="3" fill="url(#accent)"/>

    <text x="64" y="62" class="heading">GITHUB STATS</text>
    <text x="640" y="62" class="heading">TOP LANGUAGES</text>

    ${stats.map(([x, y, v, l, c], i) => statCell(x, y, v, l, c, 0.08 + i * 0.07)).join("")}

    <line x1="600" y1="44" x2="600" y2="256" stroke="${THEME.border}" stroke-opacity="0.6"/>

    ${d.languages.map((lang, i) => langRow(640, 96 + i * 34, lang, i)).join("")}

    <text x="64" y="272" class="foot">private repositories included · updated ${new Date()
      .toISOString()
      .slice(0, 10)}</text>
  </g>

  <rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" rx="16" fill="none" stroke="${THEME.border}" stroke-opacity="0.7"/>
</svg>
`;
}

const data = await collect();
const svg = render(data);

const { writeFile, mkdir } = await import("node:fs/promises");
await mkdir("assets", { recursive: true });
await writeFile("assets/stats.svg", svg, "utf8");

console.log(
  `stats.svg written — ${data.contributions} contributions, ${data.commits} commits, ` +
    `${data.repos} repos, ${data.stars} stars, langs: ${data.languages.map((l) => l.name).join(", ")}`
);
