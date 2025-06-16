import { experimental_createEffect, S } from "envio";
import { createPublicClient, http, getContract, type PublicClient } from "viem";
import { existsSync, mkdirSync } from "fs";
import { readFile, writeFile } from "fs/promises";
import { join } from "path";
import { ADDRESS_ZERO } from "./constants";
import { getChainConfig } from "./chains";
import * as dotenv from "dotenv";
import { keccak256, toUtf8Bytes, ethers } from 'ethers';
import { getRpcUrl } from "./rpc";

dotenv.config();

const ERC20_ABI = [
  {
    inputs: [],
    name: "name",
    outputs: [{ type: "string" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "NAME",
    outputs: [{ type: "bytes32" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "symbol",
    outputs: [{ type: "string" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "SYMBOL",
    outputs: [{ type: "bytes32" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "decimals",
    outputs: [{ type: "uint8" }],
    stateMutability: "view",
    type: "function",
  },
] as const;

const LSP7ABI = [{"type":"function","name":"totalSupply","inputs":[],"outputs":[{"name":"","type":"uint256","internalType":"uint256"}],"stateMutability":"view"},{"type":"function","name":"balanceOf","inputs":[{"name":"tokenOwner","type":"address","internalType":"address"}],"outputs":[{"name":"","type":"uint256","internalType":"uint256"}],"stateMutability":"view"},{"type":"function","name":"decimals","inputs":[],"outputs":[{"name":"","type":"uint8","internalType":"uint8"}],"stateMutability":"view"},{"type":"function","name":"getData","inputs":[{"name":"dataKey","type":"bytes32","internalType":"bytes32"}],"outputs":[{"name":"dataValue","type":"bytes","internalType":"bytes"}],"stateMutability":"view"},{"type":"function","name":"getDataBatch","inputs":[{"name":"dataKeys","type":"bytes32[]","internalType":"bytes32[]"}],"outputs":[{"name":"dataValues","type":"bytes[]","internalType":"bytes[]"}],"stateMutability":"view"}] as const;

// Create .cache directory if it doesn't exist
const CACHE_DIR = join(__dirname, "../../../.cache");
if (!existsSync(CACHE_DIR)) {
  mkdirSync(CACHE_DIR, { recursive: true });
}

// Function to get cache path for a specific chain
const getCachePath = (chainId: number): string => {
  return join(CACHE_DIR, `tokenMetadata_${chainId}.json`);
};

// Cache of metadata per chainId
const metadataCaches: Record<number, Record<string, any>> = {};

// Load cache for a specific chain
const loadCache = async (chainId: number): Promise<Record<string, any>> => {
  if (!metadataCaches[chainId]) {
    const cachePath = getCachePath(chainId);
    if (existsSync(cachePath)) {
      try {
        metadataCaches[chainId] = JSON.parse(await readFile(cachePath, "utf8"));
      } catch (e) {
        console.error(
          `Error loading token metadata cache for chain ${chainId}:`,
          e
        );
        metadataCaches[chainId] = {};
      }
    } else {
      metadataCaches[chainId] = {};
    }
  }
  return metadataCaches[chainId];
};

// Save cache for a specific chain
const saveCache = async (chainId: number): Promise<void> => {
  const cachePath = getCachePath(chainId);
  try {
    await writeFile(
      cachePath,
      JSON.stringify(metadataCaches[chainId], null, 2)
    );
  } catch (e) {
    console.error(`Error saving token metadata cache for chain ${chainId}:`, e);
  }
};

// Cache of clients per chainId
const clients: Record<number, PublicClient> = {};

// Function to sanitize strings
function sanitizeString(str: string): string {
  if (!str) return "";
  return str.replace(/[\u0000-\u001F\u007F-\u009F]/g, "").trim();
}

// Create the token metadata effect
export const getTokenMetadataEffect = experimental_createEffect(
  {
    name: "getTokenMetadata",
    input: {
      address: S.string,
      chainId: S.number,
    },
    output: {
      name: S.string,
      symbol: S.string,
      decimals: S.number,
    },
  },
  async ({ input, context }) => {
    const { address, chainId } = input;
    // Normalize address only for comparisons, not for cache keys
    const normalizedAddress = address.toLowerCase();

    // Load cache for this chain
    const metadataCache = await loadCache(chainId);

    // Check cache first - use original address (with checksum) as cache key
    if (metadataCache[address]) {
      context.log.info(
        `Using cached metadata for token ${address} on chain ${chainId}`
      );
      return metadataCache[address];
    }

    try {
      // Handle native token
      if (normalizedAddress === ADDRESS_ZERO.toLowerCase()) {
        const chainConfig = getChainConfig(chainId);
        const result = {
          name: chainConfig.nativeTokenDetails.name,
          symbol: chainConfig.nativeTokenDetails.symbol,
          decimals: Number(chainConfig.nativeTokenDetails.decimals),
        };

        // Update cache - use original address as key
        metadataCache[address] = result;
        await saveCache(chainId);

        return result;
      }

      // Check for token overrides
      const chainConfig = getChainConfig(chainId);
      const tokenOverride = chainConfig.tokenOverrides.find(
        (t) => t.address.toLowerCase() === normalizedAddress
      );

      if (tokenOverride) {
        const result = {
          name: tokenOverride.name,
          symbol: tokenOverride.symbol,
          decimals: Number(tokenOverride.decimals),
        };

        // Update cache - use original address as key
        metadataCache[address] = result;
        await saveCache(chainId);

        return result;
      }

      // Get or create a client with batching enabled
      if (!clients[chainId]) {
        clients[chainId] = createPublicClient({
          transport: http(getRpcUrl(chainId), { batch: true }),
        });
        context.log.info(
          `Created client for chain ${chainId} with batching enabled`
        );
      }

      let name = "unknown";
      let symbol = "UNKNOWN";
      let decimalsResult = 18; // Default to 18 decimals

      if (chainId === 42) {
        const contract = getContract({
          address: address as `0x${string}`,
          abi: LSP7ABI,
          client: clients[chainId],
        });
        const decimalsPromise = contract.read.decimals().catch(() => 18); // Default to 18
    
        const nameKey = keccak256(toUtf8Bytes('LSP4TokenName')) as `0x${string}`;
        const symbolKey = keccak256(toUtf8Bytes('LSP4TokenSymbol')) as `0x${string}`;
        const nameValuePromise = contract.read.getData([nameKey]).catch(() => null);
        const symbolValuePromise = contract.read.getData([symbolKey]).catch(() => null);
        
        const [
          nameValue,
          symbolValue,
          decimalsResult,
        ] = await Promise.all([
          nameValuePromise,
          symbolValuePromise,
          decimalsPromise,
        ]);
    
          name = nameValue ? ethers.toUtf8String(nameValue) : "unknown";
          name = sanitizeString(name);
          symbol = symbolValue ? ethers.toUtf8String(symbolValue) : "UNKNOWN"; 
          symbol = sanitizeString(symbol);         
      }
      else {
          // Create contract instance with proper typing
        const contract = getContract({
          address: address as `0x${string}`,
          abi: ERC20_ABI,
          client: clients[chainId],
        });

        // Use Promise.all to execute all calls in parallel
        // They will be automatically batched thanks to the batch option
        const promises = [
          contract.read.name().catch(() => null),
          contract.read.NAME().catch(() => null),
          contract.read.symbol().catch(() => null),
          contract.read.SYMBOL().catch(() => null),
          contract.read.decimals().catch(() => 18),
        ];

        const results = await Promise.all(promises);
        const nameResult = results[0];
        const nameBytes32Result = results[1] as string | null;
        const symbolResult = results[2];
        const symbolBytes32Result = results[3] as string | null;
        decimalsResult = typeof results[4] === 'number' ? results[4] : 18; // Default to 18 if null or not a number

        // Process name with fallbacks
        
        if (nameResult !== null) {
          name = sanitizeString(nameResult as string);
        } else if (nameBytes32Result !== null) {
          name = sanitizeString(
            new TextDecoder().decode(
              new Uint8Array(
                Buffer.from(nameBytes32Result.slice(2), "hex").filter(
                  (n) => n !== 0
                )
              )
            )
          );
        }

        // Process symbol with fallbacks
        if (symbolResult !== null) {
          symbol = sanitizeString(symbolResult as string);
        } else if (symbolBytes32Result !== null) {
          symbol = sanitizeString(
            new TextDecoder().decode(
              new Uint8Array(
                Buffer.from(symbolBytes32Result.slice(2), "hex").filter(
                  (n) => n !== 0
                )
              )
            )
          );
        }

        
      }

      const result = {
        name: name || "unknown",
        symbol: symbol || "UNKNOWN",
        decimals: typeof decimalsResult === "number" ? decimalsResult : 18,
      };

      context.log.info(
        `Fetched metadata for token ${address} on chain ${chainId}`
      );

      // Update cache - use original address as key
      metadataCache[address] = result;
      await saveCache(chainId);

      return result;
    } catch (error) {
      context.log.error(
        `Error fetching metadata for ${address} on chain ${chainId}`,
        error as Error
      );
      return {
        name: "unknown",
        symbol: "UNKNOWN",
        decimals: 18,
      };
    }
  }
);
