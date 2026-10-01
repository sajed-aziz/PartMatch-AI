-- Run after schema.sql. Safe to rerun; does not change seller workflows.
USE [PartMatchAI];
GO

IF COL_LENGTH(N'dbo.CustomerRequests', N'CancelledAt') IS NULL
    ALTER TABLE dbo.CustomerRequests ADD CancelledAt DATETIME2(3) NULL;
GO

IF OBJECT_ID(N'dbo.CustomerNotifications', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.CustomerNotifications (
        NotificationId UNIQUEIDENTIFIER NOT NULL PRIMARY KEY DEFAULT NEWSEQUENTIALID(),
        CustomerId UNIQUEIDENTIFIER NOT NULL REFERENCES dbo.Customers(CustomerId),
        RequestId UNIQUEIDENTIFIER NOT NULL REFERENCES dbo.CustomerRequests(RequestId) ON DELETE CASCADE,
        Kind VARCHAR(30) NOT NULL,
        Message NVARCHAR(500) NOT NULL,
        CreatedAt DATETIME2(3) NOT NULL DEFAULT SYSUTCDATETIME(),
        ReadAt DATETIME2(3) NULL,
        CONSTRAINT CK_CustomerNotifications_Kind CHECK (Kind IN ('status_changed', 'match_confirmed', 'request_cancelled'))
    );
    CREATE INDEX IX_CustomerNotifications_Customer_Created
        ON dbo.CustomerNotifications (CustomerId, CreatedAt DESC, NotificationId DESC) INCLUDE (ReadAt);
END;
GO

IF OBJECT_ID(N'dbo.CustomerRequestFeedback', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.CustomerRequestFeedback (
        RequestId UNIQUEIDENTIFIER NOT NULL PRIMARY KEY REFERENCES dbo.CustomerRequests(RequestId) ON DELETE CASCADE,
        CustomerId UNIQUEIDENTIFIER NOT NULL REFERENCES dbo.Customers(CustomerId),
        Rating TINYINT NOT NULL CHECK (Rating BETWEEN 1 AND 5),
        Comment NVARCHAR(1000) NOT NULL,
        CreatedAt DATETIME2(3) NOT NULL DEFAULT SYSUTCDATETIME()
    );
END;
GO

-- Capture changes from any seller implementation, atomically with the update.
-- Existing history is not backfilled; no notifications for unchanged status.
CREATE OR ALTER TRIGGER dbo.TR_CustomerRequests_Notifications
ON dbo.CustomerRequests AFTER UPDATE AS
BEGIN
    SET NOCOUNT ON;
    INSERT dbo.CustomerNotifications (CustomerId, RequestId, Kind, Message)
    SELECT i.CustomerId, i.RequestId,
        CASE WHEN i.CancelledAt IS NOT NULL THEN 'request_cancelled' ELSE 'status_changed' END,
        CASE WHEN i.CancelledAt IS NOT NULL THEN N'Your request was cancelled.'
             WHEN i.Status = 'under_review' THEN N'A seller has started reviewing your request.'
             WHEN i.Status = 'matched' THEN N'Your request has been matched.'
             WHEN i.Status = 'closed' THEN N'Your request is closed. You can now leave feedback.'
             ELSE N'Your request has been submitted.' END
    FROM inserted i JOIN deleted d ON d.RequestId = i.RequestId
    WHERE i.CustomerId IS NOT NULL AND i.Status <> d.Status
      AND (i.Status <> 'matched' OR NOT EXISTS (
          SELECT 1 FROM dbo.RequestMatches m WHERE m.RequestId = i.RequestId
      ));
END;
GO

CREATE OR ALTER TRIGGER dbo.TR_RequestMatches_Notifications
ON dbo.RequestMatches AFTER INSERT, UPDATE AS
BEGIN
    SET NOCOUNT ON;
    INSERT dbo.CustomerNotifications (CustomerId, RequestId, Kind, Message)
    SELECT r.CustomerId, i.RequestId, 'match_confirmed', N'A seller confirmed a compatible part. View your request for details.'
    FROM inserted i JOIN dbo.CustomerRequests r ON r.RequestId = i.RequestId
    LEFT JOIN deleted d ON d.MatchId = i.MatchId
    WHERE r.CustomerId IS NOT NULL AND r.Status <> 'closed'
      AND (d.MatchId IS NULL OR d.PartId <> i.PartId OR d.ConfirmedAt <> i.ConfirmedAt);
END;
GO
