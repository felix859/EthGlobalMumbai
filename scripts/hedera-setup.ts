// One-off: creates the merchant account and the HCS audit topic on testnet,
// funded/paid by the agent account, and appends the ids to .env.
// Run: npm run setup:hedera
import { readFileSync, appendFileSync } from "node:fs";
import {
  Client, PrivateKey, AccountCreateTransaction, Hbar, TopicCreateTransaction,
} from "@hiero-ledger/sdk";

const env = (k: string) => {
  const v = process.env[k];
  if (!v) throw new Error(`Missing ${k} in .env`);
  return v;
};
const hasKey = (k: string) => new RegExp(`^${k}=\\S+`, "m").test(readFileSync(".env", "utf8"));

const agentKey = PrivateKey.fromStringECDSA(env("AGENT_PRIVATE_KEY"));
const client = Client.forTestnet().setOperator(env("AGENT_ACCOUNT_ID"), agentKey);

if (!hasKey("MERCHANT_PRIVATE_KEY")) {
  const key = PrivateKey.generateECDSA();
  const r = await new AccountCreateTransaction()
    .setKeyWithoutAlias(key.publicKey).setInitialBalance(new Hbar(10)).execute(client);
  const id = (await r.getReceipt(client)).accountId!.toString();
  appendFileSync(".env", `\n# set by scripts/hedera-setup.ts\nMERCHANT_ACCOUNT_ID=${id}\nMERCHANT_PRIVATE_KEY=${key.toStringRaw()}\n`);
  console.log("merchant account:", id, `https://hashscan.io/testnet/account/${id}`);
}
if (!hasKey("HCS_TOPIC_ID") || /^HCS_TOPIC_ID=0\.0\.x+/m.test(readFileSync(".env", "utf8"))) {
  // Submit key = the agent's key, so only the agent can append audit entries (the original demo topic predates this;
  // the dashboard also filters by submitting account).
  const r = await new TopicCreateTransaction().setTopicMemo("PennyAgent audit log").setSubmitKey(agentKey.publicKey).execute(client);
  const id = (await r.getReceipt(client)).topicId!.toString();
  appendFileSync(".env", `HCS_TOPIC_ID=${id}\n`);
  console.log("HCS topic:", id, `https://hashscan.io/testnet/topic/${id}`);
}
client.close();
