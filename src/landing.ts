import { toolDefinitions } from './mcp/index.js';

interface ToolParam {
  name: string;
  type: string;
  description: string;
}

function getCategory(toolName: string): { name: string; color: string } {
  if (toolName.includes('drive') || toolName.includes('folder') || toolName.includes('file')) {
    return { name: 'Drive', color: 'cyan' };
  }
  if (toolName.includes('doc') || toolName.includes('text') || toolName.includes('heading') || toolName.includes('image') || toolName.includes('link') || toolName.includes('list')) {
    return { name: 'Docs', color: 'purple' };
  }
  if (toolName.includes('sheet')) {
    return { name: 'Sheets', color: 'pink' };
  }
  return { name: 'Other', color: 'cyan' };
}

function getParams(inputSchema: any): ToolParam[] {
  if (!inputSchema?.properties) return [];
  return Object.entries(inputSchema.properties).map(([name, schema]: [string, any]) => ({
    name,
    type: schema.type || 'any',
    description: schema.description || '',
  }));
}

function truncate(str: string, len: number): string {
  if (str.length <= len) return str;
  return str.slice(0, len - 3) + '...';
}

export function generateLandingPage(): string {
  const tools = toolDefinitions.map(tool => ({
    ...tool,
    category: getCategory(tool.name),
    params: getParams(tool.inputSchema),
  }));

  const toolCards = tools.map(tool => `
    <div class="tech-card">
      <div class="card-header">
        <span class="tool-name glow-${tool.category.color}">${tool.name}</span>
        <span class="badge badge-${tool.category.color}">${tool.category.name}</span>
      </div>
      <p class="tool-description">${tool.description}</p>
      ${tool.params.length > 0 ? `
      <div class="params">
        <span class="params-label">Parameters:</span>
        <ul class="params-list">
          ${tool.params.map(p => `
            <li><code>${p.name}</code> <span class="param-type">(${p.type})</span> ${truncate(p.description, 60)}</li>
          `).join('')}
        </ul>
      </div>
      ` : '<p class="no-params">No parameters required</p>'}
    </div>
  `).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Google Drive MCP Server</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@300;400;500;600&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg-primary: #0a0e14;
      --bg-secondary: #121821;
      --accent-cyan: #00d4ff;
      --accent-purple: #a78bfa;
      --accent-pink: #ec4899;
      --grid-color: rgba(100, 150, 255, 0.08);
      --foreground: #f8fafc;
      --muted: rgba(148, 163, 184, 0.8);
      --border: rgba(100, 150, 255, 0.2);
      --radius: 0.75rem;
    }

    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }

    body {
      font-family: 'JetBrains Mono', monospace;
      background: var(--bg-primary);
      color: var(--foreground);
      min-height: 100vh;
      overflow-x: hidden;
      line-height: 1.6;
    }

    /* Animated gradient backdrop */
    .gradient-backdrop {
      position: fixed;
      top: -50%;
      left: -50%;
      width: 200%;
      height: 200%;
      background: radial-gradient(circle at 20% 50%, rgba(0, 212, 255, 0.08) 0%, transparent 50%),
                  radial-gradient(circle at 80% 50%, rgba(167, 139, 250, 0.06) 0%, transparent 50%),
                  radial-gradient(circle at 50% 50%, rgba(236, 72, 153, 0.04) 0%, transparent 50%);
      animation: gradientShift 20s ease-in-out infinite;
      z-index: 0;
      pointer-events: none;
    }

    @keyframes gradientShift {
      0%, 100% { transform: translate(0, 0) rotate(0deg); }
      33% { transform: translate(5%, -5%) rotate(120deg); }
      66% { transform: translate(-5%, 5%) rotate(240deg); }
    }

    /* Animated grid */
    .grid-overlay {
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background-image: linear-gradient(var(--grid-color) 1px, transparent 1px),
                        linear-gradient(90deg, var(--grid-color) 1px, transparent 1px);
      background-size: 60px 60px;
      animation: gridMove 40s linear infinite;
      z-index: 0;
      opacity: 0.6;
      pointer-events: none;
    }

    @keyframes gridMove {
      0% { background-position: 0 0, 0 0; }
      100% { background-position: 60px 60px, 60px 60px; }
    }

    /* Corner accents */
    .corner-accent {
      position: fixed;
      width: 200px;
      height: 200px;
      pointer-events: none;
      z-index: 1;
    }

    .corner-accent.top-left {
      top: 0;
      left: 0;
      border-top: 1px solid rgba(0, 212, 255, 0.2);
      border-left: 1px solid rgba(0, 212, 255, 0.2);
      animation: cornerPulse 4s ease-in-out infinite;
    }

    .corner-accent.bottom-right {
      bottom: 0;
      right: 0;
      border-bottom: 1px solid rgba(167, 139, 250, 0.2);
      border-right: 1px solid rgba(167, 139, 250, 0.2);
      animation: cornerPulse 4s ease-in-out infinite 2s;
    }

    @keyframes cornerPulse {
      0%, 100% { opacity: 0.3; }
      50% { opacity: 0.8; }
    }

    /* Main content */
    .container {
      max-width: 1200px;
      margin: 0 auto;
      padding: 2rem 1rem;
      position: relative;
      z-index: 10;
    }

    /* Hero */
    .hero {
      text-align: center;
      padding: 3rem 0 4rem;
    }

    .hero h1 {
      font-size: 2.5rem;
      font-weight: 600;
      letter-spacing: -0.02em;
      margin-bottom: 1rem;
    }

    .hero p {
      color: var(--muted);
      font-weight: 300;
      max-width: 600px;
      margin: 0 auto 1.5rem;
    }

    .hero-link {
      color: var(--accent-cyan);
      text-decoration: none;
      font-weight: 400;
      transition: text-shadow 0.3s;
    }

    .hero-link:hover {
      text-shadow: 0 0 20px rgba(0, 212, 255, 0.5);
    }

    /* Glow effects */
    .glow-cyan {
      color: var(--accent-cyan);
      text-shadow: 0 0 30px rgba(0, 212, 255, 0.3);
    }

    .glow-purple {
      color: var(--accent-purple);
      text-shadow: 0 0 30px rgba(167, 139, 250, 0.3);
    }

    .glow-pink {
      color: var(--accent-pink);
      text-shadow: 0 0 30px rgba(236, 72, 153, 0.3);
    }

    /* Section header */
    .section-header {
      text-align: center;
      margin-bottom: 2rem;
    }

    .section-header h2 {
      font-size: 1.5rem;
      font-weight: 600;
    }

    .section-header p {
      color: var(--muted);
      font-weight: 300;
      font-size: 0.875rem;
      margin-top: 0.5rem;
    }

    /* Tools grid */
    .tools-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(350px, 1fr));
      gap: 1.5rem;
    }

    /* Tech card */
    .tech-card {
      background: rgba(18, 24, 33, 0.7);
      backdrop-filter: blur(10px);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      padding: 1.5rem;
      box-shadow: 0 0 40px rgba(0, 212, 255, 0.05),
                  inset 0 1px 0 rgba(255, 255, 255, 0.05);
      transition: all 0.3s ease;
    }

    .tech-card:hover {
      border-color: rgba(167, 139, 250, 0.4);
      box-shadow: 0 0 60px rgba(167, 139, 250, 0.1),
                  inset 0 1px 0 rgba(255, 255, 255, 0.1);
      transform: translateY(-2px);
    }

    .card-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 0.75rem;
    }

    .tool-name {
      font-weight: 500;
      font-size: 1rem;
    }

    /* Badges */
    .badge {
      font-size: 0.75rem;
      padding: 0.25rem 0.5rem;
      border-radius: 0.375rem;
      font-weight: 400;
    }

    .badge-cyan {
      background: rgba(0, 212, 255, 0.1);
      border: 1px solid rgba(0, 212, 255, 0.2);
      color: var(--accent-cyan);
    }

    .badge-purple {
      background: rgba(167, 139, 250, 0.1);
      border: 1px solid rgba(167, 139, 250, 0.2);
      color: var(--accent-purple);
    }

    .badge-pink {
      background: rgba(236, 72, 153, 0.1);
      border: 1px solid rgba(236, 72, 153, 0.2);
      color: var(--accent-pink);
    }

    .tool-description {
      color: var(--muted);
      font-size: 0.875rem;
      font-weight: 300;
      margin-bottom: 1rem;
    }

    /* Parameters */
    .params {
      border-top: 1px solid var(--border);
      padding-top: 1rem;
    }

    .params-label {
      font-size: 0.75rem;
      color: var(--muted);
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }

    .params-list {
      list-style: none;
      margin-top: 0.5rem;
    }

    .params-list li {
      font-size: 0.8rem;
      color: var(--muted);
      padding: 0.25rem 0;
    }

    .params-list code {
      color: var(--foreground);
      font-weight: 500;
    }

    .param-type {
      color: var(--accent-purple);
      font-size: 0.75rem;
    }

    .no-params {
      font-size: 0.8rem;
      color: var(--muted);
      font-style: italic;
    }

    /* Footer */
    footer {
      text-align: center;
      padding: 3rem 0 2rem;
      color: var(--muted);
      font-size: 0.875rem;
      font-weight: 300;
      border-top: 1px solid rgba(0, 212, 255, 0.1);
      margin-top: 3rem;
    }

    footer a {
      color: var(--accent-cyan);
      text-decoration: none;
    }

    footer a:hover {
      text-shadow: 0 0 15px rgba(0, 212, 255, 0.5);
    }

    /* Responsive */
    @media (max-width: 768px) {
      .hero h1 { font-size: 1.75rem; }
      .tools-grid { grid-template-columns: 1fr; }
      .container { padding: 1rem; }
    }
  </style>
</head>
<body>
  <div class="gradient-backdrop"></div>
  <div class="grid-overlay"></div>
  <div class="corner-accent top-left"></div>
  <div class="corner-accent bottom-right"></div>

  <div class="container">
    <header class="hero">
      <h1>
        <span>Google Drive </span>
        <span class="glow-cyan">MCP Server</span>
      </h1>
      <p>
        An MCP server enabling Claude to interact with Google Drive, Docs, and Sheets.
        Browse, search, read, create, and edit files with full OAuth2 authentication.
      </p>
      <a href="https://voget.io" class="hero-link">&larr; voget.io</a>
    </header>

    <section>
      <div class="section-header">
        <h2 class="glow-purple">Available Tools</h2>
        <p>${tools.length} tools for Drive, Docs, and Sheets operations</p>
      </div>
      <div class="tools-grid">
        ${toolCards}
      </div>
    </section>

    <footer>
      <p>Built by <a href="https://voget.io">Matt Voget</a></p>
    </footer>
  </div>
</body>
</html>`;
}
