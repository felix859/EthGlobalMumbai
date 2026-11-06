// One-off: computes the agent's UAID, publishes its profile as one message on an identity topic,
// and writes IDENTITY_TOPIC_ID, AGENT_UAID to .env. Run: npm run setup:identity
import { appendFileSync, readFileSync } from "node:fs";
import { Client, PrivateKey, TopicCreateTransaction, TopicMessageSubmitTransaction } from "@hiero-ledger/sdk";
import { agentAid, agentProfile, buildUaid } from "../packages/agent/src/identity.ts";

const need = (k: string) => { const v = process.env[k]; if (!v) throw new Error(`Missing ${k} in .env`); return v; };
if (/^AGENT_UAID=\S+/m.test(readFileSync(".env", "utf8"))) {
  console.log("AGENT_UAID already set in .env, nothing to do.");
  process.exit(0);
}
const account = need("AGENT_ACCOUNT_ID");
const uaid = buildUaid(agentAid(account));
const client = Client.forTestnet().setOperator(account, PrivateKey.fromStringECDSA(need("AGENT_PRIVATE_KEY")));

const t = await new TopicCreateTransaction().setTopicMemo("PennyAgent identity (HCS-11-shaped profile, UAID per HCS-14 draft)").execute(client);
const topicId = (await t.getReceipt(client)).topicId!.toString();
const m = await new TopicMessageSubmitTransaction().setTopicId(topicId)
  .setMessage(JSON.stringify(agentProfile(account, uaid, process.env.AGENT_URL))).execute(client);
const seq = (await m.getReceipt(client)).topicSequenceNumber!.toString();

appendFileSync(".env", `\n# set by scripts/register-agent.ts\nIDENTITY_TOPIC_ID=${topicId}\nAGENT_UAID=${uaid}\n`);
console.log("UAID:", uaid);
console.log("profile published:", `https://hashscan.io/testnet/topic/${topicId}`, "sequence", seq);
client.close();
