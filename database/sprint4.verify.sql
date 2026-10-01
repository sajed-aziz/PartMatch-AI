-- Integration checks against a local database with schema.sql and sprint4.sql.
-- All fixture data is rolled back, including when an assertion fails.
USE [PartMatchAI];
GO
SET NOCOUNT ON;
SET XACT_ABORT ON;
BEGIN TRY
    BEGIN TRANSACTION;
    DECLARE @owner uniqueidentifier = NEWID(), @other uniqueidentifier = NEWID();
    DECLARE @request uniqueidentifier = NEWID(), @cancel uniqueidentifier = NEWID(), @part uniqueidentifier = NEWID();
    INSERT dbo.Customers (CustomerId, Username, PasswordHash)
    VALUES (@owner, 's4_' + REPLACE(CONVERT(varchar(36), @owner), '-', ''), 'integration-fixture'),
           (@other, 's4_' + REPLACE(CONVERT(varchar(36), @other), '-', ''), 'integration-fixture');
    INSERT dbo.CustomerRequests (RequestId, CustomerId, CustomerName, VehicleModel, VehicleYear, HeadlightSide,
        PhotoFileName, PhotoMimeType, PhotoSizeBytes, PhotoData, ConsentVersion, ConsentAcceptedAt)
    VALUES (@request, @owner, 'Integration fixture', 'Mercedes-Benz C-Class (W204)', 2012, 'Left (driver side)',
        'test.png', 'image/png', 1, 0x01, '2026-09-25', SYSUTCDATETIME()),
        (@cancel, @owner, 'Integration fixture', 'Mercedes-Benz C-Class (W204)', 2012, 'Left (driver side)',
        'test.png', 'image/png', 1, 0x01, '2026-09-25', SYSUTCDATETIME());

    UPDATE dbo.CustomerRequests SET Status = 'under_review' WHERE RequestId = @request;
    IF (SELECT COUNT(*) FROM dbo.CustomerNotifications WHERE RequestId = @request) <> 1
        THROW 51000, 'Review notification was not generated once.', 1;
    UPDATE dbo.CustomerRequests SET UpdatedAt = SYSUTCDATETIME() WHERE RequestId = @request;
    IF (SELECT COUNT(*) FROM dbo.CustomerNotifications WHERE RequestId = @request) <> 1
        THROW 51000, 'Unchanged status generated a duplicate notification.', 1;

    INSERT dbo.InventoryParts (PartId, PartName, HeadlightSide, PartCondition, Price, SellerConfirmed)
    VALUES (@part, 'Integration headlight', 'Left (driver side)', 'used', 25, 1);
    INSERT dbo.RequestMatches (RequestId, PartId) VALUES (@request, @part);
    UPDATE dbo.CustomerRequests SET Status = 'matched' WHERE RequestId = @request;
    IF (SELECT COUNT(*) FROM dbo.CustomerNotifications WHERE RequestId = @request) <> 2
        THROW 51000, 'Confirmation notification was missing or duplicated.', 1;

    UPDATE dbo.CustomerNotifications SET ReadAt = SYSUTCDATETIME() WHERE CustomerId = @other;
    IF (SELECT COUNT(*) FROM dbo.CustomerNotifications WHERE CustomerId = @owner AND ReadAt IS NULL) <> 2
        THROW 51000, 'Another customer changed notification read state.', 1;
    UPDATE dbo.CustomerNotifications SET ReadAt = SYSUTCDATETIME() WHERE CustomerId = @owner;
    IF EXISTS (SELECT 1 FROM dbo.CustomerNotifications WHERE CustomerId = @owner AND ReadAt IS NULL)
        THROW 51000, 'Mark all as read failed.', 1;

    UPDATE dbo.CustomerRequests SET Status = 'closed', CancelledAt = SYSUTCDATETIME(), UpdatedAt = SYSUTCDATETIME()
    WHERE RequestId = @cancel AND CustomerId = @owner AND Status = 'submitted'
        AND CancelledAt IS NULL AND NOT EXISTS (SELECT 1 FROM dbo.RequestMatches WHERE RequestId = @cancel);
    IF NOT EXISTS (SELECT 1 FROM dbo.CustomerNotifications WHERE RequestId = @cancel AND Kind = 'request_cancelled')
        THROW 51000, 'Cancellation notification was not generated.', 1;
    UPDATE dbo.CustomerRequests SET Status = 'closed', CancelledAt = SYSUTCDATETIME()
    WHERE RequestId = @request AND CustomerId = @owner AND Status = 'submitted';
    IF @@ROWCOUNT <> 0 THROW 51000, 'Matched request was cancelled.', 1;

    UPDATE dbo.CustomerRequests SET Status = 'closed' WHERE RequestId = @request;
    INSERT dbo.CustomerRequestFeedback (RequestId, CustomerId, Rating, Comment)
    SELECT RequestId, CustomerId, 5, 'Helpful service' FROM dbo.CustomerRequests
    WHERE RequestId = @request AND CustomerId = @owner AND Status = 'closed' AND CancelledAt IS NULL;
    IF NOT EXISTS (SELECT 1 FROM dbo.CustomerRequestFeedback WHERE RequestId = @request AND Rating = 5)
        THROW 51000, 'Feedback was not saved.', 1;
    INSERT dbo.CustomerRequestFeedback (RequestId, CustomerId, Rating, Comment)
    SELECT RequestId, CustomerId, 5, '' FROM dbo.CustomerRequests
    WHERE RequestId = @cancel AND CustomerId = @owner AND Status = 'closed' AND CancelledAt IS NULL;
    IF @@ROWCOUNT <> 0 THROW 51000, 'Cancelled request received feedback.', 1;

    -- Trigger notifications must roll back together with the seller change.
    SAVE TRANSACTION BeforeReconfirmation;
    DECLARE @before int = (SELECT COUNT(*) FROM dbo.CustomerNotifications WHERE RequestId = @request);
    UPDATE dbo.CustomerRequests SET Status = 'under_review' WHERE RequestId = @request;
    ROLLBACK TRANSACTION BeforeReconfirmation;
    IF (SELECT COUNT(*) FROM dbo.CustomerNotifications WHERE RequestId = @request) <> @before
        THROW 51000, 'Rolled back update left a notification behind.', 1;
    ROLLBACK TRANSACTION;
    PRINT 'Sprint 4 SQL integration checks passed; all fixtures rolled back.';
END TRY
BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
    THROW;
END CATCH;
GO
