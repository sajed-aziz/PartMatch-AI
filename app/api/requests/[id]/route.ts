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
          CONVERT(varchar(36), RequestId) AS RequestId,
          CustomerName,
          VehicleModel,
          VehicleYear,
          Vin,
          HeadlightSide,
          PhotoFileName,
          PhotoMimeType,
          Status,
          CreatedAt,
          UpdatedAt,
          SellerNote
        FROM dbo.CustomerRequests
        WHERE
          RequestId = @requestId
          AND ${requestAccessFilter};
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
        sellerNote: customerRequest.SellerNote,
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
  };

  try {
    body = await request.json();
  } catch {
    return privateJson(
      { error: "Provide valid request data." },
      400,
    );
  }

    // Validate the requested update before connecting to storage.
    if (!("sellerNote" in body)) {
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