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
  try {
    const { pool, driver } = await getSqlServerConnection();
    const result = await pool.request()
      .input("customerId", driver.UniqueIdentifier, access.customer.CustomerId)
      .input("requestId", driver.UniqueIdentifier, id)
      .query(`
        UPDATE dbo.CustomerRequests SET Status = 'closed', CancelledAt = SYSUTCDATETIME(), UpdatedAt = SYSUTCDATETIME()
        WHERE RequestId = @requestId AND CustomerId = @customerId AND Status = 'submitted'
          AND CancelledAt IS NULL AND NOT EXISTS (
            SELECT 1 FROM dbo.RequestMatches WHERE RequestId = @requestId
          );
        IF @@ROWCOUNT > 0 SELECT 'cancelled' AS Outcome;
        ELSE IF EXISTS (SELECT 1 FROM dbo.CustomerRequests WHERE RequestId = @requestId AND CustomerId = @customerId)
          SELECT 'ineligible' AS Outcome;
        ELSE SELECT 'missing' AS Outcome;
      `);
    const outcome = result.recordset[0].Outcome;
    if (outcome === "missing") return privateJson({ error: "Request not found." }, 404);
    if (outcome === "ineligible") return privateJson({ error: "Only requests awaiting seller review can be cancelled. Refresh your requests." }, 409);
    if (outcome !== "cancelled") throw new Error("Unexpected cancellation outcome");
    return privateJson({ ok: true }, 200);
  } catch {
    return privateJson({ error: "Your request could not be cancelled. Please try again." }, 503);
  }
}
