import { getCustomer } from "@/lib/auth";
import {
  getSqlServerConnection,
  SqlServerConfigurationError,
} from "@/lib/sql-server";
import { privateJson } from "@/lib/http";

export const runtime = "nodejs";

type CustomerRequestRow = {
  RequestId: string;
  VehicleModel: string;
  VehicleYear: number;
  HeadlightSide: string;
  Status: string;
  CreatedAt: Date;

  PartId: string | null;
  PartName: string | null;
  PartCondition: string | null;
  Price: number | null;
  LastUpdatedAt: Date | null;
};

export async function GET() {
  let customer;

  try {
    customer = await getCustomer();
  } catch {
    return privateJson(
      { error: "Unable to verify your session." },
      503,
    );
  }

  if (!customer) {
    return privateJson(
      { error: "Sign in to view your requests." },
      401,
    );
  }

  try {
    const { pool, driver } = await getSqlServerConnection();

    const result = await pool
      .request()
      .input(
        "customerId",
        driver.UniqueIdentifier,
        customer.CustomerId,
      )
      .query<CustomerRequestRow>(`
        SELECT
          CONVERT(varchar(36), r.RequestId) AS RequestId,
          r.VehicleModel,
          r.VehicleYear,
          r.HeadlightSide,
          r.Status,
          r.CreatedAt,

          CONVERT(varchar(36), p.PartId) AS PartId,
          p.PartName,
          p.PartCondition,
          p.Price,
          p.LastUpdatedAt

        FROM dbo.CustomerRequests AS r

        LEFT JOIN dbo.RequestMatches AS m
            ON m.RequestId = r.RequestId

        LEFT JOIN dbo.InventoryParts AS p
          ON p.PartId = m.PartId

        WHERE r.CustomerId = @customerId

        ORDER BY r.CreatedAt DESC;
      `);

    return privateJson(
      {
        requests: result.recordset.map((request) => ({
          id: request.RequestId,
          vehicleModel: request.VehicleModel,
          vehicleYear: request.VehicleYear,
          headlightSide: request.HeadlightSide,
          status: request.Status,
          createdAt: request.CreatedAt.toISOString(),

          confirmedPart: request.PartId
            ? {
                id: request.PartId,
                partName: request.PartName,
                condition: request.PartCondition,
                price: Number(request.Price),
                lastUpdatedAt:
                  request.LastUpdatedAt?.toISOString() ?? null,
              }
            : null,
        })),
      },
      200,
    );
  } catch (error) {
    console.error("Customer request retrieval failed", {
      category:
        error instanceof SqlServerConfigurationError
          ? "configuration"
          : "storage",
    });

    if (error instanceof SqlServerConfigurationError) {
      return privateJson(
        { error: "The request service is not configured yet." },
        503,
      );
    }

    return privateJson(
      { error: "Your requests could not be loaded." },
      500,
    );
  }
}