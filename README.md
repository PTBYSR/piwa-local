<p align="center">
  <img src="header.png" alt="PIWA Header">
</p>

<p align="center">
  <b>Pi WhatsApp Agent</b><br>
  A minimalistic WhatsApp bridge for the <a href="https://github.com/badlogic/pi-mono">pi coding agent</a>.
</p>

> ⚠️ **Alpha / Work-In-Progress:** The core bridge works, but there is currently a [known bug with how local models output their responses](https://github.com/PTBYSR/piwa-local/issues/1). PRs welcome!

---

PIWA lets you interact with an autonomous AI coding agent directly via WhatsApp. It runs entirely locally on your own hardware using Ollama, acting as a lightweight layer on top of the Pi agent framework. 

Adapt your agent to your commute, not the other way around. No heavy laptop required, no API tokens spent on quick brainstorming.

## 📋 Requirements

Before you begin, ensure your system meets the following criteria:

*   **Operating System:** Windows, macOS, or Linux.
*   **Runtime:** Node.js (v18.0.0 or higher).
*   **Hardware (Recommended):**
    *   **RAM:** 8GB minimum (16GB recommended for larger models).
    *   **CPU:** 4+ cores (Modern Intel i5/i7 or Apple M-series suggested).
*   **WhatsApp Account:** A secondary phone number or an existing account you wish to "link" as the agent.
*   **Ollama:** PIWA can auto-install this for you on Windows, but having it pre-installed is recommended.

## 🛠️ The Onboarding Process

When you run `npm start` for the first time, PIWA will guide you through a **Smart Setup**:

1.  **Ollama Check:** Recommends or auto-installs Ollama if missing.
2.  **Resource Analysis:** Scans your available RAM and CPU cores.
3.  **Model Selection:** Presents a curated list of coding models (like `qwen2.5-coder`) optimized for your specific hardware.
4.  **WhatsApp Linking:** Generates a **Pairing Code** in your terminal.
    *   Open WhatsApp on your phone.
    *   Go to **Linked Devices** > **Link a Device**.
    *   Select **Link with phone number instead**.
    *   Enter the 8-character code displayed in your terminal.

## Quick Start

```bash
git clone https://github.com/PTBYSR/piwa-local.git
cd piwa-local
npm install
npm run build
```

Set up your `.env` file (copy from `.env.example`):
```text
WORK_DIR=./work
# PHONE_NUMBER: The number the AI Agent will use to respond to you.
# Format: Country code + number, NO plus sign (e.g., 1234567890)
PHONE_NUMBER=agent_whatsapp_number
# OWNER_NUMBER: Your personal WhatsApp number. Only this number can command the agent.
# Format: Country code + number, NO plus sign.
OWNER_NUMBER=your_personal_number
```

Start the bridge:
```bash
npm start
```

## How It Works

PIWA uses `baileys` to listen to an authorized WhatsApp number. Any incoming messages are forwarded to a local Pi agent session.

- **Local-First:** Designed specifically for Ollama and lightweight local LLMs.
- **Agentic Tools:** Inherits Pi framework capabilities (`read`, `write`, `bash`).
- **Secure:** Hardcoded whitelist ensures only the owner can execute commands on the host machine.

## Philosophy

I built PIWA because opening a laptop on a packed train just to ask my agent for an architectural strategy is a massive pain. Throwing down cash for a Mac Mini just to run a portable server felt like overkill.

PIWA is ridiculously lightweight. It does precisely one thing: ties a messaging app to a local code reasoning engine. No bloat, no unnecessary token fees.

## Acknowledgements

PIWA is built entirely on top of [Mario Zechner's](https://github.com/badlogic) fantastic **Pi** agent framework.

## License
MIT
