import { Request, Response, NextFunction } from "express";
import * as jwt from "jsonwebtoken";
import { config } from "../config.js";

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    return res.status(401).json({ error: "unauthorized" });
  }

  const token = authHeader.slice(7);
  try {
    const decoded = jwt.verify(token, config.jwtSecret) as any;
    if (decoded.type !== "access") {
      return res.status(401).json({ error: "invalid_token" });
    }
    // Attach email to request for use in handlers
    (req as any).userEmail = decoded.email;
    next();
  } catch {
    return res.status(401).json({ error: "invalid_token" });
  }
}
