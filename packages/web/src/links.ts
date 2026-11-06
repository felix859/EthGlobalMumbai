import { hashscanTxUrl } from "@pennyagent/shared";

const ID = /^0\.0\.[0-9]{1,12}$/;
export const accountUrl = (id: string) => (ID.test(id) ? `https://hashscan.io/testnet/account/${id}` : undefined);
export const topicUrl = (id: string) => (ID.test(id) ? `https://hashscan.io/testnet/topic/${id}` : undefined);
export const txUrl = (txId: string) => (/^0\.0\.[0-9]+@[0-9]+\.[0-9]+$/.test(txId) ? hashscanTxUrl(txId) : undefined);
export const shortUaid = (uaid: string) => {
  const id = uaid.split(";")[0].replace(/^uaid:aid:/, "");
  return id.length > 14 ? `${id.slice(0, 6)}…${id.slice(-6)}` : id;
};
