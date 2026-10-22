import { requireAccess } from "@/lib/request-access";
import { getSqlServerConnection, SqlServerConfigurationError } from "@/lib/sql-server";
import { getCustomer } from "@/lib/auth";
import { isSameOrigin, privateJson } from "@/lib/http";
import { getPhotoMimeType, maximumPhotoSize, validatePhotoMetadata } from "@/lib/photo-validation";

export const runtime = "nodejs";

const supportedModel = "Mercedes-Benz C-Class (W204)";
const supportedYears = new Set(Array.from({ length: 8 }, (_, index) => 2014 - index));
const supportedSides = new Set(["Left (driver side)", "Right (passenger side)", "Not sure"]);
const maximumRequestSize = maximumPhotoSize + 1024 * 1024;
const vinPattern = /^[A-HJ-NPR-Z0-9]{17}$/;

type CreatedRequestRow = {
  RequestId: string;
  Status: string;
  CreatedAt: Date;
};

type SellerRequestRow = {
  RequestId: string;
  CustomerName: string;
  VehicleModel: string;
  VehicleYear: number;
  Vin: string | null;
  HeadlightSide: string;
  PhotoFileName: string;
  Status: string;
  CreatedAt: Date;
  UpdatedAt: Date;
  CancelledAt: Date | null;
};

function readText(formData: FormData, name: string) {
  const value = formData.get(name);
  return typeof value === "string" ? value.trim() : "";
}

function validationError(message: string) {
  return privateJson({ error: message }, 400);
}

export async function POST(request: Request) {
  if (!isSameOrigin(request)) {
    return privateJson({ error: "Submit your request from the PartMatch website." }, 403);
  }
  let customer;
  try { customer = await getCustomer(); } catch {
    return privateJson({ error: "Unable to verify your session. Please try again later." }, 503);
  }
  if (!customer) return privateJson({ error: "Sign in before submitting a request." }, 401);
  if (customer.IsSeller) return privateJson({ error: "Customer access is required to submit a request." }, 403);
  const contentLength = Number(request.headers.get("content-length"));

  if (Number.isFinite(contentLength) && contentLength > maximumRequestSize) {
    return privateJson(
      { error: "The uploaded request is too large." },
      413,
    );
  }

  let formData: FormData;

  try {
    formData = await request.formData();
  } catch {
    return validationError("Submit the request as multipart form data.");
  }

  const customerName = readText(formData, "customerName");
  const model = readText(formData, "model");
  const year = Number(readText(formData, "year"));
  const vin = readText(formData, "vin").toUpperCase().replace(/\s/g, "");
  const side = readText(formData, "side");
  const photo = formData.get("photo");

  if (formData.get("consent") !== "true") {
    return validationError("Confirm your permission to store and share these details and photo for this request.");
  }

  if (customerName.length < 2 || customerName.length > 150) {
    return validationError("Enter a customer name between 2 and 150 characters.");
  }

  if (model !== supportedModel) {
    return validationError("Select a supported vehicle model.");
  }

  if (!Number.isInteger(year) || !supportedYears.has(year)) {
    return validationError("Select a supported vehicle year.");
  }

  if (vin && !vinPattern.test(vin)) {
    return validationError("Enter a valid 17-character VIN without I, O, or Q.");
  }

  if (!supportedSides.has(side)) {
    return validationError("Select a valid headlight side.");
  }

  if (!(photo instanceof File) || photo.size === 0) {
    return validationError("Attach a headlight photo.");
  }

  const photoError = validatePhotoMetadata(photo);
  if (photoError) return privateJson({ error: photoError.error }, photoError.status);
  const photoMimeType = getPhotoMimeType(photo)!;

  try {
    const photoData = Buffer.from(await photo.arrayBuffer());
    const { pool, driver } = await getSqlServerConnection();
    const result = await pool
      .request()
      .input("customerId", driver.UniqueIdentifier, customer.CustomerId)
      .input("customerName", driver.NVarChar(150), customerName)
      .input("vehicleModel", driver.NVarChar(100), model)
      .input("vehicleYear", driver.SmallInt, year)
      .input("vin", driver.Char(17), vin || null)
      .input("headlightSide", driver.NVarChar(30), side)
      .input("photoFileName", driver.NVarChar(255), photo.name.slice(0, 255))
      .input("photoMimeType", driver.VarChar(50), photoMimeType)
      .input("photoSizeBytes", driver.Int, photo.size)
      .input("photoData", driver.VarBinary(driver.MAX), photoData)
      .query<CreatedRequestRow>(`
        INSERT INTO dbo.CustomerRequests (
          CustomerId,
          CustomerName,
          VehicleModel,
          VehicleYear,
          Vin,
          HeadlightSide,
          PhotoFileName,
          PhotoMimeType,
          PhotoSizeBytes,
          PhotoData,
          ConsentVersion,
          ConsentAcceptedAt
        )
        OUTPUT
          CONVERT(varchar(36), INSERTED.RequestId) AS RequestId,
          INSERTED.Status,
          INSERTED.CreatedAt
        VALUES (
          @customerId,
          @customerName,
          @vehicleModel,
          @vehicleYear,
          @vin,
          @headlightSide,
          @photoFileName,
          @photoMimeType,
          @photoSizeBytes,
          @photoData,
          '2026-09-25',
          SYSUTCDATETIME()
        );
      `);

    const createdRequest = result.recordset[0];

    return privateJson(
      {
        request: {
          id: createdRequest.RequestId,
          status: createdRequest.Status,
          createdAt: createdRequest.CreatedAt.toISOString(),
        },
      },
      201,
    );
  } catch (error) {
    // SQL driver errors may contain query parameters or connection details.
    console.error("Customer request submission failed", {
      category: error instanceof SqlServerConfigurationError ? "configuration" : "storage",
    });

    if (error instanceof SqlServerConfigurationError) {
      return privateJson(
        { error: "The submission service is not configured yet." },
        503,
      );
    }

    return privateJson(
      { error: "The request could not be submitted. Please try again." },
      500,
    );
  }
}

export async function GET() {
  const access = await requireAccess(undefined, true);
  if (access.response) return access.response;

  try {
    const { pool } = await getSqlServerConnection();

    const result = await pool.request().query<SellerRequestRow>(`
      SELECT
        CONVERT(varchar(36), RequestId) AS RequestId,
        CustomerName,
        VehicleModel,
        VehicleYear,
        Vin,
        HeadlightSide,
        PhotoFileName,
        Status,
        CreatedAt,
        UpdatedAt,
        CancelledAt
      FROM dbo.CustomerRequests
      WHERE ConsentVersion IS NOT NULL AND ConsentAcceptedAt IS NOT NULL
      ORDER BY CreatedAt DESC;
    `);

    return secureJson({
      requests: result.recordset.map((request) => ({
        id: request.RequestId,
        customerName: request.CustomerName,
        vehicleModel: request.VehicleModel,
        vehicleYear: request.VehicleYear,
        vin: request.Vin,
        headlightSide: request.HeadlightSide,
        photoFileName: request.PhotoFileName,
        status: request.Status,
        createdAt: request.CreatedAt.toISOString(),
        updatedAt: request.UpdatedAt.toISOString(),
        cancelledAt: request.CancelledAt?.toISOString() ?? null,
      })),
    });
  } catch (error) {
    console.error("Seller request retrieval failed", { category: "storage" });

    if (error instanceof SqlServerConfigurationError) {
      return secureJson(
        { error: "The request service is not configured yet." },
        { status: 503 },
      );
    }

    return secureJson(
      { error: "The requests could not be loaded. Please try again." },
      { status: 500 },
    );
  }
}
function secureJson(body: unknown, options?: { status: number }) {
  return privateJson(body, options?.status ?? 200);
}
