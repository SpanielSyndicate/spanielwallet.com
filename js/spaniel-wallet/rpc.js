// Spaniel Wallet — Solana JSON-RPC client (PWA-side).
//
// Minimal RPC surface. No external dependency (no @solana/web3.js)
// per /home/coins/work/spanielsyndicate/docs/SPANIEL_WALLET_SECURITY.md §6.
// All requests are plain `fetch` against the configured devnet (or
// mainnet, but Spaniel Wallet keeps the network selector explicit).
//
// Methods returned by `makeRpcClient(rpcUrl)`:
//   - getVersion()
//   - getBalance(pubkeyBase58) → { lamports: bigint, solApprox: number }
//   - getAccountInfo(pubkeyBase58, opts?) → { lamports, owner, dataBase64, executable, rentEpoch } | null
//   - getTokenAccountBalance(ataPubkeyBase58) → { uiAmount, amount: string, decimals } | null
//   - getLatestBlockhash() → { blockhash, lastValidBlockHeight }
//   - sendRawTransaction(serializedB64 | serializedB58, opts?) → signature
//   - confirmSignature(signature, { commitment='confirmed', timeoutMs }) → { confirmed, err }
//   - requestAirdrop(pubkeyBase58, lamports) → signature
//
// Errors come back as Error objects with a `.code` (numeric Solana
// RPC error code) and `.data` (the original error.data field). Network
// timeouts surface as Error with `.name === 'AbortError'`.

const DEFAULT_TIMEOUT_MS = 30_000;

export function makeRpcClient(rpcUrl, opts = {}) {
  if (typeof rpcUrl !== 'string' || !/^https?:\/\//.test(rpcUrl)) {
    throw new Error('makeRpcClient: rpcUrl must be a fully-qualified URL');
  }
  const fetchImpl = opts.fetch || globalThis.fetch;
  if (typeof fetchImpl !== 'function') {
    throw new Error('makeRpcClient: fetch is not available');
  }
  const timeoutMs = opts.timeoutMs || DEFAULT_TIMEOUT_MS;
  let rpcId = 1;

  async function rpc(method, params) {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), timeoutMs);
    try {
      const res = await fetchImpl(rpcUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: rpcId++,
          method,
          params: params || [],
        }),
        signal: ac.signal,
      });
      const body = await res.json();
      if (body.error) {
        const e = new Error(`rpc.${method}: ${body.error.message}`);
        e.code = body.error.code;
        e.data = body.error.data;
        throw e;
      }
      return body.result;
    } finally {
      clearTimeout(t);
    }
  }

  return {
    url: rpcUrl,

    async getVersion() {
      return rpc('getVersion');
    },

    async getBalance(pubkeyBase58) {
      const r = await rpc('getBalance', [pubkeyBase58, { commitment: 'confirmed' }]);
      const lamports = BigInt(r?.value ?? 0);
      return {
        lamports,
        solApprox: Number(lamports) / 1_000_000_000,
      };
    },

    async getAccountInfo(pubkeyBase58, opts = {}) {
      const r = await rpc('getAccountInfo', [
        pubkeyBase58,
        { encoding: opts.encoding || 'base64', commitment: 'confirmed' },
      ]);
      if (!r || !r.value) return null;
      const v = r.value;
      // base64 data lands as [b64, 'base64']
      const dataBase64 = Array.isArray(v.data) ? v.data[0] : null;
      return {
        lamports: BigInt(v.lamports || 0),
        owner: v.owner,
        dataBase64,
        executable: !!v.executable,
        rentEpoch: v.rentEpoch ?? 0,
      };
    },

    async getTokenAccountBalance(ataPubkeyBase58) {
      try {
        const r = await rpc('getTokenAccountBalance', [
          ataPubkeyBase58,
          { commitment: 'confirmed' },
        ]);
        if (!r || !r.value) return null;
        return {
          uiAmount: r.value.uiAmount,
          amount: r.value.amount,
          decimals: r.value.decimals,
        };
      } catch (e) {
        // -32602 = account does not exist (no token account yet)
        if (e.code === -32602) return null;
        throw e;
      }
    },

    async getLatestBlockhash() {
      const r = await rpc('getLatestBlockhash', [{ commitment: 'confirmed' }]);
      return {
        blockhash: r.value.blockhash,
        lastValidBlockHeight: r.value.lastValidBlockHeight,
      };
    },

    async sendRawTransaction(serialized, opts = {}) {
      // Default to base58 encoding (matches encodeBase58 from
      // wallet-core/base58.js).
      const encoding = opts.encoding || 'base58';
      return rpc('sendTransaction', [
        serialized,
        { encoding, skipPreflight: !!opts.skipPreflight, preflightCommitment: 'confirmed' },
      ]);
    },

    /** Poll for confirmation up to `timeoutMs`. Returns `{confirmed, err}`. */
    async confirmSignature(signature, opts = {}) {
      const commitment = opts.commitment || 'confirmed';
      const deadline = Date.now() + (opts.timeoutMs || 30_000);
      while (Date.now() < deadline) {
        const r = await rpc('getSignatureStatuses', [
          [signature],
          { searchTransactionHistory: true },
        ]);
        const s = r?.value?.[0];
        if (s) {
          if (s.err) return { confirmed: false, err: s.err, slot: s.slot };
          const ok = commitment === 'finalized'
            ? s.confirmationStatus === 'finalized'
            : (s.confirmationStatus === 'confirmed' || s.confirmationStatus === 'finalized');
          if (ok) return { confirmed: true, err: null, slot: s.slot };
        }
        await new Promise((res) => setTimeout(res, 500));
      }
      return { confirmed: false, err: 'timeout' };
    },

    async requestAirdrop(pubkeyBase58, lamports) {
      return rpc('requestAirdrop', [pubkeyBase58, Number(lamports)]);
    },
  };
}

// Mainnet refusal delegates to the single source of truth in
// /js/lib/solana-networks.js. Relative specifier so both the
// browser and Node's test loader resolve it correctly.
import { assertNotMainnetRpc as _assertNotMainnetRpc } from '../lib/solana-networks.js';

/**
 * Refuse mainnet RPC unless the runtime config explicitly enables it.
 *
 * Spaniel Wallet's default posture is devnet-only — production launch
 * requires the operator to flip a guard. The PWA must surface this
 * status prominently.
 */
export function assertNotProductionRpc(rpcUrl, { allowMainnet = false } = {}) {
  _assertNotMainnetRpc(rpcUrl, { allowMainnet });
}
