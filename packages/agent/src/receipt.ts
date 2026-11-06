// HTS receipt: after a run that bought data, mint one NFT recording what happened.
// This is the second native Hedera service (next to HCS) for the "No Solidity Allowed" prize.
// All SDK classes from ONE import, so they are guaranteed to be the same copy (no instanceof mismatches). The agent
// declares @hiero-ledger/sdk at the version @x402/hedera pins, so npm dedupes them; `npm ls @hiero-ledger/sdk` shows it.
import { AccountId, Client, PrivateKey, TokenId, TokenMintTransaction } from "@hiero-ledger/sdk";

export interface ReceiptSummary {
  runId: string;
  purchases: number;
  totalTinybars: bigint;
}
export interface Receipt {
  tokenId: string;
  serial: string;
  txId: string;
}

/** HTS NFT metadata is limited to 100 bytes. */
export function receiptMetadata(s: ReceiptSummary): Uint8Array {
  const bytes = new TextEncoder().encode(`pennyagent:v1:${s.runId.slice(0, 8)}:${s.purchases}:${s.totalTinybars}`);
  return bytes.length <= 100 ? bytes : bytes.slice(0, 100); // the limit is in bytes, not characters
}

/** Mints one receipt NFT to the agent's account. Throws on failure; callers must not let that break a run. */
export async function mintReceipt(s: ReceiptSummary): Promise<Receipt> {
  const need = (k: string) => {
    const v = process.env[k];
    if (!v) throw new Error(`Missing ${k}`);
    return v;
  };
  const key = PrivateKey.fromStringECDSA(need("AGENT_PRIVATE_KEY"));
  // Testnet only by design (see README limitations).
  const client = Client.forTestnet().setOperator(AccountId.fromString(need("AGENT_ACCOUNT_ID")), key);
  try {
    const tokenId = TokenId.fromString(need("RECEIPT_TOKEN_ID"));
    const res = await new TokenMintTransaction().setTokenId(tokenId).addMetadata(receiptMetadata(s)).execute(client);
    const rcpt = await res.getReceipt(client);
    return { tokenId: tokenId.toString(), serial: String(rcpt.serials[0]), txId: res.transactionId.toString() };
  } finally {
    client.close();
  }
}
