-- Add skippedQueue flag to UnmatchedLineItem
ALTER TABLE "UnmatchedLineItem" ADD COLUMN "skippedQueue" BOOLEAN NOT NULL DEFAULT false;
