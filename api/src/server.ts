import { createApp } from "./app.js";
import { env } from "./core/config/env.js";
import { unscopedDb } from "./core/db/client.js";

const server = createApp().listen(env.PORT, () => {
  console.log(`API listening on http://localhost:${env.PORT}`);
});

async function shutdown() {
  server.close();
  await unscopedDb.$disconnect();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
