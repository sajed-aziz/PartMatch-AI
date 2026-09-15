IF DB_ID(N'PartMatchAI') IS NULL
BEGIN
    CREATE DATABASE [PartMatchAI];
END;
GO

USE [PartMatchAI];
GO

IF OBJECT_ID(N'dbo.CustomerRequests', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.CustomerRequests
    (
        RequestId UNIQUEIDENTIFIER NOT NULL
            CONSTRAINT PK_CustomerRequests PRIMARY KEY
            CONSTRAINT DF_CustomerRequests_RequestId DEFAULT NEWSEQUENTIALID(),
        CustomerName NVARCHAR(150) NOT NULL,
        VehicleModel NVARCHAR(100) NOT NULL,
        VehicleYear SMALLINT NOT NULL,
        Vin CHAR(17) NULL,
        HeadlightSide NVARCHAR(30) NOT NULL,
        PhotoFileName NVARCHAR(255) NOT NULL,
        PhotoMimeType VARCHAR(50) NOT NULL,
        PhotoSizeBytes INT NOT NULL,
        PhotoData VARBINARY(MAX) NOT NULL,
        Status VARCHAR(30) NOT NULL
            CONSTRAINT DF_CustomerRequests_Status DEFAULT 'submitted',
        CreatedAt DATETIME2(3) NOT NULL
            CONSTRAINT DF_CustomerRequests_CreatedAt DEFAULT SYSUTCDATETIME(),
        UpdatedAt DATETIME2(3) NOT NULL
            CONSTRAINT DF_CustomerRequests_UpdatedAt DEFAULT SYSUTCDATETIME(),

        CONSTRAINT CK_CustomerRequests_VehicleYear
            CHECK (VehicleYear BETWEEN 2007 AND 2014),
        CONSTRAINT CK_CustomerRequests_HeadlightSide
            CHECK (HeadlightSide IN ('Left (driver side)', 'Right (passenger side)', 'Not sure')),
        CONSTRAINT CK_CustomerRequests_PhotoSize
            CHECK (PhotoSizeBytes BETWEEN 1 AND 10485760),
        CONSTRAINT CK_CustomerRequests_Status
            CHECK (Status IN ('submitted', 'under_review', 'matched', 'closed'))
    );

    CREATE INDEX IX_CustomerRequests_Status_CreatedAt
        ON dbo.CustomerRequests (Status, CreatedAt DESC);
END;
GO

IF OBJECT_ID(N'dbo.CK_CustomerRequests_PhotoSize', N'C') IS NOT NULL
BEGIN
    ALTER TABLE dbo.CustomerRequests
        DROP CONSTRAINT CK_CustomerRequests_PhotoSize;
END;
GO

ALTER TABLE dbo.CustomerRequests WITH CHECK
    ADD CONSTRAINT CK_CustomerRequests_PhotoSize
        CHECK (PhotoSizeBytes BETWEEN 1 AND 10485760);
GO
