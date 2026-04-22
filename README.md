<div align="center">
  <img src="piwa-hero.png" alt="PIWA Hero" width="200" />
</div>

<h3 align="center">Interact with your machine with a coding agent via Whatsapp </h3>

<p align="center">
  <b><a href="#">Download for macOS</a></b>
  &nbsp;&nbsp;|&nbsp;&nbsp;
  <b><a href="#">Download for Windows</a></b>
  &nbsp;&nbsp;|&nbsp;&nbsp;
  <b><a href="#">Download for Linux</a></b>
</p>

---

Piwa lets you interact with an autonomous AI coding agent directly via WhatsApp. It acts as a lightweight messaging layer on top of the <a href="https://github.com/badlogic/pi-mono">pi coding agent</a>. 

Text your Whatsapp coding agent architectural questions, ask it to read logs, or have it write code on your host machine while you are away from your desk.

---

## Why Oldy? (vs. Ollama)

We love local models, but we wanted a tool that actually understands your hardware and your workflow:

* 🛡️ **Hardware-Aware Safety:** Ollama doesn't warn you if downloading a massive model will crash your laptop—**Oldy does.** We analyze your system specs and proactively prevent you from running models that exceed your hardware limits.
* 🌍 **Instant Public URLs:** Ollama restricts you to local network access. **Oldy** automatically generates a secure, public URL for your models out-of-the-box, making it effortless to connect external web apps or share endpoints.
* 📊 **Real-Time Telemetry:** Ollama leaves you guessing about system strain. **Oldy** provides built-in performance monitoring, helping you visualize exactly how a model is performing on your CPU, GPU, and RAM in real-time.

---

## 📋 Requirements

* **Runtime:** Node.js (v18.0.0 or higher).
* **WhatsApp Accounts:** 
  * A secondary phone number to act as the "Agent".
  * Your personal phone number to act as the "Owner".
* **(OPTIONAL) API Key:** A Google Gemini, Anthropic, or OpenAI API key.

## Desktop App (Development)

Get started quickly with the Oldy Desktop Application.

```bash
git clone https://github.com/PTBYSR/piwa.git
cd piwa/piwa-desktop
npm install
npm run dev
```

## CLI & WhatsApp Agent Setup

For developers who prefer the terminal or want to use the PIWA (Pi WhatsApp Agent) bridge to text their agent directly.

```bash
git clone https://github.com/PTBYSR/piwa.git
cd piwa
npm install
npm start
```

### Zero-Friction Pairing
On your very first run of the CLI, an interactive terminal wizard will guide you:
1. Enter your Bot's WhatsApp number.
2. Enter your personal WhatsApp number (so nobody else can command the bot).
3. Generate an **8-character Pairing Code**.
4. On your Agent phone, go to **Settings > Linked Devices > Link with phone number instead** and enter the code.

Once linked, your configuration is saved locally to `piwa.config.json` and `.piwa-auth/`, so you never have to pair again!

## 🔑 Authentication & API Keys

PIWA relies entirely on the native `pi-coding-agent` for authentication. 

* If you have ever used the `pi` CLI on your computer before, **PIWA will instantly find your existing API keys** (`~/.pi/agent/auth.json`) and work out-of-the-box.
* If you don't have an API key configured yet, the native Pi TUI will automatically prompt you for one in the terminal the first time you try to send a message.
* You can also type `/login` in the terminal to securely connect enterprise OAuth providers like Google Cloud Vertex AI, Antigravity or GitHub Copilot.

## ⚙️ How It Works

* **Dual Interface:** When you run `npm start`, the native `pi` Terminal UI (TUI) opens on your machine. You can watch the agent "think", run `bash` commands, and edit files in real-time on your computer screen while it simultaneously chats with you on WhatsApp.
* **Agentic Tools:** Inherits the Pi framework's powerful capabilities (`read`, `write`, `bash`, `edit`, `ls`, `grep`, `find`).
* **Secure:** A hardcoded whitelist ensures that **only** the `OWNER_NUMBER` can execute commands on the host machine. All other messages (group chats, spam, etc.) are silently dropped.
* **WhatsApp Commands:** Text `/help` to the bot to see available commands like `/compact` (to summarize old context and save tokens) or `/tokens` (to see usage stats).

## Acknowledgements

PIWA is built entirely on top of [Mario Zechner's](https://github.com/badlogic) fantastic **Pi** agent framework. Uses `@whiskeysockets/baileys` for the WhatsApp Web protocol.

## License
MIT
