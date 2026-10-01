import { requireCustomer } from "@/lib/customer-access";
import { privateJson } from "@/lib/http";
import { uuidPattern } from "@/lib/request-access";
import { getSqlServerConnection } from "@/lib/sql-server";

export const runtime = "nodejs";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const access = await requireCustomer(request);
  if (access.response) return access.response;
  const { id } = await params;
  if (!uuidPattern.test(id)) return privateJson({ error: "Request not found." }, 404);
  let body;
  try { body = await request.json(); } catch { return privateJson({ error: "Provide a rating and optional comment." }, 400); }
  if (!body || !Number.isInteger(body.rating) || body.rating < 1 || body.rating > 5 ||
      (body.comment !== undefined && typeof body.comment !== "string") || (body.comment?.length ?? 0) > 1000) {
    return privateJson({ error: "Choose a rating from 1 to 5 and a comment of at most 1000 characters." }, 400);
  }
  try {
    const { pool, driver } = await getSqlServerConnection();
    const result = await pool.request()
      .input("customerId", driver.UniqueIdentifier, access.customer.CustomerId)
      .input("requestId", driver.UniqueIdentifier, id)
      .input("rating", driver.TinyInt, body.rating)
      .input("comment", driver.NVarChar(1000), (body.comment ?? "").trim())
      .query(`
        SET XACT_ABORT ON;
        BEGIN TRY
          BEGIN TRANSACTION;
          DECLARE @status varchar(30), @cancelledAt datetime2(3);
          SELECT @status = Status, @cancelledAt = CancelledAt
          FROM dbo.CustomerRequests WITH (UPDLOCK, HOLDLOCK)
          WHERE RequestId = @requestId AND CustomerId = @customerId;
          IF @status IS NULL SELECT 'missing' AS Outcome;
          ELSE IF @status <> 'closed' OR @cancelledAt IS NOT NULL SELECT 'ineligible' AS Outcome;
          ELSE IF EXISTS (SELECT 1 FROM dbo.CustomerRequestFeedback WHERE RequestId = @requestId)
            SELECT 'exists' AS Outcome;
          ELSE BEGIN
            INSERT dbo.CustomerRequestFeedback (RequestId, CustomerId, Rating, Comment)
            VALUES (@requestId, @customerId, @rating, @comment);
            SELECT 'saved' AS Outcome;
          END;
          COMMIT TRANSACTION;
        END TRY
        BEGIN CATCH
          IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
          THROW;
        END CATCH;
      `);
    const outcome = result.recordset[0].Outcome;
    if (outcome === "missing") return privateJson({ error: "Request not found." }, 404);
    if (outcome === "ineligible") return privateJson({ error: "Feedback is available only after a request is closed by a seller." }, 409);
    if (outcome === "exists") return privateJson({ error: "You have already submitted feedback for this request." }, 409);
    if (outcome !== "saved") throw new Error("Unexpected feedback outcome");
    return privateJson({ ok: true }, 201);
  } catch {
    return privateJson({ error: "Feedback could not be saved. Please try again." }, 503);
  }
}
