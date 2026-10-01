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



export async function POST(request: Request) {
  try {
    const body = await request.json();

    const partName = String(body.partName ?? "").trim();
    const headlightSide = String(body.headlightSide ?? "");
    const condition = String(body.condition ?? "");
    const price = Number(body.price);
    const yearFrom = Number(body.yearFrom);
    const yearTo = Number(body.yearTo);

    if (!partName) {
      return Response.json(
        { error: "Part name is required." },
        { status: 400 },
      );
    }

    if (
      !["Left (driver side)", "Right (passenger side)"].includes(
        headlightSide,
      )
    ) {
      return Response.json(
        { error: "Select a valid headlight side." },
        { status: 400 },
      );
    }

    if (!["new", "used", "refurbished"].includes(condition)) {
      return Response.json(
        { error: "Select a valid condition." },
        { status: 400 },
      );
    }

    if (!Number.isFinite(price) || price < 0) {
      return Response.json(
        { error: "Enter a valid price." },
        { status: 400 },
      );
    }

    if (
      !Number.isInteger(yearFrom) ||
      !Number.isInteger(yearTo) ||
      yearFrom < 2007 ||
      yearTo > 2014 ||
      yearFrom > yearTo
    ) {
      return Response.json(
        { error: "Enter a valid compatibility year range." },
        { status: 400 },
      );
    }

    const { pool, driver } = await getSqlServerConnection();

    const transaction = pool.transaction();
    await transaction.begin();

    try {
      const partResult = await transaction
        .request()
        .input("partName", driver.NVarChar(150), partName)
        .input("headlightSide", driver.NVarChar(30), headlightSide)
        .input("condition", driver.VarChar(20), condition)
        .input("price", driver.Decimal(10, 2), price)
        .query<{ PartId: string }>(`
          INSERT INTO dbo.InventoryParts (
            PartName,
            HeadlightSide,
            PartCondition,
            Price,
            IsAvailable,
            SellerConfirmed
          )
          OUTPUT CONVERT(varchar(36), INSERTED.PartId) AS PartId
          VALUES (
            @partName,
            @headlightSide,
            @condition,
            @price,
            1,
            1
          );
        `);

      const partId = partResult.recordset[0].PartId;

      await transaction
        .request()
        .input("partId", driver.UniqueIdentifier, partId)
        .input("vehicleMake", driver.NVarChar(100), "Mercedes-Benz")
        .input(
          "vehicleModel",
          driver.NVarChar(100),
          "C-Class (W204)",
        )
        .input("yearFrom", driver.SmallInt, yearFrom)
        .input("yearTo", driver.SmallInt, yearTo)
        .query(`
          INSERT INTO dbo.PartCompatibility (
            PartId,
            VehicleMake,
            VehicleModel,
            YearFrom,
            YearTo
          )
          VALUES (
            @partId,
            @vehicleMake,
            @vehicleModel,
            @yearFrom,
            @yearTo
          );
        `);

      await transaction.commit();

      return Response.json(
        { ok: true, id: partId },
        { status: 201 },
      );
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  } catch (error) {
    console.error("Inventory creation failed", error);

    return Response.json(
      { error: "The inventory part could not be created." },
      { status: 500 },
    );
  }
}