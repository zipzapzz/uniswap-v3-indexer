/*
 * Please refer to https://docs.envio.dev for a thorough guide on all Envio indexer features
 */
import {
    NonfungiblePositionManager,
    // NonfungiblePositionManager_Collect,
    // NonfungiblePositionManager_DecreaseLiquidity,
    // NonfungiblePositionManager_IncreaseLiquidity,
    // NonfungiblePositionManager_Transfer,
    LoaderContext,
    positions as Positions
} from "generated";
import { 
    ONE_BI, 
    ZERO_BI, 
    ONE_BD, 
    ADDRESS_ZERO,
    FACTORY_ADDRESS,
    POSITIONS_ADDRESS,
} from './utils/constants';
import { getClient } from "./utils/rpc";
import { getContract } from "viem";
import { numberToBytes32 } from './utils/index';
import { loadPoolCache, savePoolCache } from "./utils/cache";

const POSITION_ABI = [{"inputs":[{"internalType":"bytes32","name":"tokenId","type":"bytes32"}],"name":"tokenOwnerOf","outputs":[{"internalType":"address","name":"","type":"address"}],"stateMutability":"view","type":"function"},{"inputs":[{"internalType":"uint256","name":"tokenId","type":"uint256"}],"name":"positions","outputs":[{"internalType":"uint96","name":"nonce","type":"uint96"},{"internalType":"address","name":"operator","type":"address"},{"internalType":"address","name":"token0","type":"address"},{"internalType":"address","name":"token1","type":"address"},{"internalType":"uint24","name":"fee","type":"uint24"},{"internalType":"int24","name":"tickLower","type":"int24"},{"internalType":"int24","name":"tickUpper","type":"int24"},{"internalType":"uint128","name":"liquidity","type":"uint128"},{"internalType":"uint256","name":"feeGrowthInside0LastX128","type":"uint256"},{"internalType":"uint256","name":"feeGrowthInside1LastX128","type":"uint256"},{"internalType":"uint128","name":"tokensOwed0","type":"uint128"},{"internalType":"uint128","name":"tokensOwed1","type":"uint128"}],"stateMutability":"view","type":"function"}] as const;
const FACTORY_ABI = [{"inputs":[{"internalType":"address","name":"tokenA","type":"address"},{"internalType":"address","name":"tokenB","type":"address"},{"internalType":"uint24","name":"fee","type":"uint24"}],"name":"getPool","outputs":[{"internalType":"address","name":"pool","type":"address"}],"stateMutability":"view","type":"function"}] as const;

async function getPoolAddressWithRetry(
    chainId: number,
    token0: string,
    token1: string,
    fee: number,
    retries = 3,
    delayMs = 1000
  ): Promise<string | null> {
    // add get pool address from cache by token0, token1, fee
    if (!token0 || !token1 || fee <= 0) {
      console.error("Invalid parameters for getPoolAddressWithRetry");
      return null;
    }

    // Create the cache key
    const cacheKey = `${token0.toLowerCase()}-${token1.toLowerCase()}-${fee}`;
    // Check if the pool address is already cached

    const metadataCache = await loadPoolCache(chainId);
    // Check cache first - use original address (with checksum) as cache key
    if (metadataCache[cacheKey]) {
        // context.log.info(
        //   `Using cached metadata for token ${address} on chain ${chainId}`
        // );
        // console.info(`Using cached pool address for ${cacheKey}`);
        return metadataCache[cacheKey];
    }

    const client = getClient(chainId);

    const factoryContract = getContract({
      address: FACTORY_ADDRESS as `0x${string}`,
      abi: FACTORY_ABI,
      client,
    });
  
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        const poolAddress = await factoryContract.read.getPool([token0 as `0x${string}`, token1 as `0x${string}`, fee]);
        // save pool address to cache
        await savePoolCache(chainId, cacheKey, poolAddress.toLowerCase());
        return poolAddress;
      } catch (error) {
        console.error(`Attempt ${attempt} failed to get pool:`, error);
        if (attempt < retries) {
          await new Promise((resolve) => setTimeout(resolve, delayMs));
        }
      }
    }
  
    console.error(`All ${retries} attempts failed. Could not get pool address.`);
    return null;
  }

async function getPosition(context: LoaderContext, chainId: number, positionId: string) {
    try {
        const client = getClient(chainId);
        let position = await context.positions.get(positionId);
        if (!position) {
            const contract = getContract({
                address: POSITIONS_ADDRESS as `0x${string}`,
                abi: POSITION_ABI,
                client,
            });
            const positionData = await contract.read.positions([BigInt(positionId)]); 
            if (!positionData) {
                return null;
            }
            const [nonce, owner, token0, token1, fee, tickLower, tickUpper, 
                liquidity, feeGrowthInside0LastX128, feeGrowthInside1LastX128, 
                tokensOwed0, tokensOwed1] = positionData;
            
            let newOwner = owner.toLowerCase();
            try {
                newOwner = await contract.read.tokenOwnerOf([numberToBytes32(positionId) as `0x${string}`]);
                newOwner = newOwner.toLowerCase();
            } catch (error) {
                
            }
            
            // const factoryContract = getContract({
            //     address: FACTORY_ADDRESS as `0x${string}`,
            //     abi: FACTORY_ABI,
            //     client,
            // });
            // const poolAddress = await factoryContract.read.getPool([token0, token1, fee]);

            const pool = await getPoolAddressWithRetry(chainId, token0, token1, fee);
            const poolAddress = pool ? pool.toLowerCase() : ADDRESS_ZERO;

            // get contract postion, call rpc to get position details

            position = {
                id: positionId,
                owner: newOwner,
                liquidity,
                feeGrowthInside0LastX128,
                feeGrowthInside1LastX128,
                amountCollectedUSD: ONE_BD,
                amountDepositedUSD: ONE_BD,
                amountWithdrawnUSD: ONE_BD,
                collectedFeesToken0: ONE_BD,
                collectedFeesToken1: ONE_BD,
                collectedToken0: ONE_BD,
                collectedToken1: ONE_BD,
                depositedToken0: ONE_BD,
                depositedToken1: ONE_BD,
                tickLower_id: `${poolAddress}#${tickLower}`,
                tickUpper_id: `${poolAddress}#${tickUpper}`,
                pool_id: poolAddress,
                token0_id: token0.toLowerCase(),
                token1_id: token1.toLowerCase(),
                transaction_id: "",
                withdrawnToken0: ONE_BD,
                withdrawnToken1: ONE_BD
            };
        }
        return position;
    } catch (error) {
        console.error(`Error fetching position ${positionId} on chain ${chainId}:`, error);
        return;
    }
    
}
NonfungiblePositionManager.Collect.handlerWithLoader({
    loader: async ({ event, context }) => {
        const position = await getPosition(context, event.chainId, `${event.params.tokenId}`);
        return position;
    },
    handler: async ({ event, context, loaderReturn }) => {
        if (!loaderReturn) return;
        let position = loaderReturn;

        context.positions.set(position);
    }
});
  
  NonfungiblePositionManager.DecreaseLiquidity.handlerWithLoader({
    loader: async ({ event, context }) => {
        const position = await getPosition(context, event.chainId, `${event.params.tokenId}`);
        return position;
    },
    handler: async ({ event, context, loaderReturn }) => {
        if (!loaderReturn) return;
        const position = loaderReturn;
        // let token0 = await context.Token.get(position.token0_id)
        // let token1 = await context.Token.get(position.token1_id)
        // if (!token0 || !token1) return;
        // let amount0 = convertTokenToDecimal(event.params.amount0, token0.decimals)
        // let amount1 = convertTokenToDecimal(event.params.amount1, token1.decimals)

        const newPosition = {
            ...position,
            liquidity: position.liquidity - BigInt(event.params.liquidity),
        };
        context.positions.set(newPosition);
    }
});
  
  NonfungiblePositionManager.IncreaseLiquidity.handlerWithLoader({
    loader: async ({ event, context }) => {
        const position = await getPosition(context, event.chainId, `${event.params.tokenId}`);
        return position;
    },
    handler: async ({ event, context, loaderReturn }) => {
        if (!loaderReturn) return;
        const position = loaderReturn;
        const newPosition = {
            ...position,
            liquidity: position.liquidity + BigInt(event.params.liquidity),
        };
        context.positions.set(newPosition);
    }
});
  
  NonfungiblePositionManager.Transfer.handlerWithLoader({
    loader: async ({ event, context }) => {
        const position = await getPosition(context, event.chainId, `${event.params.tokenId}`);
        return position;
    },
    handler: async ({ event, context, loaderReturn }) => {
        if (!loaderReturn) return;
        const position = loaderReturn;
        const newPosition = {
            ...position,
            owner: event.params.to.toLowerCase(),
        };
        context.positions.set(newPosition);
    }
});