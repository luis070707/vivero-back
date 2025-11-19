// src/routes/products.ts
import { Router, type Request, type Response } from "express";
import { prisma } from "../prisma"; // OJO: tu prisma.ts exporta { prisma }

const router = Router();

type ProductDTO = {
  id: number;
  name: string;
  description: string;
  price_cents: number;       // En tu app esto son PESOS (10.000 => 10000), no multipliques por 100
  stock: number;
  image_url: string | null;  // Tomada de product_images.url
  category_name: string;
};

function rowToDTO(row: any): ProductDTO {
  return {
    id: Number(row.id),
    name: String(row.name ?? ""),
    description: String(row.description ?? ""),
    price_cents: Number(row.price_cents ?? 0), // PESOS
    stock: Number(row.stock ?? 0),
    image_url: row.image_url ?? null,
    category_name: String(row.category_name ?? ""),
  };
}

/**
 * GET /api/products
 * Soporta ?q, ?category (slug), ?page, ?pageSize, ?ids=1,2,3
 * Devuelve description, price_cents (PESOS) y la PRIMERA imagen (product_images.url).
 */
router.get("/api/products", async (req: Request, res: Response) => {
  try {
    const idsParam = String(req.query.ids ?? "").trim();
    const q        = String(req.query.q ?? "").trim();
    const category = String(req.query.category ?? "").trim();
    const page     = Math.max(1, parseInt(String(req.query.page ?? "1"), 10));
    const pageSize = Math.max(1, Math.min(100, parseInt(String(req.query.pageSize ?? "48"), 10)));

    // Base: une categoría y toma la primera imagen por id
    const baseSelect = `
      SELECT
        p.id,
        p.name,
        COALESCE(p.description, '') AS description,
        COALESCE(p.price_cents, 0)  AS price_cents,
        COALESCE(p.stock, 0)        AS stock,
        img.url                     AS image_url,    -- <- viene de product_images.url
        COALESCE(c.name, '')        AS category_name
      FROM products p
      LEFT JOIN categories c ON c.id = p.category_id
      LEFT JOIN LATERAL (
        SELECT pi.url
        FROM product_images pi
        WHERE pi.product_id = p.id
        ORDER BY pi.id ASC
        LIMIT 1
      ) img ON TRUE
    `;

    const whereParts: string[] = [];
    const params: any[] = [];
    let i = 1;

    // /api/products?ids=1,2,3 (para hidratar tarjetas sin paginar)
    if (idsParam) {
      const ids = idsParam
        .split(",")
        .map(s => Number(s.trim()))
        .filter(n => Number.isFinite(n));
      if (!ids.length) return res.json({ total: 0, items: [] });

      const ph = ids.map((_, idx) => `$${i + idx}`).join(", ");
      whereParts.push(`p.id IN (${ph})`);
      params.push(...ids);
      i += ids.length;

      const sql = `${baseSelect} ${whereParts.length ? "WHERE " + whereParts.join(" AND ") : ""} ORDER BY p.id DESC`;
      const rows: any[] = await prisma.$queryRawUnsafe(sql, ...params);
      return res.json({ total: rows.length, items: rows.map(rowToDTO) });
    }

    if (q) {
      whereParts.push(`(p.name ILIKE $${i} OR p.description ILIKE $${i})`);
      params.push(`%${q}%`);
      i++;
    }
    if (category) {
      whereParts.push(`c.slug = $${i}`);
      params.push(category);
      i++;
    }

    const whereSQL = whereParts.length ? "WHERE " + whereParts.join(" AND ") : "";

    // total
    const countSQL = `
      SELECT COUNT(*)::int AS count
      FROM products p
      LEFT JOIN categories c ON c.id = p.category_id
      ${whereSQL}
    `;
    const countRows: any[] = await prisma.$queryRawUnsafe(countSQL, ...params);
    const total = Number(countRows?.[0]?.count ?? 0);

    // page
    const offset = (page - 1) * pageSize;
    const listSQL = `
      ${baseSelect}
      ${whereSQL}
      ORDER BY p.id DESC
      LIMIT $${i} OFFSET $${i + 1}
    `;
    const listRows: any[] = await prisma.$queryRawUnsafe(listSQL, ...params, pageSize, offset);

    res.json({ total, items: listRows.map(rowToDTO) });
  } catch (err: any) {
    console.error("[products] list error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

/**
 * GET /api/products/:id
 * Detalle para Quick View — trae description, price_cents (PESOS) y la primera imagen.
 */
router.get("/api/products/:id", async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "Bad id" });

    const sql = `
      SELECT
        p.id,
        p.name,
        COALESCE(p.description, '') AS description,
        COALESCE(p.price_cents, 0)  AS price_cents,
        COALESCE(p.stock, 0)        AS stock,
        img.url                     AS image_url,    -- <- product_images.url
        COALESCE(c.name, '')        AS category_name
      FROM products p
      LEFT JOIN categories c ON c.id = p.category_id
      LEFT JOIN LATERAL (
        SELECT pi.url
        FROM product_images pi
        WHERE pi.product_id = p.id
        ORDER BY pi.id ASC
        LIMIT 1
      ) img ON TRUE
      WHERE p.id = $1
      LIMIT 1
    `;
    const rows: any[] = await prisma.$queryRawUnsafe(sql, id);
    if (!rows.length) return res.status(404).json({ error: "Not Found" });

    res.json({ product: rowToDTO(rows[0]) });
  } catch (err: any) {
    console.error("[products] get error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

export default router;
export { router as productsRouter };
