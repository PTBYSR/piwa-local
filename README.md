<p align="center">
  <img src="piwa-hero.png" alt="PIWA" width="200"/>
</p>

# PIWA

Interact with your machine via a coding agent on WhatsApp.

## Download

### Windows

[Download PIWA Setup for Windows](https://github.com/PTBYSR/piwa/releases/download/v1.0.0/Piwa.Setup.1.0.0.exe)

### macOS & Linux

Coming soon.

---

## Get started

To start the agent bridge on your machine:

```bash
piwa
```

### CLI Commands
* `piwa` — Starts the agent bridge and TUI.
* `piwa status` — Shows current pairing and configuration status.
* `piwa help` — Shows the help menu.

You'll be guided through a zero-friction pairing process to link your WhatsApp account on your first run.

## Features

- **Hardware-Aware Safety:** Proactively prevents running intensive agent tasks that exceed your system's hardware limits.
- **Instant Public URLs:** Generates secure, public URLs for your agent endpoints automatically.
- **Real-Time Telemetry:** Monitor agent performance (CPU, GPU, RAM) directly from the desktop interface.
- **Dual Interface:** Run the native terminal UI and the WhatsApp bridge simultaneously.

## Development

### Desktop App
```bash
cd piwa-desktop
npm install
npm run dev
```

### CLI Bridge
```bash
npm install
npm start
```

## Requirements

- **Runtime:** Node.js (v18.0.0 or higher).
- **WhatsApp:** A secondary number for the Agent and your personal number for the Owner.
- **API Keys:** Supports Google Gemini, Anthropic, and OpenAI.

## Authentication

PIWA uses the native `pi-coding-agent` for authentication. It will automatically find existing keys in `~/.pi/agent/auth.json`. You can also use `/login` in the terminal to connect OAuth providers.

## License

MIT
