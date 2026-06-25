import "dotenv/config";
import { createApp } from "./app.js";
import { getEnv } from "./config/env.js";

const app = createApp();
const { PORT } = getEnv();

app.listen(PORT, () => {
  console.log(`Obi's Chops API listening on http://localhost:${PORT}`);
});
