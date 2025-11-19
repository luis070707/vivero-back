import { Router } from "express";
import { Prisma } from "@prisma/client";
import path from "path";
import fs from "fs/promises";
import { requireAuth, requireAdmin } from "../middlewares/auth";
import { upload, publicImageUrl } from "../middlewares/upload";
import { prisma } from "../prisma";
import adminReportsRouter from "./admin.reports";


const router = Router();
router.use(adminReportsRouter);


/* -------------------- Helpers -------------------- */
function toInt(v: any, def = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : def;
}
function slugify(s: string) {
  return (s || "")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}
async function deleteLocalIfUploads(url: string) {
  const m =
    /^\/?uploads\/(.+)$/.exec(url) ||
    /^https?:\/\/[^/]+\/uploads\/(.+)$/.exec(url);
  if (!m) return;
  const file = path.resolve(__dirname, "../../uploads", m[1]);
  try { await fs.unlink(file); } catch { /* ignore */ }
}
/** Une trozos Sql con separador Sql */
function sqlJoin(parts: Prisma.Sql[], sep: Prisma.Sql): Prisma.Sql {
  if (parts.length === 0) return Prisma.sql``;
  let out = parts[0];
  for (let i = 1; i < parts.length; i++) out = Prisma.sql`${out}${sep}${parts[i]}`;
  return out;
}

/* =================================================
 *  SUMMARY (cards superiores)
 * ===============================================*/
router.get("/summary", requireAuth, requireAdmin, async (_req, res, next) => {
  try {
    const [u, p, c] = await Promise.all([
      prisma.$queryRaw<{ count: bigint }[]>(Prisma.sql`SELECT COUNT(*)::bigint AS count FROM users`),
      prisma.$queryRaw<{ count: bigint }[]>(Prisma.sql`SELECT COUNT(*)::bigint AS count FROM products`),
      prisma.$queryRaw<{ count: bigint }[]>(Prisma.sql`SELECT COUNT(*)::bigint AS count FROM categories`),
    ]);
    res.json({
      users: Number(u[0]?.count ?? 0),
      products: Number(p[0]?.count ?? 0),
      categories: Number(c[0]?.count ?? 0),
    });
  } catch (e) { next(e); }
});

/* =================================================
 *  CATEGORÍAS (CRUD)
 * ===============================================*/
router.get("/categories", requireAuth, requireAdmin, async (_req, res, next) => {
  try {
    const items = await prisma.$queryRaw<{ id: number; name: string; slug: string }[]>(
      Prisma.sql`SELECT id::int, name, slug FROM categories ORDER BY id DESC`
    );
    res.json({ items });
  } catch (e) { next(e); }
});

router.post("/categories", requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const { name, slug } = req.body as { name: string; slug?: string };
    const safeSlug = slugify(slug || name);
    const rows = await prisma.$queryRaw<{ id: bigint }[]>(
      Prisma.sql`INSERT INTO categories (name, slug) VALUES (${name}, ${safeSlug}) RETURNING id::bigint AS id`
    );
    res.status(201).json({ id: Number(rows[0].id) });
  } catch (e) { next(e); }
});

router.put("/categories/:id", requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const id = toInt((req.params as any).id);
    const { name, slug } = req.body as { name?: string; slug?: string };
    const sets: Prisma.Sql[] = [];
    if (name !== undefined) sets.push(Prisma.sql`name = ${name}`);
    if (slug !== undefined) sets.push(Prisma.sql`slug = ${slugify(slug)}`);
    if (sets.length) {
      const setSql = sqlJoin(sets, Prisma.sql`, `);
      await prisma.$executeRaw(Prisma.sql`UPDATE categories SET ${setSql} WHERE id = ${id}`);
    }
    res.json({ ok: true });
  } catch (e) { next(e); }
});

router.delete("/categories/:id", requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const id = toInt((req.params as any).id);
    await prisma.$executeRaw(Prisma.sql`DELETE FROM categories WHERE id = ${id}`);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

/* =================================================
 *  PRODUCTOS (CRUD + imagen)
 * ===============================================*/

// Listar (paginado + búsqueda + filtro categoría)
router.get("/products", requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const { q, category, page = "1", size = "20" } = req.query as any;
    const pageNum = Math.max(1, toInt(page, 1));
    const sizeNum = Math.max(1, Math.min(100, toInt(size, 20)));
    const offset = (pageNum - 1) * sizeNum;

    const conds: Prisma.Sql[] = [];
    if (q) {
      const like = `%${q}%`;
      conds.push(Prisma.sql`(LOWER(p.name) LIKE LOWER(${like}) OR LOWER(COALESCE(p.description,'')) LIKE LOWER(${like}))`);
    }
    if (category) conds.push(Prisma.sql`c.slug = ${String(category)}`);

    const whereSql: Prisma.Sql = conds.length
      ? Prisma.sql`WHERE ${sqlJoin(conds, Prisma.sql` AND `)}`
      : Prisma.sql``;

    const items = await prisma.$queryRaw<{
      id: number; name: string; slug: string | null; description: string | null;
      price_cents: number; stock: number; category_id: number | null;
      category_name: string | null; category_slug: string | null; image_url: string | null;
    }[]>(
      Prisma.sql`
      SELECT
        p.id::int, p.name, p.slug, p.description,
        p.price_cents::int, p.stock::int,
        c.id::int AS category_id, c.name AS category_name, c.slug AS category_slug,
        COALESCE(pi.url,'') AS image_url
      FROM products p
      LEFT JOIN categories c ON c.id = p.category_id
      LEFT JOIN LATERAL (
        SELECT url FROM product_images
        WHERE product_id = p.id
        ORDER BY id ASC LIMIT 1
      ) pi ON TRUE
      ${whereSql}
      ORDER BY p.id DESC
      LIMIT ${sizeNum} OFFSET ${offset}`
    );

    const [{ count }] = await prisma.$queryRaw<{ count: bigint }[]>(
      Prisma.sql`SELECT COUNT(*)::bigint AS count
                 FROM products p LEFT JOIN categories c ON c.id=p.category_id
                 ${whereSql}`
    );

    res.json({ items, total: Number(count), page: pageNum, size: sizeNum });
  } catch (e) { next(e); }
});

// Crear (con imagen opcional) — precio en COP enteros
router.post("/products", requireAuth, requireAdmin, upload.single("image"), async (req, res, next) => {
  try {
    if ((req as any).fileValidationError) {
      return res.status(400).json({ error: (req as any).fileValidationError });
    }
    const b = req.body as any;
    const priceCops = toInt(b.price_cents);          // << sin *100
    const stockNum = toInt(b.stock, 0);
    const catId = b.category_id ? toInt(b.category_id) : null;
    const safeSlug = slugify(b.slug || b.name);

    const rows = await prisma.$queryRaw<{ id: bigint }[]>(
      Prisma.sql`
        INSERT INTO products (name, slug, description, price_cents, stock, category_id)
        VALUES (${b.name}, ${safeSlug}, ${b.description || null}, ${priceCops}, ${stockNum}, ${catId})
        RETURNING id::bigint AS id`
    );
    const productId = Number(rows[0].id);

    if (req.file) {
      const url = publicImageUrl(req, req.file.filename);
      await prisma.$executeRaw(Prisma.sql`INSERT INTO product_images (product_id, url) VALUES (${productId}, ${url})`);
    }

    res.status(201).json({ id: productId });
  } catch (e) { next(e); }
});

// Editar (reemplazo de imagen si se envía archivo) — precio en COP enteros
router.put("/products/:id", requireAuth, requireAdmin, upload.single("image"), async (req, res, next) => {
  try {
    if ((req as any).fileValidationError) {
      return res.status(400).json({ error: (req as any).fileValidationError });
    }
    const id = toInt((req.params as any).id);
    const b = req.body as any;

    const sets: Prisma.Sql[] = [];
    if (b.name !== undefined) sets.push(Prisma.sql`name = ${b.name}`);
    if (b.slug !== undefined) sets.push(Prisma.sql`slug = ${slugify(b.slug)}`);
    if (b.description !== undefined) sets.push(Prisma.sql`description = ${b.description}`);
    if (b.price_cents !== undefined) sets.push(Prisma.sql`price_cents = ${toInt(b.price_cents)}`); // << sin *100
    if (b.stock !== undefined) sets.push(Prisma.sql`stock = ${toInt(b.stock)}`);
    if (b.category_id !== undefined) {
      const cid = b.category_id ? toInt(b.category_id) : null;
      sets.push(Prisma.sql`category_id = ${cid}`);
    }

    if (sets.length) {
      const setSql = sqlJoin(sets, Prisma.sql`, `);
      await prisma.$executeRaw(Prisma.sql`UPDATE products SET ${setSql} WHERE id = ${id}`);
    }

    if (req.file) {
      const prev = await prisma.$queryRaw<{ url: string }[]>(
        Prisma.sql`SELECT url FROM product_images WHERE product_id = ${id}`
      );
      await prisma.$executeRaw(Prisma.sql`DELETE FROM product_images WHERE product_id = ${id}`);
      const url = publicImageUrl(req, req.file.filename);
      await prisma.$executeRaw(Prisma.sql`INSERT INTO product_images (product_id, url) VALUES (${id}, ${url})`);
      await Promise.all(prev.map((p: { url: string }) => deleteLocalIfUploads(p.url)));
    }

    res.json({ ok: true });
  } catch (e) { next(e); }
});

// Eliminar (borra imagen local si corresponde)
router.delete("/products/:id", requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const id = toInt((req.params as any).id);

    const prev = await prisma.$queryRaw<{ url: string }[]>(
      Prisma.sql`SELECT url FROM product_images WHERE product_id = ${id}`
    );

    await prisma.$executeRaw(Prisma.sql`DELETE FROM wishlist WHERE product_id = ${id}`);
    await prisma.$executeRaw(Prisma.sql`DELETE FROM product_images WHERE product_id = ${id}`);
    await prisma.$executeRaw(Prisma.sql`DELETE FROM products WHERE id = ${id}`);

    await Promise.all(prev.map((p: { url: string }) => deleteLocalIfUploads(p.url)));
    res.json({ ok: true });
  } catch (e) { next(e); }
});

export default router;
