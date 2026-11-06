// HTS receipt: after a run that bought data, mint one NFT recording what happened.
// This is the second native Hedera service (next to HCS) for the "No Solidity Allowed" prize.
import { AccountId, Client, PrivateKey, TokenId } from "@x402/hedera"; // single SDK copy
import { TokenMintTransaction } from "@hiero-ledger/sdk"; // deduped to the same 2.90.x install, see `npm ls @hiero-ledger/sdk`

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
  const text = `pennyagent:v1:${s.runId.slice(0, 8)}:${s.purchases}:${s.totalTinybars}`;
  return new TextEncoder().encode(text.slice(0, 100));
}

/** Mints one receipt NFT to the agent's account. Throws on failure; callers must not let that break a run. */
export async function mintReceipt(s: ReceiptSummary): Promise<Receipt> {
  const need = (k: string) => {
    const v = process.env[k];
    if (!v) throw new Error(`Missing ${k}`);
    return v;
  };
  const key = PrivateKey.fromStringECDSA(need("AGENT_PRIVATE_KEY"));
  const client = Client.forTestnet().setOperator(AccountId.fromString(need("AGENT_ACCOUNT_ID")), key);
  try {
    const tokenId = TokenId.fromString(need("RECEIPT_TOKEN_ID"));
    const res = await new TokenMintTransaction().setTokenId(tokenId as any).addMetadata(receiptMetadata(s)).execute(client as any);
    const rcpt = await res.getReceipt(client as any);
    return { tokenId: tokenId.toString(), serial: String(rcpt.serials[0]), txId: res.transactionId.toString() };
  } finally {
    client.close();
  }
}
