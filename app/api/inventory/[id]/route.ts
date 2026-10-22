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

  if (!isSameOrigin(request)) {
    return privateJson({ error: "Use the PartMatch website." }, 403);
  }

  const { id } = await params;
  if (!uuidPattern.test(id)) {
    return privateJson({ error: "Not found." }, 404);
  }

  try {
    const body = await request.json();

    const partName = String(body.partName ?? "").trim();
    const headlightSide = String(body.headlightSide ?? "");
    const condition = String(body.condition ?? "");
    const price = Number(body.price);
    const available = body.available;
    const yearFrom = Number(body.yearFrom);
    const yearTo = Number(body.yearTo);

    if (!partName || partName.length > 150) {
      return privateJson({ error: "Enter a valid part name." }, 400);
    }

    if (
      !["Left (driver side)", "Right (passenger side)"].includes(headlightSide)
    ) {
      return privateJson({ error: "Select a valid headlight side." }, 400);
    }

    if (!["new", "used", "refurbished"].includes(condition)) {
      return privateJson({ error: "Select a valid condition." }, 400);
    }

    if (!Number.isFinite(price) || price < 0 || price > 99999999.99) {
      return privateJson({ error: "Enter a valid price." }, 400);
    }

    if (typeof available !== "boolean") {
      return privateJson({ error: "Select a valid availability." }, 400);
    }

    if (
      !Number.isInteger(yearFrom) ||
      !Number.isInteger(yearTo) ||
      yearFrom < 2007 ||
      yearTo > 2014 ||
      yearFrom > yearTo
    ) {
      return privateJson({ error: "Enter a valid year range." }, 400);
    }

    const { pool, driver } = await getSqlServerConnection();

    const result = await pool
      .request()
      .input("partId", driver.UniqueIdentifier, id)
      .input("partName", driver.NVarChar(150), partName)
      .input("headlightSide", driver.NVarChar(30), headlightSide)
      .input("condition", driver.VarChar(20), condition)
      .input("price", driver.Decimal(10, 2), price)
      .input("available", driver.Bit, available)
      .input("yearFrom", driver.SmallInt, yearFrom)
      .input("yearTo", driver.SmallInt, yearTo)
      .query(`
        SET XACT_ABORT ON;
        BEGIN TRANSACTION;

        IF NOT EXISTS (
          SELECT 1 FROM dbo.InventoryParts WITH (UPDLOCK, HOLDLOCK)
          WHERE PartId = @partId
        )
        BEGIN
          ROLLBACK TRANSACTION;
          SELECT 'not_found' AS Result;
        END
        ELSE IF EXISTS (
          SELECT 1
          FROM dbo.RequestMatches WITH (UPDLOCK, HOLDLOCK)
          WHERE PartId = @partId
        )
        AND EXISTS (
          SELECT 1
          FROM dbo.InventoryParts p
          INNER JOIN dbo.PartCompatibility c ON c.PartId = p.PartId
          WHERE p.PartId = @partId
          AND (
            p.PartName <> @partName
            OR p.HeadlightSide <> @headlightSide
            OR p.PartCondition <> @condition
            OR c.YearFrom <> @yearFrom
            OR c.YearTo <> @yearTo
          )
        )
        BEGIN
          ROLLBACK TRANSACTION;
          SELECT 'protected' AS Result;
        END
        ELSE
        BEGIN
          UPDATE dbo.InventoryParts
          SET PartName = @partName,
              HeadlightSide = @headlightSide,
              PartCondition = @condition,
              Price = @price,
              IsAvailable = @available,
              SellerConfirmed = 1,
              LastUpdatedAt = SYSUTCDATETIME()
          WHERE PartId = @partId;

          UPDATE dbo.PartCompatibility
          SET YearFrom = @yearFrom,
              YearTo = @yearTo
          WHERE PartId = @partId;

          COMMIT TRANSACTION;
          SELECT 'updated' AS Result;
        END
      `);

    const outcome = result.recordset[0]?.Result;

    if (outcome === "not_found") {
      return privateJson({ error: "Inventory part not found." }, 404);
    }

    if (outcome === "protected") {
      return privateJson(
        {
          error:
            "This part has confirmed customer matches. Its identity and compatibility cannot be changed.",
        },
        409,
      );
    }

    if (outcome !== "updated") {
      return privateJson({ error: "Unable to update inventory part." }, 500);
    }

    return privateJson({ ok: true }, 200);
  } catch (error) {
    console.error("Inventory update failed", { category: "storage" });

    if (error instanceof SqlServerConfigurationError) {
      return privateJson(
        { error: "The inventory service is not configured yet." },
        503,
      );
    }

    return privateJson(
      { error: "The inventory part could not be updated." },
      500,
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
