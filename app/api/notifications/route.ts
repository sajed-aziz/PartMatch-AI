import { requireCustomer } from "@/lib/customer-access";
import { privateJson } from "@/lib/http";
import { uuidPattern } from "@/lib/request-access";
import { getSqlServerConnection } from "@/lib/sql-server";

export const runtime = "nodejs";

type NotificationRow = {
  NotificationId: string; RequestId: string; Message: string;
  CreatedAt: Date; ReadAt: Date | null; Kind: string;
};

export async function GET(request: Request) {
  const access = await requireCustomer();
  if (access.response) return access.response;
  const page = Number(new URL(request.url).searchParams.get("page") ?? "0");
  if (!Number.isInteger(page) || page < 0 || page > 100000) {
    return privateJson({ error: "Invalid notification page." }, 400);
  }
  try {
    const { pool, driver } = await getSqlServerConnection();
    const result = await pool.request()
      .input("customerId", driver.UniqueIdentifier, access.customer.CustomerId)
      .input("offset", driver.Int, page * 20)
      .query<NotificationRow>(`
        SELECT CONVERT(varchar(36), NotificationId) AS NotificationId,
          CONVERT(varchar(36), RequestId) AS RequestId, Kind, Message, CreatedAt, ReadAt
        FROM dbo.CustomerNotifications WHERE CustomerId = @customerId
        ORDER BY CreatedAt DESC, NotificationId DESC
        OFFSET @offset ROWS FETCH NEXT 21 ROWS ONLY;
        SELECT COUNT(*) AS UnreadCount FROM dbo.CustomerNotifications
        WHERE CustomerId = @customerId AND ReadAt IS NULL;
      `);
    const count = (result.recordsets as unknown as [NotificationRow[], { UnreadCount: number }[]])[1][0].UnreadCount;
    return privateJson({
      notifications: result.recordset.slice(0, 20).map(row => ({
        id: row.NotificationId, requestId: row.RequestId, kind: row.Kind,
        message: row.Message, createdAt: row.CreatedAt.toISOString(), readAt: row.ReadAt?.toISOString() ?? null,
      })), unreadCount: count, hasMore: result.recordset.length > 20,
    }, 200);
  } catch {
    return privateJson({ error: "Notifications could not be loaded. Please try again." }, 503);
  }
}

export async function PATCH(request: Request) {
  const access = await requireCustomer(request);
  if (access.response) return access.response;
  let body;
  try { body = await request.json(); } catch { return privateJson({ error: "Provide a notification ID or mark all as read." }, 400); }
  if (!body || typeof body !== "object" || (body.all !== true && (typeof body.id !== "string" || !uuidPattern.test(body.id)))) {
    return privateJson({ error: "Provide a valid notification ID or mark all as read." }, 400);
  }
  try {
    const { pool, driver } = await getSqlServerConnection();
    const result = await pool.request()
      .input("customerId", driver.UniqueIdentifier, access.customer.CustomerId)
      .input("all", driver.Bit, body.all === true)
      .input("notificationId", driver.UniqueIdentifier, body.all === true ? null : body.id)
      .query(`
        UPDATE dbo.CustomerNotifications SET ReadAt = COALESCE(ReadAt, SYSUTCDATETIME())
        WHERE CustomerId = @customerId AND (@all = 1 OR NotificationId = @notificationId);
        SELECT @@ROWCOUNT AS UpdatedRows;
      `);
    if (body.all !== true && !result.recordset[0].UpdatedRows) return privateJson({ error: "Notification not found." }, 404);
    return privateJson({ ok: true }, 200);
  } catch {
    return privateJson({ error: "Notifications could not be marked as read. Please try again." }, 503);
  }
}
