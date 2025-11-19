// src/routes/wishlist.ts
import { Router } from "express";
import { prisma } from "../prisma";
import { requireAuth } from "../middlewares/auth";

const r = Router();

// GET /api/wishlist  -> lista productos en favoritos del usuario
r.get("/", requireAuth, async (req, res, next) => {
  try {
    const uid = Number(req.user?.id);
    if (!Number.isFinite(uid)) return res.status(400).json({ error: "Usuario inválido" });

    const items = await prisma.$queryRaw<any[]>`
      SELECT
        p.id::int AS id,
        p.name,
        p.slug,
        p.description,
        p.price_cents,
        p.stock,
        COALESCE(JSON_AGG(pi.url) FILTER (WHERE pi.url IS NOT NULL), '[]') AS images
      FROM wishlist w
      JOIN products p       ON p.id = w.product_id
      LEFT JOIN product_images pi ON pi.product_id = p.id
      WHERE w.user_id = ${uid}
      GROUP BY p.id
      ORDER BY p.name ASC
    `;

    res.json({ items });
  } catch (err) {
    next(err);
  }
});

// POST /api/wishlist/:productId  -> añade a favoritos
r.post("/:productId", requireAuth, async (req, res, next) => {
  try {
    const uid = Number(req.user?.id);
    const pid = Number(req.params.productId);
    if (!Number.isFinite(uid) || !Number.isFinite(pid)) {
      return res.status(400).json({ error: "Parámetros inválidos" });
    }

    // opcional: verificar que el producto exista
    const existsProd = await prisma.$queryRaw<Array<{ id: number }>>`
      SELECT id::int AS id FROM products WHERE id = ${pid} LIMIT 1
    `;
    if (!existsProd.length) return res.status(404).json({ error: "Producto no existe" });

    // evita duplicados (si tienes UNIQUE(user_id,product_id) esto es seguro; si no, igual lo evitamos)
    const already = await prisma.$queryRaw<Array<{ exists: boolean }>>`
      SELECT EXISTS(
        SELECT 1 FROM wishlist WHERE user_id = ${uid} AND product_id = ${pid}
      ) AS exists
    `;
    if (already[0]?.exists) return res.json({ added: false, exists: true });

    await prisma.$queryRaw`
      INSERT INTO wishlist (user_id, product_id) VALUES (${uid}, ${pid})
    `;

    res.json({ added: true });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/wishlist/:productId  -> quita de favoritos
r.delete("/:productId", requireAuth, async (req, res, next) => {
  try {
    const uid = Number(req.user?.id);
    const pid = Number(req.params.productId);
    if (!Number.isFinite(uid) || !Number.isFinite(pid)) {
      return res.status(400).json({ error: "Parámetros inválidos" });
    }

    // usamos RETURNING para saber si quitó algo
    const removed = await prisma.$queryRaw<any[]>`
      DELETE FROM wishlist
      WHERE user_id = ${uid} AND product_id = ${pid}
      RETURNING product_id
    `;

    res.json({ removed: removed.length > 0 });
  } catch (err) {
    next(err);
  }
});

export default r;
