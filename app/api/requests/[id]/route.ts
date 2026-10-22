import {
  requireAccess,
  requestAccessFilter,
  uuidPattern,
} from "@/lib/request-access";
import { isSameOrigin, privateJson } from "@/lib/http";
import {
  getSqlServerConnection,
  SqlServerConfigurationError,
} from "@/lib/sql-server";

export const runtime = "nodejs";

type RequestDetailsRow = {
  RequestId: string;
  CustomerName: string;
  VehicleModel: string;
  VehicleYear: number;
  Vin: string | null;
  HeadlightSide: string;
  PhotoFileName: string;
  PhotoMimeType: string;
  Status: string;
  CreatedAt: Date;
  UpdatedAt: Date;
  SellerNote: string | null;
  CancelledAt: Date | null;
  FeedbackRating: number | null;
  FeedbackComment: string | null;
  FeedbackCreatedAt: Date | null;
};

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const access = await requireAccess();

  if (access.response) {
    return access.response;
  }

  const { id } = await params;

  if (!uuidPattern.test(id)) {
    return privateJson({ error: "Not found." }, 404);
  }

  try {
    const { pool, driver } = await getSqlServerConnection();

    const result = await pool
      .request()
      .input("requestId", driver.UniqueIdentifier, id)
      .input(
        "customerId",
        driver.UniqueIdentifier,
        access.customer.CustomerId,
      )
      .input(
        "isSeller",
        driver.Bit,
        Boolean(access.customer.IsSeller),
      )
      .query<RequestDetailsRow>(`
        SELECT
          CONVERT(varchar(36), r.RequestId) AS RequestId,
          r.CustomerName,
          r.VehicleModel,
          r.VehicleYear,
          r.Vin,
          r.HeadlightSide,
          r.PhotoFileName,
          r.PhotoMimeType,
          r.Status,
          r.CreatedAt,
          r.UpdatedAt,
          CASE WHEN @isSeller = 1 THEN r.SellerNote ELSE NULL END AS SellerNote,
          r.CancelledAt,
          f.Rating AS FeedbackRating,
          f.Comment AS FeedbackComment,
          f.CreatedAt AS FeedbackCreatedAt
        FROM dbo.CustomerRequests AS r
        LEFT JOIN dbo.CustomerRequestFeedback AS f
          ON f.RequestId = r.RequestId
        WHERE
          r.RequestId = @requestId
          AND ${requestAccessFilter.replace(/\bCustomerId\b/g, "r.CustomerId")};
      `);

    const customerRequest = result.recordset[0];

    if (!customerRequest) {
      return secureJson(
        { error: "Request not found." },
        { status: 404 },
      );
    }

    return secureJson({
      request: {
        id: customerRequest.RequestId,
        customerName: customerRequest.CustomerName,
        vehicleModel: customerRequest.VehicleModel,
        vehicleYear: customerRequest.VehicleYear,
        vin: customerRequest.Vin,
        headlightSide: customerRequest.HeadlightSide,
        photoFileName: customerRequest.PhotoFileName,
        photoMimeType: customerRequest.PhotoMimeType,
        status: customerRequest.Status,
        createdAt: customerRequest.CreatedAt.toISOString(),
        updatedAt: customerRequest.UpdatedAt.toISOString(),
        ...(access.customer.IsSeller ? { sellerNote: customerRequest.SellerNote } : {}),
        cancelledAt: customerRequest.CancelledAt?.toISOString() ?? null,
        feedback: customerRequest.FeedbackRating
          ? {
              rating: customerRequest.FeedbackRating,
              comment: customerRequest.FeedbackComment ?? "",
              createdAt:
                customerRequest.FeedbackCreatedAt?.toISOString() ?? null,
            }
          : null,
      },
    });
  } catch (error) {
    console.error("Request detail retrieval failed", {
      category: "storage",
    });

    if (error instanceof SqlServerConfigurationError) {
      return secureJson(
        { error: "The request service is not configured yet." },
        { status: 503 },
      );
    }

    return secureJson(
      { error: "The request could not be loaded." },
      { status: 500 },
    );
  }
}

function secureJson(
  body: unknown,
  options?: { status: number },
) {
  return privateJson(body, options?.status ?? 200);
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const access = await requireAccess(undefined, true);

  if (access.response) {
    return access.response;
  }

  if (!isSameOrigin(request)) {
    return privateJson(
      { error: "Use the PartMatch website." },
      403,
    );
  }

  const { id } = await params;

  if (!uuidPattern.test(id)) {
    return privateJson(
      { error: "Request not found." },
      404,
    );
  }

  let body: {
    status?: string;
    sellerNote?: unknown;
    headlightSide?: unknown;
  };

  try {
    body = await request.json();
  } catch {
    return privateJson(
      { error: "Provide valid request data." },
      400,
    );
  }

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return privateJson({ error: "Provide valid request data." }, 400);
  }
  if ("sellerNote" in body && (typeof body.sellerNote !== "string" || "status" in body)) {
    return privateJson({ error: "Provide a text note as a separate update." }, 400);
  }
  if ("headlightSide" in body && (
    typeof body.headlightSide !== "string" ||
    !["Left (driver side)", "Right (passenger side)"].includes(body.headlightSide) ||
    "status" in body || "sellerNote" in body
  )) {
    return privateJson({ error: "Select one headlight side after reviewing the customer photo." }, 400);
  }

    // Validate the requested update before connecting to storage.
    if (!("sellerNote" in body) && !("headlightSide" in body)) {
      const status = body.status;

      if (
        !status ||
        !["under_review", "closed"].includes(status)
      ) {
        return privateJson(
          { error: "Select under review or closed." },
          400,
        );
      }
    }

    try {
      const { pool, driver } =
        await getSqlServerConnection();

    if ("headlightSide" in body) {
      const result = await pool.request()
        .input("requestId", driver.UniqueIdentifier, id)
        .input("headlightSide", driver.NVarChar(30), body.headlightSide)
        .query(`
          UPDATE r
          SET HeadlightSide = @headlightSide,
              Status = 'under_review',
              UpdatedAt = SYSUTCDATETIME()
          FROM dbo.CustomerRequests AS r WITH (UPDLOCK, HOLDLOCK)
          WHERE r.RequestId = @requestId
            AND r.ConsentVersion IS NOT NULL AND r.ConsentAcceptedAt IS NOT NULL
            AND r.CancelledAt IS NULL
            AND r.Status IN ('submitted', 'under_review')
            AND NOT EXISTS (SELECT 1 FROM dbo.RequestMatches m WHERE m.RequestId = r.RequestId);
          SELECT @@ROWCOUNT AS UpdatedRows;
        `);
      if (!result.recordset[0]?.UpdatedRows) {
        return privateJson({ error: "The request can no longer be changed. Refresh before reviewing its side." }, 409);
      }
      return privateJson({ ok: true }, 200);
    }

      // SCRUM-40: Save seller internal note
    if ("sellerNote" in body) {
      const sellerNote =
        typeof body.sellerNote === "string"
          ? body.sellerNote.trim()
          : "";

      if (sellerNote.length > 500) {
        return privateJson(
          {
            error:
              "Seller note must be 500 characters or less.",
          },
          400,
        );
      }

      const result = await pool
        .request()
        .input(
          "requestId",
          driver.UniqueIdentifier,
          id,
        )
        .input(
          "sellerNote",
          driver.NVarChar(500),
          sellerNote || null,
        )
        .query(`
          UPDATE dbo.CustomerRequests
          SET
            SellerNote = @sellerNote,
            UpdatedAt = SYSUTCDATETIME()
          WHERE
            RequestId = @requestId
            AND ConsentVersion IS NOT NULL
            AND ConsentAcceptedAt IS NOT NULL;

          SELECT @@ROWCOUNT AS UpdatedRows;
        `);

      if (!result.recordset[0]?.UpdatedRows) {
        return privateJson(
          { error: "Request not found." },
          404,
        );
      }

      return privateJson({ ok: true }, 200);
    }

    // SCRUM-39: Update seller request status
        const status = body.status!;

    const result = await pool
      .request()
      .input(
        "requestId",
        driver.UniqueIdentifier,
        id,
      )
      .input(
        "status",
        driver.VarChar(30),
        status,
      )
      .query(`
        UPDATE dbo.CustomerRequests
        SET
          Status = @status,
          UpdatedAt = SYSUTCDATETIME()
        WHERE
          RequestId = @requestId
          AND ConsentVersion IS NOT NULL
          AND ConsentAcceptedAt IS NOT NULL
          AND (
            (
              @status = 'under_review'
              AND Status = 'submitted'
            )
            OR
            (
              @status = 'closed'
              AND Status <> 'closed'
            )
          );

        SELECT @@ROWCOUNT AS UpdatedRows;
      `);

    if (!result.recordset[0]?.UpdatedRows) {
      return privateJson(
        {
          error:
            "Request unavailable or status has changed. Refresh and try again.",
        },
        409,
      );
    }

    return privateJson({ ok: true }, 200);
  } catch (error) {
    console.error("Request update failed", {
      category:
        error instanceof SqlServerConfigurationError
          ? "configuration"
          : "storage",
    });

    return privateJson(
      { error: "Request could not be updated." },
      500,
    );
  }
}
