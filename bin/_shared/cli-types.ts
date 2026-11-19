import type { createClient } from "./http.js";

export type Client = ReturnType<typeof createClient>;
export type Flags = Record<string, string | boolean>;
