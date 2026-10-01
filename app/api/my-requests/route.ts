import { getCustomer } from "@/lib/auth";
import {
  getSqlServerConnection,
  SqlServerConfigurationError,
} from "@/lib/sql-server";
import { privateJson } from "@/lib/http";
import { getSellerContact } from "@/lib/seller-contact";

export const runtime = "nodejs";

type CustomerRequestRow = {
  RequestId: string;
  VehicleModel: string;
  VehicleYear: number;
  HeadlightSide: string;
  Status: string;
  CreatedAt: Date;
  UpdatedAt: Date;
  IsAvailable: boolean;
  SellerConfirmed: boolean;
  CancelledAt: Date | null;
  FeedbackRating: number | null;
  FeedbackComment: string | null;
  FeedbackCreatedAt: Date | null;

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

  if (customer.IsSeller) {
    return privateJson({ error: "Customer access is required to view request history." }, 403);
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
          r.UpdatedAt,
          r.CancelledAt,
          f.Rating AS FeedbackRating,
          f.Comment AS FeedbackComment,
          f.CreatedAt AS FeedbackCreatedAt,

          CONVERT(varchar(36), p.PartId) AS PartId,
          p.PartName,
          p.PartCondition,
          p.Price,
          p.LastUpdatedAt,
          p.IsAvailable,
          p.SellerConfirmed

        FROM dbo.CustomerRequests AS r

        LEFT JOIN dbo.RequestMatches AS m
            ON m.RequestId = r.RequestId

        LEFT JOIN dbo.InventoryParts AS p
          ON p.PartId = m.PartId

        LEFT JOIN dbo.CustomerRequestFeedback AS f
          ON f.RequestId = r.RequestId AND f.CustomerId = @customerId

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
          updatedAt: request.UpdatedAt.toISOString(),
          cancelledAt: request.CancelledAt?.toISOString() ?? null,
          feedback: request.FeedbackRating == null ? null : {
            rating: request.FeedbackRating,
            comment: request.FeedbackComment ?? "",
            createdAt: request.FeedbackCreatedAt?.toISOString() ?? null,
          },

          confirmedPart: request.PartId
            ? {
                id: request.PartId,
                partName: request.PartName,
                condition: request.PartCondition,
                price: Number(request.Price),
                available: Boolean(request.IsAvailable && request.SellerConfirmed),
                sellerContact: request.Status !== "closed" && request.IsAvailable && request.SellerConfirmed ? getSellerContact() : null,
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
