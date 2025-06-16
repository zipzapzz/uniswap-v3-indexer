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
import { getContract, type PublicClient } from "viem";
import { convertTokenToDecimal, loadTransaction, numberToBytes32 } from './utils/index';

const POSITION_ABI = [{"inputs":[{"internalType":"bytes32","name":"tokenId","type":"bytes32"}],"name":"tokenOwnerOf","outputs":[{"internalType":"address","name":"","type":"address"}],"stateMutability":"view","type":"function"},{"inputs":[{"internalType":"uint256","name":"tokenId","type":"uint256"}],"name":"positions","outputs":[{"internalType":"uint96","name":"nonce","type":"uint96"},{"internalType":"address","name":"operator","type":"address"},{"internalType":"address","name":"token0","type":"address"},{"internalType":"address","name":"token1","type":"address"},{"internalType":"uint24","name":"fee","type":"uint24"},{"internalType":"int24","name":"tickLower","type":"int24"},{"internalType":"int24","name":"tickUpper","type":"int24"},{"internalType":"uint128","name":"liquidity","type":"uint128"},{"internalType":"uint256","name":"feeGrowthInside0LastX128","type":"uint256"},{"internalType":"uint256","name":"feeGrowthInside1LastX128","type":"uint256"},{"internalType":"uint128","name":"tokensOwed0","type":"uint128"},{"internalType":"uint128","name":"tokensOwed1","type":"uint128"}],"stateMutability":"view","type":"function"}] as const;
const FACTORY_ABI = [{"inputs":[{"internalType":"address","name":"tokenA","type":"address"},{"internalType":"address","name":"tokenB","type":"address"},{"internalType":"uint24","name":"fee","type":"uint24"}],"name":"getPool","outputs":[{"internalType":"address","name":"pool","type":"address"}],"stateMutability":"view","type":"function"}] as const;

async function getPosition(context: LoaderContext, chainId: number, positionId: string) {
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
        
        
        const factoryContract = getContract({
            address: FACTORY_ADDRESS as `0x${string}`,
            abi: FACTORY_ABI,
            client,
        });
        const poolAddress = await factoryContract.read.getPool([token0, token1, fee]);

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
            tickLower_id: `${poolAddress.toLowerCase()}#${tickLower}`,
            tickUpper_id: `${poolAddress.toLowerCase()}#${tickUpper}`,
            pool_id: poolAddress.toLowerCase(),
            token0_id: token0.toLowerCase(),
            token1_id: token1.toLowerCase(),
            transaction_id: "",
            withdrawnToken0: ONE_BD,
            withdrawnToken1: ONE_BD
        };
    }
    return position;
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