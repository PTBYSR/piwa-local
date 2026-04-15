# 🤖 PIWA — Pi WhatsApp Agent

> ⚠️ **Note: This project is currently in early Alpha / Work-In-Progress.** 
> The core WhatsApp bridge and framework integration work, but there is currently a known bug with how local models output their responses. Active development is ongoing, and PRs are highly welcome!

**PIWA** is a local-first, open-source AI coding agent bridged directly to your WhatsApp. It allows you to control your computer, perform web searches, and execute complex coding tasks via a secure WhatsApp conversation, all running entirely on your own hardware using **Ollama**.

---

## 📋 Requirements

Before you begin, ensure your system meets the following criteria:

*   **Operating System:** Windows, macOS, or Linux.
*   **Runtime:** Node.js (v18.0.0 or higher).
*   **Hardware (Recommended):**
    *   **RAM:** 8GB minimum (16GB recommended for larger models).
    *   **CPU:** 4+ cores (Modern Intel i5/i7 or Apple M-series suggested).
*   **WhatsApp Account:** A secondary phone number or an existing account you wish to "link" as the agent.
*   **Ollama:** PIWA can auto-install this for you on Windows, but having it pre-installed is recommended.

---

## ✨ Features

*   **100% Local AI:** Your data and conversations stay on your machine. No OpenAI/Anthropic API keys required.
*   **Autonomous Coding Agent:** Can read/write files, run terminal commands, and debug code directly in your workspace.
*   **WhatsApp Integration:** Secure, end-to-end encrypted messaging bridge using the [Baileys](https://github.com/WhiskeySockets/Baileys) library.
*   **Keyless Web Search:** Integrated DuckDuckGo tool for real-time information retrieval without API tokens.
*   **Smart Onboarding:** Interactive CLI setup that detects your system specs and recommends the best model for your RAM.
*   **Security First:** Strictly whitelisted. Only responds to the authorized number you specify.

---

## 🚀 Quick Start & Onboarding

### 1. Clone & Install
```bash
git clone https://github.com/your-username/pi-whatsapp-agent.git
cd pi-whatsapp-agent
npm install
```

### 2. Configure Environment
Create a `.env` file in the root directory:
```env
# Path where the agent is allowed to work/edit files
WORK_DIR=C:/path/to/your/work/folder

# Your personal phone number (the ONLY person the agent will listen to)
PHONE_NUMBER=234...

# Dummy key (Ollama is local and doesn't need a real one)
OLLAMA_API_KEY=piwa-local-dummy-key
```

### 3. Run PIWA
```bash
npm start
```

> [!IMPORTANT]
> **First Run Note:** The first time you run the agent, it may take a few minutes to begin responding. This is because it needs to initiate the local Ollama server and load the AI model into your system's RAM/VRAM. Subsequent starts will be significantly faster.

---

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

---

## 🎮 Usage & Commands

Once connected, you can text your bot from your whitelisted phone number.

### Example Tasks:
*   *"Create a responsive React landing page in a new folder called 'my-site'"*
*   *"Search for the latest documentation on the Resend API and write a TypeScript mailer script"*
*   *"Refactor the code in src/utils.ts to be more efficient"*

### Built-in Agent Commands:
*   **/new** — Resets the agent's memory for a fresh coding session.
*   **/model `<name>`** — Instantly switches the local model being used (e.g., `/model llama3:8b`).

---

## 🛡️ Security & Reliability

*   **Whitelisting:** PIWA uses a hard-coded check to ensure it only processes messages from your specific JID.
*   **Connection Resilience:** Features intelligent reconnection logic that handles internet outages (408 errors) without losing your session.
*   **Session Management:** Auth keys are stored locally in the `/auth` folder. If they ever get corrupted, the folder can be safely cleared to re-pair.

---

## 📜 Acknowledgements

PIWA is built on top of the powerful **PI** agent framework developed by [Mario Zechner](https://github.com/badlogic). 

Special thanks to the following core libraries:
*   [**pi-mono**](https://github.com/badlogic/pi-mono) — The core monorepo for the PI ecosystem.
*   [**pi-coding-agent**](https://github.com/badlogic/pi-mono/tree/main/packages/coding-agent) — The autonomous coding logic and tools.
*   [**pi-agent-core**](https://github.com/badlogic/pi-mono/tree/main/packages/agent-core) — The backbone session and runtime management.

---

## 📄 License
Distribute under the MIT License. See [LICENSE](LICENSE) for more information.
# piwa-local
