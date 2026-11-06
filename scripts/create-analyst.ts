// One-off: creates the Analyst agent's own testnet account, funded from the agent account,
// and writes ANALYST_ACCOUNT_ID / ANALYST_PRIVATE_KEY to .env. Run: npm run setup:analyst
import { appendFileSync, readFileSync } from "node:fs";
import { Client, PrivateKey, AccountCreateTransaction, Hbar } from "@hiero-ledger/sdk";

const need = (k: string) => { const v = process.env[k]; if (!v) throw new Error(`Missing ${k} in .env`); return v; };
if (/^ANALYST_ACCOUNT_ID=\S+/m.test(readFileSync(".env", "utf8"))) {
  console.log("ANALYST_ACCOUNT_ID already set in .env, nothing to do.");
  process.exit(0);
}
const client = Client.forTestnet().setOperator(need("AGENT_ACCOUNT_ID"), PrivateKey.fromStringECDSA(need("AGENT_PRIVATE_KEY")));
const key = PrivateKey.generateECDSA();
const r = await new AccountCreateTransaction().setKeyWithoutAlias(key.publicKey).setInitialBalance(new Hbar(5)).execute(client);
const id = (await r.getReceipt(client)).accountId!.toString();
appendFileSync(".env", `\n# set by scripts/create-analyst.ts\nANALYST_ACCOUNT_ID=${id}\nANALYST_PRIVATE_KEY=${key.toStringRaw()}\n`);
console.log("analyst account:", id, `https://hashscan.io/testnet/account/${id}`);
client.close();
