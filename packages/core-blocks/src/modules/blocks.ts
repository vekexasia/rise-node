import {
  IBlocksModule,
  ILogger,
  ITimeToEpoch,
  Symbols,
} from '@risevision/core-interfaces';
import { IPeersModule } from '@risevision/core-p2p';
import { SignedAndChainedBlockType } from '@risevision/core-types';
import { inject, injectable } from 'inversify';
import { BlocksConstantsType } from '../blocksConstants';
import { BlocksSymbols } from '../blocksSymbols';

@injectable()
export class BlocksModule implements IBlocksModule {
  public lastBlock: SignedAndChainedBlockType;

  @inject(BlocksSymbols.constants)
  private blocksConstants: BlocksConstantsType;

  @inject(Symbols.helpers.timeToEpoch)
  private timeToEpoch: ITimeToEpoch;

  @inject(Symbols.modules.peers)
  private peersModule: IPeersModule;

  @inject(Symbols.helpers.logger)
  private logger: ILogger;

  public async isStale() {
    if (!this.lastBlock) {
      return true;
    }

    const lastBlockTime = this.timeToEpoch.fromTimeStamp(
      this.lastBlock.timestamp
    );
    const lastBlockAge = Math.floor((Date.now() - lastBlockTime) / 1000);
    if (lastBlockAge > this.blocksConstants.staleAgeThreshold) {
      return true;
    }

    // Make sure we're not behind the rest of the network
    const peers = await this.peersModule.getPeers({});
    const network = this.peersModule.findGoodPeers(peers);
    if (this.lastBlock.height < network.height) {
      return true;
    }

    return false;
  }

  public cleanup() {
    return Promise.resolve();
  }
}
