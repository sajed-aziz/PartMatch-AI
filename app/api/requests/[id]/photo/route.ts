import { requireAccess, requestAccessFilter, uuidPattern } from "@/lib/request-access";
import { privateJson } from "@/lib/http";
import {
  getSqlServerConnection,
  SqlServerConfigurationError,
} from "@/lib/sql-server";

export const runtime = "nodejs";

type PhotoRow = {
  PhotoData: Buffer;
  PhotoMimeType: string;
  PhotoFileName: string;
};

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const access = await requireAccess();
  if (access.response) return access.response;
  const { id } = await params;
  if (!uuidPattern.test(id)) return privateJson({ error: "Not found." }, 404);

  try {
    const { pool, driver } = await getSqlServerConnection();

    const result = await pool
      .request()
      .input("requestId", driver.UniqueIdentifier, id)
      .input("customerId", driver.UniqueIdentifier, access.customer.CustomerId)
      .input("isSeller", driver.Bit, Boolean(access.customer.IsSeller))
      .query<PhotoRow>(`
        SELECT
          PhotoData,
          PhotoMimeType,
          PhotoFileName
        FROM dbo.CustomerRequests
        WHERE RequestId = @requestId AND ${requestAccessFilter};
      `);

    const photo = result.recordset[0];

    if (!photo) {
      return privateJson({ error: "Photo not found." }, 404);
    }

    return new Response(new Uint8Array(photo.PhotoData), {
      status: 200,
      headers: {
        "Content-Type": /^image\/(jpeg|png|webp|heic|heif|avif)$/.test(photo.PhotoMimeType) ? photo.PhotoMimeType : "application/octet-stream",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; sandbox",
        "Content-Disposition": `inline; filename="${photo.PhotoFileName.replace(/[^a-zA-Z0-9._-]/g, "_")}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    console.error("Request photo retrieval failed", { category: "storage" });

    if (error instanceof SqlServerConfigurationError) {
      return privateJson({ error: "The request service is not configured yet." }, 503);
    }

    return privateJson({ error: "The photo could not be loaded." }, 500);
  }
}