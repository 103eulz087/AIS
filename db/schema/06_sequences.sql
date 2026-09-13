IF NOT EXISTS (SELECT 1 FROM sys.sequences WHERE name = 'RenewalRefSeq')
    CREATE SEQUENCE dbo.RenewalRefSeq AS INT START WITH 1 INCREMENT BY 1;
GO
/* Receipt numbers are drawn from a sequence and NEVER reused.
   A voided receipt retires its number; a fresh one is issued. */
IF NOT EXISTS (SELECT 1 FROM sys.sequences WHERE name = 'AckReceiptSeq')
    CREATE SEQUENCE dbo.AckReceiptSeq AS INT START WITH 1 INCREMENT BY 1;
GO
