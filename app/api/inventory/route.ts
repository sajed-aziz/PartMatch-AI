import {
  getSqlServerConnection,
  SqlServerConfigurationError,
} from "@/lib/sql-server";

export const runtime = "nodejs";

type InventoryRow = {
  PartId: string;
  PartName: string;
  HeadlightSide: string;
  PartCondition: string;
  Price: number;
  IsAvailable: boolean;
  SellerConfirmed: boolean;
  LastUpdatedAt: Date;
  VehicleMake: string;
  VehicleModel: string;
  YearFrom: number;
  YearTo: number;
};

export async function GET() {
  try {
    const { pool } = await getSqlServerConnection();

    const result = await pool.request().query<InventoryRow>(`
      SELECT
        CONVERT(varchar(36), p.PartId) AS PartId,
        p.PartName,
        p.HeadlightSide,
        p.PartCondition,
        p.Price,
        p.IsAvailable,
        p.SellerConfirmed,
        p.LastUpdatedAt,
        c.VehicleMake,
        c.VehicleModel,
        c.YearFrom,
        c.YearTo
      FROM dbo.InventoryParts AS p
      INNER JOIN dbo.PartCompatibility AS c
        ON p.PartId = c.PartId
      ORDER BY p.LastUpdatedAt DESC;
    `);

    return Response.json({
      inventory: result.recordset.map((part) => ({
        id: part.PartId,
        partName: part.PartName,
        headlightSide: part.HeadlightSide,
        condition: part.PartCondition,
        price: Number(part.Price),
        available: Boolean(part.IsAvailable),
        sellerConfirmed: Boolean(part.SellerConfirmed),
        lastUpdatedAt: part.LastUpdatedAt.toISOString(),
        compatibility: {
          make: part.VehicleMake,
          model: part.VehicleModel,
          yearFrom: part.YearFrom,
          yearTo: part.YearTo,
        },
      })),
    });
  } catch (error) {
    console.error("Inventory retrieval failed", error);

    if (error instanceof SqlServerConfigurationError) {
      return Response.json(
        { error: "The inventory service is not configured yet." },
        { status: 503 },
      );
    }

    return Response.json(
      { error: "The inventory could not be loaded. Please try again." },
      { status: 500 },
    );
  }
}