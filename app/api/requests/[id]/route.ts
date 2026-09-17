import { getSqlServerConnection, SqlServerConfigurationError } from "@/lib/sql-server";

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
};

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const { pool, driver } = await getSqlServerConnection();

    const result = await pool
      .request()
      .input("requestId", driver.UniqueIdentifier, id)
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
          UpdatedAt
        FROM dbo.CustomerRequests
        WHERE RequestId = @requestId;
      `);

    const customerRequest = result.recordset[0];

    if (!customerRequest) {
      return Response.json(
        { error: "Request not found." },
        { status: 404 }
      );
    }

    return Response.json({
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
      },
    });
  } catch (error) {
    console.error("Seller request detail retrieval failed", error);

    if (error instanceof SqlServerConfigurationError) {
      return Response.json(
        { error: "The request service is not configured yet." },
        { status: 503 }
      );
    }

    return Response.json(
      { error: "The request could not be loaded." },
      { status: 500 }
    );
  }
}