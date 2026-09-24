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
  const { id } = await params;

  try {
    const { pool, driver } = await getSqlServerConnection();

    const result = await pool
      .request()
      .input("requestId", driver.UniqueIdentifier, id)
      .query<PhotoRow>(`
        SELECT
          PhotoData,
          PhotoMimeType,
          PhotoFileName
        FROM dbo.CustomerRequests
        WHERE RequestId = @requestId;
      `);

    const photo = result.recordset[0];

    if (!photo) {
      return new Response("Photo not found.", { status: 404 });
    }

    return new Response(new Uint8Array(photo.PhotoData), {
      status: 200,
      headers: {
        "Content-Type": photo.PhotoMimeType,
        "Content-Disposition": `inline; filename="${photo.PhotoFileName.replace(/"/g, "")}"`,
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch (error) {
    console.error("Request photo retrieval failed", error);

    if (error instanceof SqlServerConfigurationError) {
      return new Response("The request service is not configured yet.", {
        status: 503,
      });
    }

    return new Response("The photo could not be loaded.", {
      status: 500,
    });
  }
}