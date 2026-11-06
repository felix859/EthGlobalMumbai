// One-off: creates the HTS NFT collection used for per-run receipts and writes RECEIPT_TOKEN_ID to .env.
// Run: npm run setup:receipt
import { appendFileSync, readFileSync } from "node:fs";
import { Client, PrivateKey, TokenCreateTransaction, TokenType, TokenSupplyType } from "@hiero-ledger/sdk";

const need = (k: string) => { const v = process.env[k]; if (!v) throw new Error(`Missing ${k} in .env`); return v; };
if (/^RECEIPT_TOKEN_ID=\S+/m.test(readFileSync(".env", "utf8"))) {
  console.log("RECEIPT_TOKEN_ID already set in .env, nothing to do.");
  process.exit(0);
}
const key = PrivateKey.fromStringECDSA(need("AGENT_PRIVATE_KEY"));
const client = Client.forTestnet().setOperator(need("AGENT_ACCOUNT_ID"), key);
const r = await new TokenCreateTransaction()
  .setTokenName("PennyAgent Receipt").setTokenSymbol("PENNY")
  .setTokenType(TokenType.NonFungibleUnique).setSupplyType(TokenSupplyType.Infinite)
  .setTreasuryAccountId(need("AGENT_ACCOUNT_ID")).setSupplyKey(key.publicKey)
  .setTokenMemo("One NFT per PennyAgent run: proof of what the agent bought")
  .execute(client);
const id = (await r.getReceipt(client)).tokenId!.toString();
appendFileSync(".env", `\n# set by scripts/create-receipt-token.ts\nRECEIPT_TOKEN_ID=${id}\n`);
console.log("receipt token:", id, `https://hashscan.io/testnet/token/${id}`);
client.close();
