import * as fs from "fs";
import * as path from "path";
import { intro, text, outro, isCancel, cancel } from "@clack/prompts";
import color from "picocolors";

const CONFIG_FILE = path.resolve(process.cwd(), "piwa.config.json");

export interface PiwaConfig {
  agentNumber: string;
  ownerNumber: string;
}

export function deleteConfig() {
  if (fs.existsSync(CONFIG_FILE)) {
    fs.unlinkSync(CONFIG_FILE);
  }
}

export async function loadOrPromptConfig(): Promise<PiwaConfig> {
  if (fs.existsSync(CONFIG_FILE)) {
    try {
      const data = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8"));
      if (data.agentNumber && data.ownerNumber) {
        return data as PiwaConfig;
      }
    } catch (e) {
      console.warn("⚠️ Could not read existing piwa.config.json. Prompting again.");
    }
  }

  console.clear();
  intro(color.bgCyan(color.black(" PIWA (Pi WhatsApp Agent) Setup ")));

  const agentNumber = await text({
    message: "What is the BOT's WhatsApp number?",
    placeholder: "e.g. 2347066499537",
    validate(value) {
      if (!value) return color.red("Please enter a valid number.");
      const stripped = value.replace(/\D/g, "");
      if (stripped.length === 0) return color.red("Please enter a valid number.");
      if (stripped.length < 10 || stripped.length > 15) {
        return color.red("Invalid length. Did you forget the country code? (10-15 digits)");
      }
    },
  });

  if (isCancel(agentNumber)) {
    cancel("Setup cancelled.");
    process.exit(0);
  }

  const ownerNumber = await text({
    message: "What is YOUR personal WhatsApp number? (Only you can command the bot)",
    placeholder: "e.g. 2347088436930",
    validate(value) {
      if (!value) return color.red("Please enter a valid number.");
      const stripped = value.replace(/\D/g, "");
      if (stripped.length === 0) return color.red("Please enter a valid number.");
      if (stripped.length < 10 || stripped.length > 15) {
        return color.red("Invalid length. Did you forget the country code? (10-15 digits)");
      }
    },
  });

  if (isCancel(ownerNumber)) {
    cancel("Setup cancelled.");
    process.exit(0);
  }

  const config: PiwaConfig = {
    agentNumber: (agentNumber as string).replace(/\D/g, ""),
    ownerNumber: (ownerNumber as string).replace(/\D/g, "")
  };

  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));

  outro(color.green("✅ Configuration saved locally!"));
  return config;
}
