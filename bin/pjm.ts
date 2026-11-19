#!/usr/bin/env -S node --import tsx
import { parseArgs } from "./_shared/args.js";
import { parseTicketDiscoveryArgs } from "./_shared/ticket-discovery.js";
import { isMaintenanceCommand, parseTicketMaintenanceArgs, type MaintenanceArgs } from "./_shared/ticket-maintenance.js";
import { CONFIG_PATH, DEFAULT_CONFIG, loadConfig } from "./_shared/cli-config.js";
import { ensureConfigDir, writeJsonFile } from "./_shared/fs-config.js";
import { createClient } from "./_shared/http.js";
import { printResult, printError } from "./_shared/output.js";
import { cmdCapabilities } from "./commands/capabilities.js";
import { cmdProjectList, cmdProjectCreate } from "./commands/project.js";
import { cmdEpicList, cmdEpicCreate } from "./commands/epic.js";
import {
  cmdTicketList,
  cmdTicketCreate,
  cmdTicketGet,
  cmdTicketUpdate,
  cmdTicketTransition,
  cmdTicketTake,
  cmdTicketRelease,
  cmdTicketDone,
  cmdTicketArchive,
  cmdTicketNext,
  cmdTicketMine,
} from "./commands/ticket.js";
import { cmdTicketDepList, cmdTicketDepAdd, cmdTicketDepRemove } from "./commands/ticket-dependencies.js";
import { cmdTicketDiscovery } from "./commands/ticket-discovery.js";
import { cmdTicketMaintenance } from "./commands/ticket-maintenance.js";

// ── Main dispatcher ─────────────────────────────────────────────────

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  let { positionals, flags } = parseArgs(argv);
  let maintenance: MaintenanceArgs | undefined;
  if (positionals[0] === "ticket" && isMaintenanceCommand(positionals[1])) {
    maintenance = parseTicketMaintenanceArgs(argv, positionals[1]);
    ({positionals, flags} = maintenance);
  } else if (positionals[0] === "ticket" && (positionals[1] === "annotation-facets" || positionals[1] === "search")) {
    ({positionals, flags} = parseTicketDiscoveryArgs(argv, positionals[1]));
  }

  // Output options (parsed globally)
  const outputOpts = {
    pretty: flags["pretty"] === true,
    format: typeof flags["format"] === "string" ? flags["format"] : undefined,
  };

  const resource = positionals[0];
  const action = positionals[1];
  if (flags["origin-json"] !== undefined && (resource !== "ticket" || action !== "create")) {
    printError("--origin-json is create-only; origin is immutable");
  }

  // Special commands
  if (resource === "init") {
    ensureConfigDir();
    writeJsonFile(CONFIG_PATH, DEFAULT_CONFIG);
    process.stdout.write(`Config written to ${CONFIG_PATH}\n`);
    return;
  }

  // Build HTTP client from config
  const config = loadConfig();
  const client = createClient(config);

  let result: unknown;

  switch (resource) {
    case "capabilities":
      result = await cmdCapabilities(client);
      break;

    case "project":
      switch (action) {
        case "list":
          result = await cmdProjectList(client);
          break;
        case "create":
          result = await cmdProjectCreate(client, flags);
          break;
        default:
          printError("Usage: pjm project <list|create>");
      }
      break;

    case "epic":
      switch (action) {
        case "list":
          result = await cmdEpicList(client, flags);
          break;
        case "create":
          result = await cmdEpicCreate(client, flags);
          break;
        default:
          printError("Usage: pjm epic <list|create>");
      }
      break;

    case "ticket": {
      switch (action) {
        case "maintenance-list":
        case "maintenance-archive":
        case "maintenance-restore":
        case "maintenance-receipt":
          if (!maintenance) printError("Invalid maintenance command");
          result = await cmdTicketMaintenance(client, maintenance);
          break;
        case "list":
          result = await cmdTicketList(client, flags);
          break;
        case "annotation-facets":
        case "search":
          result = await cmdTicketDiscovery(client, flags, action);
          break;
        case "create":
          result = await cmdTicketCreate(client, flags);
          break;
        case "get": {
          const id = positionals[2];
          if (!id) printError("Usage: pjm ticket get <id>");
          result = await cmdTicketGet(client, id);
          break;
        }
        case "update": {
          const id = positionals[2];
          if (!id) printError("Usage: pjm ticket update <id> [--flags]");
          result = await cmdTicketUpdate(client, id, flags);
          break;
        }
        case "transition": {
          const id = positionals[2];
          if (!id) printError("Usage: pjm ticket transition <id> --status <S>");
          result = await cmdTicketTransition(client, id, flags);
          break;
        }
        case "take": {
          const id = positionals[2];
          if (!id) printError("Usage: pjm ticket take <id>");
          result = await cmdTicketTake(client, id);
          break;
        }
        case "release": {
          const id = positionals[2];
          if (!id) printError("Usage: pjm ticket release <id>");
          result = await cmdTicketRelease(client, id);
          break;
        }
        case "done": {
          const id = positionals[2];
          if (!id) printError("Usage: pjm ticket done <id>");
          result = await cmdTicketDone(client, id);
          break;
        }
        case "archive": {
          const id = positionals[2];
          if (!id) printError("Usage: pjm ticket archive <id>");
          result = await cmdTicketArchive(client, id);
          break;
        }
        case "next":
          result = await cmdTicketNext(client);
          break;
        case "mine":
          result = await cmdTicketMine(client, flags);
          break;
        case "dep": {
          const depAction = positionals[2];
          const depTicketId = positionals[3];
          switch (depAction) {
            case "list":
              if (!depTicketId) printError("Usage: pjm ticket dep list <ticketId>");
              result = await cmdTicketDepList(client, depTicketId);
              break;
            case "add":
              if (!depTicketId) printError("Usage: pjm ticket dep add <ticketId> --on <id>");
              result = await cmdTicketDepAdd(client, depTicketId, flags);
              break;
            case "remove":
              if (!depTicketId) printError("Usage: pjm ticket dep remove <ticketId> --on <id>");
              result = await cmdTicketDepRemove(client, depTicketId, flags);
              break;
            default:
              printError("Usage: pjm ticket dep <list|add|remove>");
          }
          break;
        }
        default:
          printError(
            "Usage: pjm ticket <list|annotation-facets|search|maintenance-list|maintenance-archive|maintenance-restore|maintenance-receipt|create|get|update|transition|take|release|done|archive|next|mine|dep>",
          );
      }
      break;
    }

    default:
      printError(
        "Usage: pjm <init|capabilities|project|epic|ticket> [action] [flags]",
        resource ? `Unknown resource: ${resource}` : "No command given",
      );
  }

  if (result !== undefined) {
    printResult(result, outputOpts);
  }
}

main().catch((e: unknown) => {
  printError("Fatal error", e instanceof Error ? e.message : String(e));
});
