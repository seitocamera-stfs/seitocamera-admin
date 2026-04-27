-- CreateTable
CREATE TABLE "payment_reminder_logs" (
    "id" TEXT NOT NULL,
    "issuedInvoiceId" TEXT NOT NULL,
    "sentTo" TEXT NOT NULL,
    "sentBy" TEXT NOT NULL,
    "subject" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_reminder_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "payment_reminder_logs_issuedInvoiceId_idx" ON "payment_reminder_logs"("issuedInvoiceId");

-- AddForeignKey
ALTER TABLE "payment_reminder_logs" ADD CONSTRAINT "payment_reminder_logs_issuedInvoiceId_fkey" FOREIGN KEY ("issuedInvoiceId") REFERENCES "issued_invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_reminder_logs" ADD CONSTRAINT "payment_reminder_logs_sentBy_fkey" FOREIGN KEY ("sentBy") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
