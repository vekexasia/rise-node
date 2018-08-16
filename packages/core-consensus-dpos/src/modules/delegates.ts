import { OnCheckIntegrity } from '@risevision/core';
import { VerifyBlock, VerifyReceipt } from '@risevision/core-blocks';
import { ExceptionsManager, ExceptionSymbols } from '@risevision/core-exceptions';
import {
  IAccountsModule,
  IAppState,
  IBlockReward,
  IBlocksModule,
  ILogger,
  IModule,
  ITransactionsModule, Symbols
} from '@risevision/core-interfaces';
import { ConstantsType, publicKey, SignedBlockType } from '@risevision/core-types';
import { OrderBy, RunThroughExceptions } from '@risevision/core-utils';
import * as crypto from 'crypto';
import * as fs from 'fs';
import { decorate, inject, injectable, named } from 'inversify';
import { WPHooksSubscriber, WordPressHookSystem } from 'mangiafuoco';
import * as sequelize from 'sequelize';
import * as z_schema from 'z-schema';
import { DposConstantsType, dPoSSymbols, Slots } from '../helpers/';
import { RoundsLogic } from '../logic/rounds';
import { AccountsModelForDPOS, DelegatesModel } from '../models';
import { DposExceptionsList } from '../dposExceptionsList';
import { ModelSymbols } from '@risevision/core-models';

const countDuplicatedDelegatesSQL = fs.readFileSync(
  `${__dirname}/../../sql/countDuplicatedDelegates.sql`,
  { encoding: 'utf8' }
);

const Extendable = WPHooksSubscriber(Object);
decorate(injectable(), Extendable);

@injectable()
export class DelegatesModule extends Extendable implements IModule {
  private loaded: boolean = false;

  // Generic
  @inject(Symbols.generic.zschema)
  private schema: z_schema;
  @inject(Symbols.generic.hookSystem)
  public hookSystem: WordPressHookSystem;

  // Helpers
  @inject(dPoSSymbols.constants)
  private dposConstants: DposConstantsType;
  @inject(Symbols.generic.constants)
  private constants: ConstantsType;
  // tslint:disable-next-line member-ordering
  @inject(ExceptionSymbols.manager)
  public excManager: ExceptionsManager;
  @inject(Symbols.helpers.logger)
  private logger: ILogger;
  @inject(dPoSSymbols.helpers.slots)
  private slots: Slots;

  // Logic
  @inject(Symbols.logic.appState)
  private appState: IAppState;
  @inject(Symbols.logic.blockReward)
  private blockReward: IBlockReward;
  @inject(dPoSSymbols.logic.rounds)
  private roundsLogic: RoundsLogic;

  // Modules
  @inject(Symbols.modules.accounts)
  private accountsModule: IAccountsModule<AccountsModelForDPOS>;
  @inject(Symbols.modules.blocks)
  private blocksModule: IBlocksModule;
  @inject(Symbols.modules.transactions)
  private transactionsModule: ITransactionsModule;

  @inject(ModelSymbols.model)
  @named(dPoSSymbols.models.delegates)
  private delegatesModel: typeof DelegatesModel;
  @inject(ModelSymbols.model)
  @named(dPoSSymbols.models.delegates)
  private accountsModel: typeof AccountsModelForDPOS;

  public async checkConfirmedDelegates(account: AccountsModelForDPOS, votes: string[]) {
    return this.checkDelegates(account, votes, 'confirmed');
  }

  public async checkUnconfirmedDelegates(account: AccountsModelForDPOS, votes: string[]) {
    return this.checkDelegates(account, votes, 'unconfirmed');
  }

  /**
   * Generate a randomized list for the round of which the given height is into.
   * @param {number} height blockheight.
   * @return {Promise<publicKey[]>}
   */
  public async generateDelegateList(height: number): Promise<Buffer[]> {
    const pkeys      = await this.getKeysSortByVote();
    const seedSource = this.roundsLogic.calcRound(height).toString();
    let currentSeed  = crypto.createHash('sha256').update(seedSource, 'utf8').digest();

    // Shuffle public keys.
    for (let i = 0, delegatesCount = pkeys.length; i < delegatesCount; i++) {
      for (let x = 0; x < 4 && i < delegatesCount; i++, x++) {
        const newIndex  = currentSeed[x] % delegatesCount;
        const b         = pkeys[newIndex];
        pkeys[newIndex] = pkeys[i];
        pkeys[i]        = b;
      }
      currentSeed = crypto.createHash('sha256').update(currentSeed).digest();
    }

    return pkeys;
  }

  /**
   * Gets delegates and for each calculate rank approval and productivity.
   */
  public async getDelegates(query: { limit?: number, offset?: number, orderBy: string }): Promise<{
    delegates: Array<{
      delegate: AccountsModelForDPOS,
      info: { rank: number, approval: number, productivity: number }
    }>,
    count: number,
    offset: number,
    limit: number,
    sortField: string,
    sortMethod: 'ASC' | 'DESC'
  }> {
    if (!query) {
      throw new Error('Missing query argument');
    }

    const delegates = await this.accountsModule.getAccounts({
        isDelegate: 1,
        sort      : { vote: -1, publicKey: 1 },
      }
    );

    const limit  = Math.min(this.dposConstants.activeDelegates, query.limit || this.dposConstants.activeDelegates);
    const offset = query.offset || 0;

    const count     = delegates.length;
    const realLimit = Math.min(offset + limit, count);

    const lastBlock   = this.blocksModule.lastBlock;
    const totalSupply = this.blockReward.calcSupply(lastBlock.height);

    // tslint:disable-next-line
    const crunchedDelegates: Array<{ delegate: AccountsModelForDPOS, info: { rank: number, approval: number, productivity: number } }> = [];
    for (let i = 0; i < delegates.length; i++) {

      const rank     = i + 1;
      const approval = Math.round((delegates[i].vote / totalSupply) * 1e4) / 1e2;

      const percent = Math.abs(
        100 - (delegates[i].missedblocks / ((delegates[i].producedblocks + delegates[i].missedblocks) / 100))
      ) || 0;

      const outsider     = i + 1 > this.slots.delegates;
      const productivity = (!outsider) ? Math.round(percent * 1e2) / 1e2 : 0;

      crunchedDelegates.push({
        delegate: delegates[i],
        info    : { rank, approval, productivity },
      });
    }

    const orderBy = OrderBy(query.orderBy, { quoteField: false });

    if (orderBy.error) {
      throw new Error(orderBy.error);
    }

    return {
      count,
      delegates : crunchedDelegates,
      limit     : realLimit,
      offset,
      sortField : orderBy.sortField,
      sortMethod: orderBy.sortMethod,
    };
  }

  /**
   * Assets that the block was signed by the correct delegate.
   */
  @RunThroughExceptions(DposExceptionsList.assertValidSlot)
  public async assertValidBlockSlot(block: SignedBlockType) {
    const delegates = await this.generateDelegateList(block.height);

    const curSlot = this.slots.getSlotNumber(block.timestamp);
    const delegId = delegates[curSlot % this.slots.delegates];
    if (!(delegId && block.generatorPublicKey.equals(delegId))) {
      this.logger.error(`Expected generator ${delegId.toString('hex')} Received generator: ${block.generatorPublicKey.toString('hex')}`);
      throw new Error(`Failed to verify slot ${curSlot}`);
    }
  }

  public async onBlockchainReady() {
    this.loaded = true;
  }

  public async cleanup() {
    this.loaded = false;
    return this.unHook();
  }

  public isLoaded() {
    return this.loaded;
  }

  @OnCheckIntegrity()
  private async checkLoadingIntegrity() {
    const delegatesCount = await this.accountsModel.count({ where: { isDelegate: 1 } });
    if (delegatesCount === 0) {
      throw new Error('No delegates found');
    }
    const [duplicatedDelegates] = await this.delegatesModel.sequelize.query(
      countDuplicatedDelegatesSQL,
      { type: sequelize.QueryTypes.SELECT });
    if (duplicatedDelegates.count > 0) {
      throw new Error('Delegates table corrupted with duplicated entries');
    }
  }

  /**
   * Verifies through a filter that the given block is not in the past compared to last block
   * and not in the future compared to now.
   */
  @VerifyBlock(9)
  private async verifyBlockSlot(payload: { errors: string[], verified: boolean }, block: SignedBlockType, lastBlock: SignedBlockType) {
    if (!payload.verified) {
      return payload;
    }
    const slotNumber = this.slots.getSlotNumber(block.timestamp);
    const lastSlot   = this.slots.getSlotNumber(lastBlock.timestamp);

    if (slotNumber > this.slots.getSlotNumber(this.slots.getTime()) || slotNumber <= lastSlot) {
      // if in future or in the past => error
      payload.errors.push('Invalid block timestamp');
      payload.verified = false;
    }
    return payload;
  }

  /**
   * Verifies that the block has been forged by the correct delegate.
   */
  @VerifyBlock(100)
  @VerifyReceipt(100)
  private async verifyBlock(payload: { errors: string[], verified: boolean }, block: SignedBlockType) {
    if (!payload.verified) {
      return payload;
    }
    try {
      await this.assertValidBlockSlot(block);
      return payload;
    } catch (e) {
      payload.errors.push(e.message);
      payload.verified = false;
      return payload;
    }
  }

  /**
   * Verify block slot is not too in the past or in the future.
   */
  @VerifyReceipt()
  private async verifyBlockSlotWindow(payload: { errors: string[], verified: boolean }, block: SignedBlockType) {
    if (!payload.verified) {
      return payload;
    }
    const curSlot   = this.slots.getSlotNumber();
    const blockSlot = this.slots.getSlotNumber(block.timestamp);
    const errors    = [];
    if (curSlot - blockSlot > this.constants.blockSlotWindow) {
      errors.push('Block slot is too old');
    }
    if (curSlot < blockSlot) {
      errors.push('Block slot is in the future');
    }
    payload.errors = errors;
    payload.verified = errors.length === 0;
    return payload;
  }

  /**
   * Get delegates public keys sorted by descending vote.
   */
  private async getKeysSortByVote(): Promise<Buffer[]> {
    const rows = await this.accountsModule.getAccounts({
      isDelegate: 1,
      limit     : this.slots.delegates,
      sort      : { vote: -1, publicKey: 1 },
    });
    return rows.map((r) => r.publicKey);
  }

  /**
   * Checks vote integrity for account and controls total votes do not exceed active delegates.
   * @param {AccountsModel} account
   * @param votes
   * @param state
   * @return {Promise<void>}
   */
  private async checkDelegates(account: AccountsModelForDPOS, votes: string[], state: 'confirmed' | 'unconfirmed') {
    if (!account) {
      throw new Error('Account not found');
    }

    const delegates: publicKey[] = (state === 'confirmed' ? account.delegates : account.u_delegates) || ([] as any);
    const existingVotes          = Array.isArray(delegates) ? delegates.length : 0;

    let additions = 0;
    let removals  = 0;

    for (const vote of votes) {
      const sign = vote[0];
      if (sign === '+') {
        additions++;
      } else if (sign === '-') {
        removals++;
      } else {
        throw new Error('Invalid math operator');
      }

      const curPK = vote.substr(1);

      if (!this.schema.validate(curPK, { format: 'publicKey', type: 'string' })) {
        throw new Error('Invalid public key');
      }

      if (sign === '+' && delegates.indexOf(curPK) !== -1) {
        throw new Error('Failed to add vote, account has already voted for this delegate');
      }
      if (sign === '-' && delegates.indexOf(curPK) === -1) {
        throw new Error('Failed to remove vote, account has not voted for this delegate');
      }

      // check voted (or unvoted) is actually a delegate.
      // TODO: This can be optimized as it's only effective when "Adding" a vote.
      const del = await this.accountsModule.getAccount({ publicKey: new Buffer(curPK, 'hex'), isDelegate: 1 });
      if (!del) {
        throw new Error('Delegate not found');
      }
    }

    const total = existingVotes + additions - removals;

    if (total > this.dposConstants.maximumVotes) {
      const exceeded = total - this.dposConstants.maximumVotes;
      throw new Error(`Maximum number of ${this.dposConstants.maximumVotes} votes exceeded (${exceeded} too many)`);
    }
  }
}