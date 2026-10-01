import { privateJson, isSameOrigin } from "@/lib/http";
import { requireAccess, uuidPattern } from "@/lib/request-access";
import {
  getSqlServerConnection,
  SqlServerConfigurationError,
} from "@/lib/sql-server";

export const runtime = "nodejs";

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const access = await requireAccess(undefined, true);
  if (access.response) return access.response;
  if (!isSameOrigin(request)) return privateJson({ error: "Use the PartMatch website." }, 403);

  const { id } = await params;
  if (!uuidPattern.test(id)) return privateJson({ error: "Not found." }, 404);

  try {
    const body = await request.json();

    const price = Number(body.price);
    const available = body.available;

    if (!Number.isFinite(price) || price < 0) {
      return secureJson(
        { error: "Enter a valid price." },
        { status: 400 },
      );
    }

    if (typeof available !== "boolean") {
      return secureJson(
        { error: "Availability must be true or false." },
        { status: 400 },
      );
    }

    const { pool, driver } = await getSqlServerConnection();

    const result = await pool
      .request()
      .input("partId", driver.UniqueIdentifier, id)
      .input("price", driver.Decimal(10, 2), price)
      .input("available", driver.Bit, available)
      .query(`
        UPDATE dbo.InventoryParts
        SET
          Price = @price,
          IsAvailable = @available,
          SellerConfirmed = 1,
          LastUpdatedAt = SYSUTCDATETIME()
        WHERE PartId = @partId;

        SELECT @@ROWCOUNT AS UpdatedRows;
      `);

    if (!result.recordset[0]?.UpdatedRows) {
      return secureJson(
        { error: "Inventory part not found." },
        { status: 404 },
      );
    }

    return secureJson({ ok: true });
  } catch (error) {
    console.error("Inventory update failed", { category: "storage" });

    if (error instanceof SqlServerConfigurationError) {
      return secureJson(
        { error: "The inventory service is not configured yet." },
        { status: 503 },
      );
    }

    return secureJson(
      { error: "The inventory part could not be updated." },
      { status: 500 },
    );
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const access = await requireAccess(undefined, true);
  if (access.response) return access.response;
  if (!isSameOrigin(request)) return privateJson({ error: "Use the PartMatch website." }, 403);

  const { id } = await params;
  if (!uuidPattern.test(id)) return privateJson({ error: "Not found." }, 404);

  try {
    const { pool, driver } = await getSqlServerConnection();

    const result = await pool
      .request()
      .input("partId", driver.UniqueIdentifier, id)
      .query(`
        DELETE FROM dbo.InventoryParts
        WHERE PartId = @partId;

        SELECT @@ROWCOUNT AS DeletedRows;
      `);

    if (!result.recordset[0]?.DeletedRows) {
      return secureJson(
        { error: "Inventory part not found." },
        { status: 404 },
      );
    }

    return secureJson({ ok: true });
  } catch (error) {
    console.error("Inventory deletion failed", { category: "storage" });

    if (error instanceof SqlServerConfigurationError) {
      return secureJson(
        { error: "The inventory service is not configured yet." },
        { status: 503 },
      );
    }

    return secureJson(
      { error: "The inventory part could not be deleted." },
      { status: 500 },
    );
  }
}
function secureJson(body: unknown, options?: { status: number }) {
  return privateJson(body, options?.status ?? 200);
}
