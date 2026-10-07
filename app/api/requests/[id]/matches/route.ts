import { privateJson, isSameOrigin } from "@/lib/http";
import { requireAccess, uuidPattern } from "@/lib/request-access";
import {
  getSqlServerConnection,
  SqlServerConfigurationError,
} from "@/lib/sql-server";

export const runtime = "nodejs";

type MatchRow = {
  PartId: string;
  PartName: string;
  HeadlightSide: string;
  PartCondition: string;
  Price: number;
  IsAvailable: boolean;
  LastUpdatedAt: Date;
  YearFrom: number;
  YearTo: number;
  IsConfirmed: boolean;
};

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const access = await requireAccess(undefined, true);
  if (access.response) return access.response;

  const { id } = await params;
  if (!uuidPattern.test(id)) return privateJson({ error: "Not found." }, 404);

  try {
    const { pool, driver } = await getSqlServerConnection();

    const requestResult = await pool
      .request()
      .input("requestId", driver.UniqueIdentifier, id)
      .query<{
        VehicleYear: number;
        HeadlightSide: string;
      }>(`
        SELECT VehicleYear, HeadlightSide
        FROM dbo.CustomerRequests
        WHERE RequestId = @requestId AND ConsentVersion IS NOT NULL AND ConsentAcceptedAt IS NOT NULL;
      `);

    const customerRequest = requestResult.recordset[0];

    if (!customerRequest) {
      return secureJson(
        { error: "Request not found." },
        { status: 404 },
      );
    }

    if (customerRequest.HeadlightSide === "Not sure") {
      return secureJson({
        matches: [],
        message:
          "The customer did not select a headlight side. Review the photo before matching inventory.",
      });
    }

    const result = await pool
      .request()
      .input("requestId", driver.UniqueIdentifier, id)
      .input(
        "headlightSide",
        driver.NVarChar(30),
        customerRequest.HeadlightSide,
      )
      .input(
        "vehicleYear",
        driver.SmallInt,
        customerRequest.VehicleYear,
      )
      .query<MatchRow>(`
        SELECT
          CONVERT(varchar(36), p.PartId) AS PartId,
          p.PartName,
          p.HeadlightSide,
          p.PartCondition,
          p.Price,
          p.IsAvailable,
          p.LastUpdatedAt,
          c.YearFrom,
          c.YearTo,
          CAST(
            CASE WHEN rm.PartId = p.PartId THEN 1 ELSE 0 END
            AS bit
          ) AS IsConfirmed
        FROM dbo.InventoryParts p
        INNER JOIN dbo.PartCompatibility c
          ON c.PartId = p.PartId
        LEFT JOIN dbo.RequestMatches rm
          ON rm.RequestId = @requestId
          AND rm.PartId = p.PartId
        WHERE
          (p.IsAvailable = 1 OR rm.PartId IS NOT NULL)
          AND p.SellerConfirmed = 1
          AND p.HeadlightSide = @headlightSide
          AND c.VehicleMake = 'Mercedes-Benz'
          AND c.VehicleModel = 'C-Class (W204)'
          AND @vehicleYear BETWEEN c.YearFrom AND c.YearTo
        ORDER BY p.LastUpdatedAt DESC;
      `);

    return secureJson({
      matches: result.recordset.map((part) => ({
        id: part.PartId,
        partName: part.PartName,
        headlightSide: part.HeadlightSide,
        condition: part.PartCondition,
        price: Number(part.Price),
        available: Boolean(part.IsAvailable),
        lastUpdatedAt: part.LastUpdatedAt.toISOString(),
        yearFrom: part.YearFrom,
        yearTo: part.YearTo,
        confirmed: Boolean(part.IsConfirmed),
      })),
    });
  } catch (error) {
    console.error("Compatible inventory retrieval failed", { category: "storage" });

    if (error instanceof SqlServerConfigurationError) {
      return secureJson(
        { error: "The inventory service is not configured yet." },
        { status: 503 },
      );
    }

    return secureJson(
      { error: "Compatible inventory could not be loaded." },
      { status: 500 },
    );
  }
}

export async function POST(
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
    const partId =
      typeof body.partId === "string" ? body.partId : "";

    if (!uuidPattern.test(partId)) {
      return secureJson(
        { error: "Select an inventory part." },
        { status: 400 },
      );
    }

    const { pool, driver } = await getSqlServerConnection();

    const transaction = pool.transaction();
    await transaction.begin();
    try {
      const validMatch = await transaction
        .request()
        .input("requestId", driver.UniqueIdentifier, id)
        .input("partId", driver.UniqueIdentifier, partId)
        .query<{ PartId: string }>(`
          SELECT CONVERT(varchar(36), p.PartId) AS PartId
          FROM dbo.CustomerRequests r WITH (UPDLOCK, HOLDLOCK)
          INNER JOIN dbo.InventoryParts p WITH (UPDLOCK, HOLDLOCK)
            ON p.PartId = @partId
          INNER JOIN dbo.PartCompatibility c
            ON c.PartId = p.PartId
          WHERE
            r.RequestId = @requestId
            AND r.ConsentVersion IS NOT NULL AND r.ConsentAcceptedAt IS NOT NULL
            AND r.Status <> 'closed'
            AND r.HeadlightSide <> 'Not sure'
            AND p.IsAvailable = 1
            AND p.SellerConfirmed = 1
            AND p.HeadlightSide = r.HeadlightSide
            AND c.VehicleMake = 'Mercedes-Benz'
            AND c.VehicleModel = 'C-Class (W204)'
            AND r.VehicleYear BETWEEN c.YearFrom AND c.YearTo;
        `);

      if (!validMatch.recordset[0]) {
        await transaction.rollback();
        return secureJson(
          {
            error:
              "This part is not available or compatible with the request.",
          },
          { status: 400 },
        );
      }

      await transaction
        .request()
        .input("requestId", driver.UniqueIdentifier, id)
        .input("partId", driver.UniqueIdentifier, partId)
        .query(`
          DELETE FROM dbo.RequestMatches
          WHERE RequestId = @requestId;

          INSERT INTO dbo.RequestMatches (
            RequestId,
            PartId
          )
          VALUES (
            @requestId,
            @partId
          );

          UPDATE dbo.CustomerRequests
          SET
            Status = 'matched',
            UpdatedAt = SYSUTCDATETIME()
          WHERE RequestId = @requestId AND ConsentVersion IS NOT NULL AND ConsentAcceptedAt IS NOT NULL;
        `);

      await transaction.commit();
    } catch (error) {
      await transaction.rollback();
      throw error;
    }

    return secureJson({ ok: true });
  } catch (error) {
    console.error("Inventory match confirmation failed", { category: "storage" });

    if (error instanceof SqlServerConfigurationError) {
      return secureJson(
        { error: "The matching service is not configured yet." },
        { status: 503 },
      );
    }

    return secureJson(
      { error: "The inventory match could not be confirmed." },
      { status: 500 },
    );
  }
}
function secureJson(body: unknown, options?: { status: number }) {
  return privateJson(body, options?.status ?? 200);
}
