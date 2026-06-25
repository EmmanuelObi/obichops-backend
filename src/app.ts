import cors from "cors";
import express from "express";
import { connectDb } from "./db/connect.js";
import { errorHandler } from "./middleware/errorHandler.js";
import adminRouter from "./routes/admin.js";
import authRouter from "./routes/auth.js";
import menuWeeksRouter from "./routes/menu-weeks.js";
import ordersRouter from "./routes/orders.js";
import platformRouter from "./routes/platform.js";

export function createApp() {
  const app = express();

  app.use(cors());
  app.use(express.json());

  app.get("/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  app.use(async (_req, _res, next) => {
    try {
      await connectDb();
      next();
    } catch (err) {
      next(err);
    }
  });

  app.use("/auth", authRouter);
  app.use("/platform", platformRouter);
  app.use("/menu-weeks", menuWeeksRouter);
  app.use("/orders", ordersRouter);
  app.use("/admin", adminRouter);

  app.use(errorHandler);

  return app;
}
