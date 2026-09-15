import { getSqlServerConnection, SqlServerConfigurationError } from "@/lib/sql-server";

export const runtime = "nodejs";

const supportedModel = "Mercedes-Benz C-Class (W204)";
const supportedYears = new Set(Array.from({ length: 8 }, (_, index) => 2014 - index));
const supportedSides = new Set(["Left (driver side)", "Right (passenger side)", "Not sure"]);
const acceptedPhotoTypes = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
  "image/avif",
]);
const photoTypesByExtension: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".heic": "image/heic",
  ".heif": "image/heif",
  ".avif": "image/avif",
};
const maximumPhotoSize = 10 * 1024 * 1024;
const maximumRequestSize = maximumPhotoSize + 1024 * 1024;
const vinPattern = /^[A-HJ-NPR-Z0-9]{17}$/;

type CreatedRequestRow = {
  RequestId: string;
  Status: string;
  CreatedAt: Date;
};

function readText(formData: FormData, name: string) {
  const value = formData.get(name);
  return typeof value === "string" ? value.trim() : "";
}

function validationError(message: string) {
  return Response.json({ error: message }, { status: 400 });
}

function getPhotoMimeType(photo: File) {
  if (acceptedPhotoTypes.has(photo.type)) return photo.type;

  const extension = photo.name.slice(photo.name.lastIndexOf(".")).toLowerCase();
  return photoTypesByExtension[extension];
}

export async function POST(request: Request) {
  const contentLength = Number(request.headers.get("content-length"));

  if (Number.isFinite(contentLength) && contentLength > maximumRequestSize) {
    return Response.json(
      { error: "The uploaded request is too large." },
      { status: 413 },
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

  const photoMimeType = getPhotoMimeType(photo);

  if (!photoMimeType) {
    return validationError("The photo must be a JPG, PNG, WebP, HEIC, HEIF, or AVIF image.");
  }

  if (photo.size > maximumPhotoSize) {
    return validationError("The photo must be smaller than 5 MB.");
  }

  try {
    const photoData = Buffer.from(await photo.arrayBuffer());
    const { pool, driver } = await getSqlServerConnection();
    const result = await pool
      .request()
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
          CustomerName,
          VehicleModel,
          VehicleYear,
          Vin,
          HeadlightSide,
          PhotoFileName,
          PhotoMimeType,
          PhotoSizeBytes,
          PhotoData
        )
        OUTPUT
          CONVERT(varchar(36), INSERTED.RequestId) AS RequestId,
          INSERTED.Status,
          INSERTED.CreatedAt
        VALUES (
          @customerName,
          @vehicleModel,
          @vehicleYear,
          @vin,
          @headlightSide,
          @photoFileName,
          @photoMimeType,
          @photoSizeBytes,
          @photoData
        );
      `);

    const createdRequest = result.recordset[0];

    return Response.json(
      {
        request: {
          id: createdRequest.RequestId,
          status: createdRequest.Status,
          createdAt: createdRequest.CreatedAt.toISOString(),
        },
      },
      { status: 201 },
    );
  } catch (error) {
    console.error("Customer request submission failed", error);

    if (error instanceof SqlServerConfigurationError) {
      return Response.json(
        { error: "The submission service is not configured yet." },
        { status: 503 },
      );
    }

    return Response.json(
      { error: "The request could not be submitted. Please try again." },
      { status: 500 },
    );
  }
}
