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

  if (!isSameOrigin(request)) {
    return privateJson({ error: "Use the PartMatch website." }, 403);
  }

  const { id } = await params;

  if (!uuidPattern.test(id)) {
    return privateJson({ error: "Not found." }, 404);
  }

  try {
    const { pool, driver } = await getSqlServerConnection();

    const result = await pool
      .request()
      .input("partId", driver.UniqueIdentifier, id)
      .query(`
        SET XACT_ABORT ON;

        BEGIN TRANSACTION;

        IF EXISTS (
          SELECT 1
          FROM dbo.RequestMatches WITH (UPDLOCK, HOLDLOCK)
          WHERE PartId = @partId
        )
        BEGIN
          ROLLBACK TRANSACTION;
          SELECT 'linked' AS Result;
        END
        ELSE
        BEGIN
          DELETE FROM dbo.InventoryParts
          WHERE PartId = @partId;

          IF @@ROWCOUNT = 0
            SELECT 'not_found' AS Result;
          ELSE
            SELECT 'deleted' AS Result;

          COMMIT TRANSACTION;
        END
      `);

    const outcome = result.recordset[0]?.Result;

    if (outcome === "linked") {
      return privateJson(
        {
          error:
            "This inventory part is linked to a customer match and cannot be deleted.",
        },
        409,
      );
    }

    if (outcome === "not_found") {
      return privateJson(
        { error: "Inventory part not found." },
        404,
      );
    }

    if (outcome !== "deleted") {
      return privateJson(
        { error: "The inventory part could not be deleted." },
        500,
      );
    }

    return privateJson({ ok: true }, 200);
  } catch (error) {
    console.error("Inventory deletion failed", {
      category: "storage",
    });

    if (error instanceof SqlServerConfigurationError) {
      return privateJson(
        { error: "The inventory service is not configured yet." },
        503,
      );
    }

    const sqlError = error as {
      number?: number;
      originalError?: { info?: { number?: number } };
    };

    const errorNumber =
      sqlError.number ?? sqlError.originalError?.info?.number;

    if (errorNumber === 547) {
      return privateJson(
        {
          error:
            "This part is referenced by another record and cannot be deleted.",
        },
        409,
      );
    }

    return privateJson(
      { error: "The inventory part could not be deleted." },
      500,
    );
  }
}

function secureJson(body: unknown, options?: { status: number }) {
  return privateJson(body, options?.status ?? 200);
}
