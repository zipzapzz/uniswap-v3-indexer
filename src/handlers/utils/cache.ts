
import { existsSync, mkdirSync } from "fs";
import { readFile, writeFile } from "fs/promises";
import { join } from "path";

const CACHE_DIR = join(__dirname, "../../../.cache");
if (!existsSync(CACHE_DIR)) {
  mkdirSync(CACHE_DIR, { recursive: true });
}

const getPoolCachePath = (chainId: number): string => {
    return join(CACHE_DIR, `poolAddress_${chainId}.json`);
};

// Cache of metadata per chainId
const metadataCaches: Record<number, Record<string, any>> = {};

// Load cache for a specific chain
export const loadPoolCache = async (chainId: number): Promise<Record<string, any>> => {
    if (!metadataCaches[chainId]) {
      const cachePath = getPoolCachePath(chainId);
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
export const savePoolCache = async (chainId: number, newKey: string, newValue: string ): Promise<void> => {
    const cachePath = getPoolCachePath(chainId);
    const newMetadataCache = await loadPoolCache(chainId);
    newMetadataCache[newKey] = newValue;
    // console.info(`Saving pool address cache for chain ${chainId} with key ${newKey} and value ${newValue}`);
    if (!newMetadataCache) {
        console.error(`No metadata cache found for chain ${chainId}`);
        return;
    }
    try {
        await writeFile(
        cachePath,
        JSON.stringify(newMetadataCache, null, 2)
        );
    } catch (e) {
        console.error(`Error saving token metadata cache for chain ${chainId}:`, e);
    }
};