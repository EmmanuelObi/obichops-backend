import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { submitOnboardingRequest } from "../services/onboarding.js";

const router = Router();

const submitSchema = z.object({
  businessName: z.string().min(2).max(120).trim(),
  slug: z
    .string()
    .min(2)
    .max(60)
    .trim()
    .regex(/^[a-z0-9-]+$/, "Slug must be lowercase alphanumeric with hyphens"),
  contactName: z.string().min(2).max(120).trim(),
  email: z.string().email(),
  phone: z.string().max(40).trim().optional(),
  teamSize: z.string().max(40).trim().optional(),
  notes: z.string().max(1000).trim().optional(),
});

router.post(
  "/",
  asyncHandler(async (req, res) => {
    const body = submitSchema.parse(req.body);

    try {
      const request = await submitOnboardingRequest(body);
      res.status(201).json({ request });
    } catch (err) {
      if (err instanceof Error) {
        if (err.message === "SLUG_TAKEN") {
          res.status(409).json({
            error: "That chopspace name is already in use. Try a different slug.",
          });
          return;
        }
        if (err.message === "REQUEST_EXISTS") {
          res.status(409).json({
            error:
              "A pending request already exists for this email or slug. We'll be in touch soon.",
          });
          return;
        }
      }
      throw err;
    }
  }),
);

export default router;
