import type { ErrorRequestHandler } from "express";
import { ZodError } from "zod";

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof ZodError) {
    res.status(400).json({
      error: "Validation failed",
      details: err.flatten(),
    });
    return;
  }
  if (err && typeof err === "object" && "code" in err && err.code === 11000) {
    res.status(409).json({ error: "Duplicate entry" });
    return;
  }
  console.error(err);
  res.status(500).json({ error: "Internal server error" });
};
