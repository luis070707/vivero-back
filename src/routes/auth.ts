// src/routes/auth.ts
import { Router, type Request, type Response, type NextFunction } from "express";
import { prisma } from "../prisma";
import { signToken } from "../utils/jwt";
import bcrypt from "bcrypt";
import validator from "validator";

const r = Router();

/* Utilidades */
function normEmail(raw: string) {
  const e = String(raw || "").trim();
  return validator.isEmail(e)
    ? validator.normalizeEmail(e, { gmail_remove_dots: false }) || ""
    : "";
}
function isEmail(v: string) { return validator.isEmail(v); }
function toSafeUser(row: any) {
  return {
    id: Number(row.id),
    email: row.email as string,
    username: row.username as (string | null),
    is_admin: !!row.is_admin,
    role: row.role as (string | null),
  };
}

/* ============= REGISTER ============= */
r.post("/register", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { email, username, password } = req.body || {};

    const emailNorm = normEmail(email ?? "");
    const uname = (String(username || "").trim()) || (emailNorm.split("@")[0] || "");
    const pass = String(password || "");

    if (!emailNorm || pass.length < 6) {
      return res.status(400).json({ error: "Datos inválidos" });
    }

    // ¿ya existe ese email o username?
    const dupByEmail = await prisma.$queryRaw<Array<{ exists: boolean }>>`
      SELECT EXISTS(SELECT 1 FROM users WHERE LOWER(email) = LOWER(${emailNorm})) AS exists
    `;
    if (dupByEmail[0]?.exists) {
      return res.status(409).json({ error: "Email ya registrado" });
    }

    const dupByUser = await prisma.$queryRaw<Array<{ exists: boolean }>>`
      SELECT EXISTS(SELECT 1 FROM users WHERE LOWER(username) = LOWER(${uname})) AS exists
    `;
    if (dupByUser[0]?.exists) {
      return res.status(409).json({ error: "Usuario ya registrado" });
    }

    const hash = await bcrypt.hash(pass, 10);

    // Inserta y devuelve el usuario
    const rows = await prisma.$queryRaw<Array<any>>`
      INSERT INTO users (email, username, password_hash, role, is_admin, created_at, updated_at)
      VALUES (${emailNorm}, ${uname}, ${hash}, 'USER', false, NOW(), NOW())
      RETURNING id::bigint AS id, email, username, is_admin, role
    `;
    const userSafe = toSafeUser(rows[0]);

    const token = signToken(userSafe, { expiresIn: "7d" });

    return res.status(201).json({ ok: true, user: userSafe, token });
  } catch (e) { next(e); }
});

/* ============== LOGIN ============== */
/*
  Acepta body con:
  - identifier: puede ser email o username (opcionalmente puedes mandar email o username por separado)
  - password
*/
r.post("/login", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { identifier, id, email, username, password } = req.body || {};
    const whoRaw = String(identifier ?? id ?? email ?? username ?? "").trim();
    const pass = String(password || "");

    if (!whoRaw || pass.length < 1) {
      return res.status(400).json({ error: "Credenciales inválidas" });
    }

    const emailNorm = isEmail(whoRaw) ? normEmail(whoRaw) : "";

    // Consulta simple SIN Prisma.sql para evitar tus errores de tipos
    let rows: Array<any> = [];
    if (emailNorm) {
      rows = await prisma.$queryRaw<Array<any>>`
        SELECT
          u.id::bigint AS id, u.email, u.username, u.password_hash,
          u.is_admin, u.role
        FROM users u
        WHERE LOWER(u.email) = LOWER(${emailNorm})
        LIMIT 1
      `;
    } else {
      rows = await prisma.$queryRaw<Array<any>>`
        SELECT
          u.id::bigint AS id, u.email, u.username, u.password_hash,
          u.is_admin, u.role
        FROM users u
        WHERE LOWER(u.username) = LOWER(${whoRaw})
        LIMIT 1
      `;
    }

    const user = rows[0];
    if (!user) {
      return res.status(400).json({ error: "Credenciales inválidas" });
    }

    const ok = await bcrypt.compare(pass, user.password_hash);
    if (!ok) {
      return res.status(400).json({ error: "Credenciales inválidas" });
    }

    const userSafe = toSafeUser(user);
    const token = signToken(userSafe, { expiresIn: "7d" });

    return res.json({ ok: true, user: userSafe, token });
  } catch (e) { next(e); }
});

/* ============== /me opcional ============== */
r.get("/me", async (req: Request, res: Response) => {
  return res.json({ ok: true }); 
});

export default r;
