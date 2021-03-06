import { LaunchpadSymbols } from '@risevision/core-launchpad';
import { ModelSymbols } from '@risevision/core-models';
import {
  DBOp,
  IAccountsModel,
  IAccountsModule,
  IBlockLogic,
  IBlocksModel,
  IBlocksModule,
  IDBHelper,
  ILogger,
  ISequence,
  ITransactionLogic,
  ITransactionPool,
  ITransactionsModel,
  SignedAndChainedBlockType,
  SignedBlockType,
  Symbols,
  TransactionType,
} from '@risevision/core-types';
import {
  catchToLoggerAndRemapError,
  logOnly,
  wait,
  WrapInBalanceSequence,
} from '@risevision/core-utils';
import bs = require('binary-search');
import { inject, injectable, named } from 'inversify';
import * as deepFreeze from 'js-flock/deepFreeze';
import * as _ from 'lodash';
import { WordPressHookSystem } from 'mangiafuoco';
import { Op, Transaction } from 'sequelize';
import { BlocksSymbols } from '../blocksSymbols';
import {
  ApplyBlockDBOps,
  OnBlockApplied,
  OnDestroyBlock,
  OnPostApplyBlock,
  OnTransactionsSaved,
  RollbackBlockDBOps,
} from '../hooks';
import { BlocksModuleUtils } from './utils';

@injectable()
export class BlocksModuleChain {
  // Generic
  @inject(Symbols.generic.genesisBlock)
  private genesisBlock: SignedAndChainedBlockType;
  @inject(LaunchpadSymbols.hookSystem)
  private hookSystem: WordPressHookSystem;

  @inject(Symbols.helpers.db)
  private dbHelper: IDBHelper;
  @inject(Symbols.helpers.logger)
  private logger: ILogger;
  // tslint:disable-next-line member-ordering
  @inject(Symbols.helpers.sequence)
  @named(Symbols.names.helpers.balancesSequence)
  public balancesSequence: ISequence;

  // LOGIC
  @inject(BlocksSymbols.logic.block)
  private blockLogic: IBlockLogic;
  @inject(Symbols.logic.transaction)
  private transactionLogic: ITransactionLogic;

  // Modules
  @inject(Symbols.modules.accounts)
  private accountsModule: IAccountsModule;
  @inject(Symbols.modules.blocks)
  private blocksModule: IBlocksModule;
  @inject(BlocksSymbols.modules.utils)
  private blocksModuleUtils: BlocksModuleUtils;
  @inject(Symbols.logic.txpool)
  private txPool: ITransactionPool;

  @inject(ModelSymbols.model)
  @named(Symbols.models.accounts)
  private AccountsModel: typeof IAccountsModel;
  @inject(ModelSymbols.model)
  @named(Symbols.models.blocks)
  private BlocksModel: typeof IBlocksModel;
  @inject(ModelSymbols.model)
  @named(Symbols.models.transactions)
  private TransactionsModel: typeof ITransactionsModel;

  private isCleaning: boolean = false;

  private isProcessing: boolean = false;

  public async cleanup() {
    this.isCleaning = true;
    while (this.isProcessing) {
      this.logger.info('Waiting for block processing to finish');
      await wait(1000);
    }
  }

  /**
   * Deletes last block and returns the "new" lastBlock (previous basically)
   * @returns {Promise<SignedBlockType>}
   */
  public async deleteLastBlock(): Promise<IBlocksModel> {
    const lastBlock = this.blocksModule.lastBlock;
    this.logger.warn('Deleting last block', {
      height: lastBlock.height,
      id: lastBlock.id,
    });

    if (lastBlock.height === 1) {
      throw new Error('Cannot delete genesis block');
    }
    const newLastBlock = await this.popLastBlock(lastBlock);
    // Set new "new" last block.
    this.blocksModule.lastBlock = newLastBlock;
    return newLastBlock;
  }

  public async deleteAfterBlock(height: number): Promise<void> {
    await this.BlocksModel.destroy({ where: { height: { [Op.gt]: height } } });
  }

  /**
   * Recover chain - wrapper for deleteLastBLock
   * @returns {Promise<void>}
   */
  public async recoverChain(): Promise<void> {
    try {
      const newLastBlock = await this.deleteLastBlock();
      this.logger.error('Recovery complete, new last block', newLastBlock.id);
    } catch (err) {
      this.logger.error('Recovery failed', err);
      throw err;
    }
  }

  /**
   * Checks for genesis in db and eventually calls #saveBlock
   * @returns {Promise<any>}
   */
  public async saveGenesisBlock() {
    const genesis = await this.BlocksModel.findByPk(this.genesisBlock.id);
    if (!genesis) {
      return this.BlocksModel.sequelize.transaction((t) =>
        this.saveBlock(this.genesisBlock, t)
      );
    }
  }

  /**
   * Apply genesis block transaction to blockchain
   * @param {BlocksModel} block
   * @returns {Promise<void>}
   */
  public async applyGenesisBlock(block: SignedAndChainedBlockType) {
    // Order vote transactions to be at the end of processing.
    block.transactions.sort((a, b) => {
      if (a.type !== b.type) {
        if (a.type === TransactionType.VOTE) {
          return 1;
        } else if (b.type === TransactionType.VOTE) {
          return -1;
        }
      }
      return 0;
    });

    const tracker = this.blocksModuleUtils.getBlockProgressLogger(
      block.transactions.length,
      block.transactions.length / 100,
      'Genesis block loading'
    );

    try {
      const senders = await this.accountsModule.unfoldSenders(
        block.transactions
      );
      await this.dbHelper.performOps([
        {
          model: this.AccountsModel,
          query: this.AccountsModel.createBulkAccountsSQL(senders),
          type: 'custom',
        },
      ]);
      for (const tx of block.transactions) {
        // Apply transactions through setAccountAndGet, bypassing unconfirmed/confirmed states
        const sender = await this.accountsModule.getAccount({
          address: tx.senderId,
        });
        // Apply tx.
        const ops: Array<DBOp<any>> = [
          {
            model: this.AccountsModel,
            query: this.AccountsModel.createBulkAccountsSQL([tx.recipientId]),
            type: 'custom',
          },
          ...(await this.transactionLogic.applyUnconfirmed(
            { ...tx, blockId: block.id } as any,
            sender
          )),
          ...(await this.transactionLogic.apply(
            { ...tx, blockId: block.id } as any,
            block,
            sender
          )),
        ];
        await this.dbHelper.performOps(ops);

        tracker.applyNext();
      }
    } catch (err) {
      // Genesis is not valid?
      this.logger.error(err);
      process.exit(0);
    }
    this.blocksModule.lastBlock = deepFreeze(
      block instanceof this.BlocksModel ? block.toJSON() : block
    );
    await this.BlocksModel.sequelize.transaction(async (tx) => {
      // perform extra operations via filter.
      await this.dbHelper.performOps(
        await this.hookSystem.apply_filters(
          ApplyBlockDBOps.name,
          [],
          block,
          true
        ),
        tx
      );
      // Perform postApplyHook
      await this.hookSystem.do_action(
        OnPostApplyBlock.name,
        this.blocksModule.lastBlock,
        tx,
        false
      );
    });
    await this.hookSystem
      .do_action(OnBlockApplied.name, this.blocksModule.lastBlock, false)
      .catch(logOnly(this.logger, 'warn'));
  }

  @WrapInBalanceSequence
  // tslint:disable-next-line
  public async applyBlock(
    block: SignedAndChainedBlockType,
    broadcast: boolean,
    saveBlock: boolean,
    accountsMap: { [address: string]: IAccountsModel }
  ) {
    if (this.isCleaning) {
      return; // Avoid processing a new block if it is cleaning.
    }
    // Prevent shutdown during database writes.
    this.isProcessing = true;

    // Find all transactions that are in unconfirmedstate && that are not included in block
    // Overlapping txs needs to be undoUnconfirmed since they could eventually exclude a tx
    // bundled within a block
    const allUnconfirmedTxs = this.txPool.unconfirmed.txList({});
    const allBlockTXIds = block.transactions.map((tx) => tx.id).sort();
    const overlappingTXs = allUnconfirmedTxs.filter((tx) => {
      const exists =
        bs(allBlockTXIds, tx.id, (a, b) => a.localeCompare(b)) >= 0;
      return !exists;
    });
    // Start atomic block saving.

    const ops: Array<DBOp<any>> = [];

    const recipients = _.sortedUniq(
      block.transactions
        .map((tx) => tx.recipientId)
        .filter((recipient) => recipient)
        .sort()
    );

    // undo all overlapping txs.
    for (const overTX of overlappingTXs) {
      ops.push(
        ...(await this.transactionLogic.undoUnconfirmed(
          overTX,
          accountsMap[overTX.senderId] ||
            (await this.accountsModule.getAccount({ address: overTX.senderId }))
        ))
      );
    }

    if (recipients.length > 0) {
      ops.push({
        model: this.AccountsModel,
        query: await this.AccountsModel.createBulkAccountsSQL(recipients),
        type: 'custom',
      });
    }

    for (const tx of block.transactions) {
      if (this.txPool.unconfirmed.has(tx.id)) {
        continue;
      }
      ops.push(
        ...(await this.transactionLogic.applyUnconfirmed(
          tx,
          accountsMap[tx.senderId]
        ))
      );
    }

    // Apply
    for (const tx of block.transactions) {
      ops.push(
        ...(await this.transactionLogic.apply(
          tx as any,
          block,
          accountsMap[tx.senderId]
        ))
      );
      this.txPool.unconfirmed.remove(tx.id);
    }

    const filteredOPs = (await this.hookSystem.apply_filters(
      ApplyBlockDBOps.name,
      ops,
      block,
      saveBlock
    )).filter((op) => op != null);

    if (filteredOPs.length > 0 || saveBlock) {
      await this.BlocksModel.sequelize
        .transaction(async (dbTX) => {
          await this.dbHelper.performOps(filteredOPs, dbTX);

          if (saveBlock) {
            try {
              await this.saveBlock(block, dbTX);
            } catch (err) {
              this.logger.error('Failed to save block...');
              this.logger.error('Block', block.id);
              throw err;
            }
            this.logger.debug(
              'Block applied correctly with ' +
                block.transactions.length +
                ' transactions'
            );
          }

          // await this.bus.message('newBlock', block, broadcast);

          this.blocksModule.lastBlock = deepFreeze(
            block instanceof this.BlocksModel ? block.toJSON() : block
          );
          await this.hookSystem.do_action(
            OnPostApplyBlock.name,
            this.blocksModule.lastBlock,
            broadcast
          );
        })
        .catch((err) => {
          // Allow cleanup as processing finished even if rollback.
          this.isProcessing = false;
          throw err;
        });
    } else {
      this.blocksModule.lastBlock = deepFreeze(
        block instanceof this.BlocksModel ? block.toJSON() : block
      );
    }

    await this.hookSystem
      .do_action(OnBlockApplied.name, this.blocksModule.lastBlock, broadcast)
      .catch(logOnly(this.logger, 'warn'));
    // remove overlapping txs from unconfirmed and move it to queued to allow re-process
    // If some of the overlapping txs are now "invalid" they will be discared within the next
    // txPool.processBundled loop.
    for (const overTX of overlappingTXs) {
      this.txPool.moveTx(overTX.id, 'unconfirmed', 'queued');
    }

    block = null;

    this.isProcessing = false;
  }

  /**
   * Save block with transactions to database
   * @param {SignedBlockType} b
   * @param {Transaction} dbTX Database transaction Object
   * @returns {Promise<void>}
   */
  public async saveBlock(b: SignedBlockType, dbTX: Transaction) {
    const saveOp = this.blockLogic.dbSaveOp(b);
    const txOps = this.transactionLogic.dbSave(b.transactions, b.id, b.height);

    await this.dbHelper.performOps([saveOp, ...txOps], dbTX);

    await this.afterSave(b).catch(
      catchToLoggerAndRemapError('Blocks#saveBlock error', this.logger)
    );
  }

  /**
   * Execute afterSave callback for txs of the saved block
   * @param {SignedBlockType} block
   * @returns {Promise<void>}
   */
  private async afterSave(block: SignedBlockType) {
    // await this.bus.message('transactionsSaved', block.transactions);
    await this.hookSystem.do_action(
      OnTransactionsSaved.name,
      block.transactions,
      block
    );
    // Execute afterSave callbacks for each transaction, depends on tx type
    for (const tx of block.transactions) {
      await this.transactionLogic.afterSave(tx);
    }
  }

  /**
   * Deletes the last block (passed), undo txs and backwardTick round
   * @param {SignedBlockType} lb1
   * @returns {Promise<SignedBlockType>}
   */
  @WrapInBalanceSequence
  private async popLastBlock(
    lb1: SignedAndChainedBlockType
  ): Promise<IBlocksModel> {
    const lb = await this.BlocksModel.findByPk(lb1.id, {
      include: [this.TransactionsModel],
    });
    if (lb === null) {
      throw new Error('curBlock is null');
    }
    const previousBlock = await this.BlocksModel.findByPk(lb.previousBlock, {
      include: [this.TransactionsModel],
    });

    if (previousBlock === null) {
      throw new Error('previousBlock is null');
    }
    // Attach assets for transactions
    await this.transactionLogic.attachAssets(lb.transactions);
    await this.transactionLogic.attachAssets(previousBlock.transactions);

    const txs = lb.transactions.slice().reverse();

    await this.BlocksModel.sequelize.transaction(async (dbTX) => {
      const accountsMap = await this.accountsModule.txAccounts(txs);
      const ops: Array<DBOp<any>> = [];
      for (const tx of txs) {
        ops.push(
          ...(await this.transactionLogic.undo(
            tx,
            lb,
            accountsMap[tx.senderId]
          ))
        );
        ops.push(
          ...(await this.transactionLogic.undoUnconfirmed(
            tx,
            accountsMap[tx.senderId]
          ))
        );
      }

      await this.dbHelper.performOps(
        await this.hookSystem.apply_filters(
          RollbackBlockDBOps.name,
          ops,
          lb, // From Block
          previousBlock // To Block
        ),
        dbTX
      );
      // await this.roundsModule.backwardTick(lb, previousBlock, dbTX);
      await lb.destroy({ transaction: dbTX });

      /**
       * @codesample actionHookCall
       */
      await this.hookSystem.do_action(
        OnDestroyBlock.name,
        this.blocksModule.lastBlock,
        previousBlock,
        dbTX
      );
    });

    return previousBlock;
  }
}
