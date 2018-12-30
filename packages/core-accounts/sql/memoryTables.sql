/* Memory Tables
 *
 */

BEGIN;

CREATE TABLE IF NOT EXISTS "mem_accounts"(
  "secondSignature" SMALLINT DEFAULT 0,
  "u_secondSignature" SMALLINT DEFAULT 0,
  "address" VARCHAR(22) NOT NULL UNIQUE PRIMARY KEY,
  "publicKey" BYTEA,
  "secondPublicKey" BYTEA,
  "balance" BIGINT DEFAULT 0,
  "u_balance" BIGINT DEFAULT 0,
  "blockId" VARCHAR(20),
  "virgin" SMALLINT DEFAULT 1
);

CREATE INDEX IF NOT EXISTS "mem_accounts_balance" ON "mem_accounts"("balance");
CREATE UNIQUE INDEX IF NOT EXISTS "idx_accounts_address" on "mem_accounts"("address");

CREATE TRIGGER trg_memaccounts_update
  BEFORE UPDATE OF balance,u_balance
  on mem_accounts
  FOR EACH ROW EXECUTE PROCEDURE proc_balance_check();


CREATE TABLE IF NOT EXISTS "mem_accounts2multisignatures"(
  "accountId" VARCHAR(22) NOT NULL,
  "dependentId" VARCHAR(64) NOT NULL,
  FOREIGN KEY ("accountId") REFERENCES mem_accounts("address") ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS "mem_accounts2multisignatures_accountId" ON "mem_accounts2multisignatures"("accountId");

CREATE TABLE IF NOT EXISTS "mem_accounts2u_multisignatures"(
  "accountId" VARCHAR(22) NOT NULL,
  "dependentId" VARCHAR(64) NOT NULL,
  FOREIGN KEY ("accountId") REFERENCES mem_accounts("address") ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS "mem_accounts2u_multisignatures_accountId" ON "mem_accounts2u_multisignatures"("accountId");

DELETE FROM "mem_accounts2u_multisignatures";

INSERT INTO "mem_accounts2u_multisignatures" SELECT * FROM "mem_accounts2multisignatures";

COMMIT;
