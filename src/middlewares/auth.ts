import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";

const JWT_SECRET = process.env.JWT_SECRET || "dev_secret_change_me";

export type AuthUser = {
  id: number;
  email: string;
  username?: string | null;
  is_admin?: boolean;
  role?: string | null;
};

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  try {
    const h = req.headers.authorization || "";
    const [, token] = h.split(" ");
    if (!token) return res.status(401).json({ error: "No autorizado" });
    const payload = jwt.verify(token, JWT_SECRET) as AuthUser;
    req.user = {
  id: Number((payload as any).id),
  email: (payload as any).email,
  username: (payload as any).username ?? null,
  is_admin: !!(payload as any).is_admin,
  role: (payload as any).role ?? null,
    };
    next();
  } catch {
    return res.status(401).json({ error: "Token inválido" });
  }
}

export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (!req.user?.is_admin) return res.status(403).json({ error: "Requiere rol admin" });
  next();
}
