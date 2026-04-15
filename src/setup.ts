import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';
import * as https from 'https';
import { execSync, spawn, execFileSync } from 'child_process';
import * as clack from '@clack/prompts';

const OLLAMA_API = 'http://localhost:11434';

// ── Curated coding model list ────────────────────────────────────────────────
// RAM = minimum GB needed to run comfortably. Ordered by quality within tiers.
const CODING_MODELS = [
  // Tiny (≤ 3 GB)
  { name: 'qwen2.5-coder:1.5b',   ram: 2,  desc: 'Fast, lightweight coder' },
  { name: 'gemma3:1b',             ram: 2,  desc: 'Google Gemma 3 — compact' },
  { name: 'deepseek-coder:1.3b',   ram: 2,  desc: 'Efficient small coder' },

  // Small (4–5 GB)
  { name: 'gemma3n:e4b',           ram: 4,  desc: 'Google Gemma 3 Nano — efficient' },
  { name: 'gemma3:4b',             ram: 4,  desc: 'Google Gemma 3 — balanced' },
  { name: 'gemma4:4b',             ram: 4,  desc: 'Google Gemma 4 — latest gen' },

  // Medium (5–6 GB)
  { name: 'qwen2.5-coder:7b',     ram: 2,  desc: 'Great speed & quality balance' },
  { name: 'deepseek-coder:6.7b',  ram: 5,  desc: 'Solid code generation' },
  { name: 'codellama:7b',         ram: 5,  desc: 'Meta code model, well-rounded' },
  { name: 'llama3.1:8b',          ram: 6,  desc: 'General + coding capable' },

  // Large (8–10 GB)
  { name: 'codellama:13b',        ram: 9,  desc: 'Larger Meta code model' },
  { name: 'gemma3:12b',           ram: 9,  desc: 'Google Gemma 3 — high quality' },
  { name: 'gemma4:12b',           ram: 9,  desc: 'Google Gemma 4 — high quality' },
  { name: 'qwen2.5-coder:14b',   ram: 10, desc: 'High quality coding' },
  { name: 'deepseek-coder-v2:16b',ram: 10, desc: 'Strong coding, medium size' },

  // XL (16+ GB)
  { name: 'gemma3:27b',           ram: 18, desc: 'Google Gemma 3 — premium' },
  { name: 'gemma4:27b',           ram: 18, desc: 'Google Gemma 4 — premium' },
  { name: 'qwen2.5-coder:32b',   ram: 20, desc: 'Top-tier coding agent' },
  { name: 'codellama:34b',        ram: 22, desc: 'Meta large code model' },
];

// ── Helpers ──────────────────────────────────────────────────────────────────

function isOllamaInstalled(): boolean {
  try {
    execSync('ollama --version', { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

async function isOllamaRunning(): Promise<boolean> {
  try {
    const res = await fetch(`${OLLAMA_API}/api/tags`);
    return res.ok;
  } catch {
    return false;
  }
}

function startOllamaServer(): void {
  const child = spawn('ollama', ['serve'], {
    detached: true,
    stdio: 'ignore',
    shell: true,
  });
  child.unref();
}

async function waitForOllama(timeoutMs = 15000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await isOllamaRunning()) return true;
    await new Promise(r => setTimeout(r, 1000));
  }
  return false;
}

async function getLocalModels(): Promise<string[]> {
  try {
    const res = await fetch(`${OLLAMA_API}/api/tags`);
    if (!res.ok) return [];
    const data = await res.json() as { models?: { name: string }[] };
    return (data.models || []).map(m => m.name);
  } catch {
    return [];
  }
}

function downloadFile(url: string, dest: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    const request = (reqUrl: string) => {
      https.get(reqUrl, (response) => {
        // Follow redirects
        if (response.statusCode === 301 || response.statusCode === 302) {
          const location = response.headers.location;
          if (location) { request(location); return; }
        }
        if (response.statusCode !== 200) {
          reject(new Error(`Download failed: HTTP ${response.statusCode}`));
          return;
        }
        const total = parseInt(response.headers['content-length'] || '0', 10);
        let downloaded = 0;
        response.on('data', (chunk: Buffer) => {
          downloaded += chunk.length;
          if (total > 0) {
            const pct = Math.round((downloaded / total) * 100);
            process.stdout.write(`\r  Downloading... ${pct}%`);
          }
        });
        response.pipe(file);
        file.on('finish', () => { file.close(); console.log(''); resolve(); });
      }).on('error', reject);
    };
    request(url);
  });
}

async function installOllama(): Promise<boolean> {
  const spinner = clack.spinner();
  const installerPath = path.join(process.cwd(), 'OllamaSetup.exe');

  try {
    spinner.start('Downloading Ollama installer...');
    await downloadFile('https://ollama.com/download/OllamaSetup.exe', installerPath);
    spinner.stop('Download complete.');

    spinner.start('Installing Ollama (this may take a moment)...');
    execFileSync(installerPath, ['/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART'], {
      stdio: 'pipe',
      timeout: 120000,
    });
    spinner.stop('Ollama installed successfully!');

    // Clean up installer
    try { fs.unlinkSync(installerPath); } catch {}

    return true;
  } catch (err) {
    spinner.stop('Installation failed.');
    console.error('  Error:', err instanceof Error ? err.message : err);
    try { fs.unlinkSync(installerPath); } catch {}
    return false;
  }
}

function pullModel(modelName: string): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn('ollama', ['pull', modelName], {
      stdio: 'inherit',
      shell: true,
    });
    child.on('close', (code) => resolve(code === 0));
    child.on('error', () => resolve(false));
  });
}

// ── Main setup flow ──────────────────────────────────────────────────────────

export async function setup(): Promise<string> {
  console.log('');
  clack.intro('🤖 PIWA — Smart Setup');

  // ── Step 1: Check Ollama installation ──────────────────────────────────
  if (!isOllamaInstalled()) {
    clack.log.warn('Ollama is not installed on this system.');

    const shouldInstall = await clack.confirm({
      message: 'PIWA runs on top of Ollama. Download and install it now?',
    });

    if (clack.isCancel(shouldInstall) || !shouldInstall) {
      clack.outro('PIWA requires Ollama to run. Install it from https://ollama.com and try again. 👋');
      process.exit(0);
    }

    const ok = await installOllama();
    if (!ok) {
      clack.outro('Failed to install Ollama. Please install it manually from https://ollama.com');
      process.exit(1);
    }
  } else {
    clack.log.success('Ollama is installed.');
  }

  // ── Step 2: Ensure Ollama is running ───────────────────────────────────
  if (!(await isOllamaRunning())) {
    const spinner = clack.spinner();
    spinner.start('Starting Ollama server...');
    startOllamaServer();
    const ready = await waitForOllama();
    if (!ready) {
      spinner.stop('Failed to start Ollama server.');
      clack.outro('Could not start Ollama. Try running "ollama serve" manually.');
      process.exit(1);
    }
    spinner.stop('Ollama server is running.');
  } else {
    clack.log.success('Ollama server is running.');
  }

  // ── Step 3: Detect system specs ────────────────────────────────────────
  const totalRAM = Math.round(os.totalmem() / (1024 ** 3));
  const freeRAM = Math.round(os.freemem() / (1024 ** 3));
  const cpuCount = os.cpus().length;
  const cpuModel = os.cpus()[0]?.model || 'Unknown';

  clack.log.info(`System: ${totalRAM} GB RAM (${freeRAM} GB free), ${cpuCount} cores — ${cpuModel.trim()}`);

  // ── Step 4: Filter and recommend models ────────────────────────────────
  const safeRAM = freeRAM - 2; // Leave 2 GB headroom for OS
  const eligible = CODING_MODELS.filter(m => m.ram <= safeRAM);

  if (eligible.length === 0) {
    clack.log.warn(`Only ${freeRAM} GB RAM free. Showing smallest models.`);
    eligible.push(...CODING_MODELS.filter(m => m.ram <= 3));
    if (eligible.length === 0) {
      eligible.push(CODING_MODELS[0]); // Always show at least one
    }
  }

  // Pick top 5, prefer larger (higher quality) models first
  const top5 = eligible
    .sort((a, b) => b.ram - a.ram)
    .slice(0, 5)
    .sort((a, b) => a.ram - b.ram); // Re-sort ascending for display

  // Check which are already pulled
  const localModels = await getLocalModels();

  // ── Step 5: User selects model ─────────────────────────────────────────
  const options = top5.map(m => {
    const installed = localModels.some(lm => lm.startsWith(m.name.split(':')[0]) && lm.includes(m.name.split(':')[1] || ''));
    const tag = installed ? ' ✅ installed' : '';
    return {
      value: m.name,
      label: `${m.name}  (${m.ram} GB)${tag}`,
      hint: m.desc,
    };
  });

  options.push({
    value: '__custom__',
    label: '✏️  Other (type model name manually)',
    hint: 'Enter any Ollama model name',
  });

  const selected = await clack.select({
    message: 'Choose a coding model for PIWA:',
    options,
  });

  if (clack.isCancel(selected)) {
    clack.outro('Setup cancelled. 👋');
    process.exit(0);
  }

  let modelName = selected as string;

  if (modelName === '__custom__') {
    const custom = await clack.text({
      message: 'Enter the Ollama model name (e.g. "codellama:7b"):',
      validate: (v) => {
        if (typeof v !== 'string') return undefined;
        return (!v.trim() ? 'Model name cannot be empty.' : undefined);
      },
    });
    if (clack.isCancel(custom)) {
      clack.outro('Setup cancelled. 👋');
      process.exit(0);
    }
    modelName = (custom as string).trim();
  }

  // ── Step 6: Auto-pull if needed ────────────────────────────────────────
  const isInstalled = localModels.some(lm => lm === modelName || lm.startsWith(modelName));

  if (!isInstalled) {
    clack.log.info(`Pulling model "${modelName}"... This may take a few minutes.`);
    const ok = await pullModel(modelName);
    if (!ok) {
      clack.outro(`Failed to pull "${modelName}". Check the model name and try again.`);
      process.exit(1);
    }
    clack.log.success(`Model "${modelName}" is ready.`);
  } else {
    clack.log.success(`Model "${modelName}" is already installed.`);
  }

  clack.outro(`✅ Setup complete — using ${modelName}`);
  console.log('');

  return modelName;
}
