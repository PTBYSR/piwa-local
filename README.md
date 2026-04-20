<p align="center">
  <img src="header.png" alt="PIWA Header">
</p>

<p align="center">
  <b>Pi WhatsApp Agent</b><br>
  A WhatsApp bridge for the <a href="https://github.com/badlogic/pi-mono">pi coding agent</a>.
</p>

---

PIWA lets you interact with an autonomous AI coding agent directly via WhatsApp. It acts as a lightweight messaging layer on top of the native Pi framework. 

Adapt your agent to your commute. No laptop required—just text your agent architectural questions, ask it to read logs, or have it write code on your host machine while you are away from your desk.

## 📋 Requirements

* **Runtime:** Node.js (v18.0.0 or higher).
* **WhatsApp Accounts:** 
  * A secondary phone number to act as the "Agent".
  * Your personal phone number to act as the "Owner".
* **API Key:** A Google Gemini, Anthropic, or OpenAI API key.

## 🚀 Quick Start

PIWA is designed for **Zero-Friction Setup**. You do not need to configure any `.env` files.

```bash
git clone https://github.com/PTBYSR/piwa-local.git
cd piwa-local
npm install
npm start
```

On your very first run, an interactive terminal wizard will guide you:
1. It will ask for the Bot's WhatsApp number.
2. It will ask for your personal WhatsApp number (so nobody else can command the bot).
3. It will generate an **8-character Pairing Code** in your terminal.
    * Open WhatsApp on your **Agent phone**.
    * Go to **Settings > Linked Devices > Link a Device > Link with phone number instead**.
    * Enter the code from your terminal.

Once linked, your configuration is saved locally to `piwa.config.json` and `.piwa-auth/`, so you never have to pair again!

## 🔑 Authentication & API Keys

PIWA relies entirely on the native `pi-coding-agent` for authentication. 

* If you have ever used the `pi` CLI on your computer before, **PIWA will instantly find your existing API keys** (`~/.pi/agent/auth.json`) and work out-of-the-box.
* If you don't have an API key configured yet, the native Pi TUI will automatically prompt you for one in the terminal the first time you try to send a message.
* You can also type `/login` in the terminal to securely connect enterprise OAuth providers like Google Cloud Vertex AI or GitHub Copilot.

## ⚙️ How It Works

* **Dual Interface:** When you run `npm start`, the native `pi` Terminal UI (TUI) opens on your machine. You can watch the agent "think", run `bash` commands, and edit files in real-time on your computer screen while it simultaneously chats with you on WhatsApp.
* **Agentic Tools:** Inherits the Pi framework's powerful capabilities (`read`, `write`, `bash`, `edit`, `ls`, `grep`, `find`).
* **Secure:** A hardcoded whitelist ensures that **only** the `OWNER_NUMBER` can execute commands on the host machine. All other messages (group chats, spam, etc.) are silently dropped.
* **WhatsApp Commands:** Text `/help` to the bot to see available commands like `/compact` (to summarize old context and save tokens) or `/tokens` (to see usage stats).

## Acknowledgements

PIWA is built entirely on top of [Mario Zechner's](https://github.com/badlogic) fantastic **Pi** agent framework. Uses `@whiskeysockets/baileys` for the WhatsApp Web protocol.

## License
MIT