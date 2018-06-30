import { Bus, Sequence, Symbols, WrapInBalanceSequence } from '@risevision/core-helpers';
import {
  IAccountsModule,
  IAppState,
  IJobsQueue,
  ILogger,
  ITransactionLogic,
  ITransactionPoolLogic,
  ITransactionsModule
} from '@risevision/core-interfaces';
import { AppConfig, ConstantsType, IBaseTransaction, TransactionType } from '@risevision/core-types';
import { inject, injectable, postConstruct, tagged } from 'inversify';
import { InnerTXQueue } from './poolTXsQueue';

// tslint:disable-next-line
@injectable()
export class TransactionPool implements ITransactionPoolLogic {

  public unconfirmed    = new InnerTXQueue();
  public bundled        = new InnerTXQueue();
  public queued         = new InnerTXQueue();
  public multisignature = new InnerTXQueue<{ receivedAt: Date, ready: boolean }>();

  // generic
  @inject(Symbols.generic.appConfig)
  private config: AppConfig;
  @inject(Symbols.helpers.constants)
  private constants: ConstantsType;

  // Helpers
  @inject(Symbols.helpers.bus)
  private bus: Bus;
  @inject(Symbols.helpers.jobsQueue)
  private jobsQueue: IJobsQueue;
  @inject(Symbols.helpers.logger)
  private logger: ILogger;
  // tslint:disable-next-line member-ordering
  @inject(Symbols.helpers.sequence)
  @tagged(Symbols.helpers.sequence, Symbols.tags.helpers.balancesSequence)
  public balancesSequence: Sequence;

  // Logic
  @inject(Symbols.logic.appState)
  private appState: IAppState;
  @inject(Symbols.logic.transaction)
  private transactionLogic: ITransactionLogic;

  @inject(Symbols.modules.accounts)
  private accountsModule: IAccountsModule;
  private bundledInterval: number;
  private bundleLimit: number;
  private expiryInterval    = 30000;
  private processed: number = 0;

  @postConstruct()
  public afterConstruction() {
    this.bundledInterval = this.config.broadcasts.broadcastInterval;
    this.bundleLimit     = this.config.broadcasts.releaseLimit;
    this.jobsQueue.register(
      'transactionPoolNextBundle',
      () => this.processBundled(),
      this.bundledInterval
    );
    this.jobsQueue.register(
      'transactionPoolNextExpiry',
      () => Promise.resolve(this.expireTransactions()),
      this.expiryInterval
    );
  }

  /**
   * Queue a transaction or throws an error if it couldnt
   */
  public queueTransaction(tx: IBaseTransaction<any>, bundled: boolean): void {
    const payload: { receivedAt: Date, ready?: boolean } = { receivedAt: new Date() };

    let queue: InnerTXQueue;
    if (bundled) {
      queue = this.bundled;
    } else if (tx.type === TransactionType.MULTI || Array.isArray(tx.signatures)) {
      queue         = this.multisignature;
      payload.ready = false;
    } else {
      queue = this.queued;
    }

    if (queue.count >= this.config.transactions.maxTxsPerQueue) {
      throw new Error('Transaction pool is full');
    } else {
      queue.add(tx, payload);
    }
  }

  public async fillPool(): Promise<Array<IBaseTransaction<any>>> {
    if (this.appState.get('loader.isSyncing')) {
      return Promise.resolve([]);
    }

    const unconfirmedCount = this.unconfirmed.count;
    this.logger.debug(`Transaction pool size: ${unconfirmedCount}`);

    const spare = this.constants.maxTxsPerBlock - unconfirmedCount;
    if (spare <= 0) {
      return Promise.resolve([]);
    }

    const multignatures = this.multisignature.listWithPayload(
      true,
      5,
      // tslint:disable-next-line
      (tx, payload) => payload.ready);

    const inQueue = this.queued.listWithPayload(true, Math.max(0, spare - multignatures.length));

    const txsAndPayloads = multignatures.concat(inQueue as any);
    txsAndPayloads.forEach(({ tx, payload }) => {
      // Remove the tx from either multisig or queued
      this.multisignature.remove(tx.id);
      this.queued.remove(tx.id);

      // Add to unconfirmed.
      this.unconfirmed.add(tx, payload);
    });

    return txsAndPayloads.map(({ tx }) => tx);
  }

  public transactionInPool(txID: string): boolean {
    return this.allQueues
      .map((queue) => queue.has(txID))
      .filter((isInQueue) => isInQueue)
      .length > 0;
  }

  /**
   * Gets unconfirmed, multisig and queued txs based on limit and reverse opts
   */
  public getMergedTransactionList(limit: number): Array<IBaseTransaction<any>> {
    const minLimit = (this.constants.maxTxsPerBlock + 2);

    if (limit <= minLimit || limit > this.constants.maxSharedTxs) {
      limit = minLimit;
    }

    const unconfirmed = this.unconfirmed.list(false, this.constants.maxTxsPerBlock);
    limit -= unconfirmed.length;

    const multisignatures = this.multisignature.list(false, this.constants.maxTxsPerBlock, ((t) => (t as any).ready));
    limit -= multisignatures.length;

    const queued = this.queued.list(false, limit);

    return unconfirmed.concat(multisignatures).concat(queued);
  }

  public expireTransactions(): string[] {
    const unconfirmed = this.unconfirmed.listWithPayload(true);
    const queued      = this.queued.listWithPayload(true);
    const multi       = this.multisignature.listWithPayload(true);

    const all = unconfirmed.concat(queued).concat(multi);

    const ids: string[] = [];
    for (const txP of all) {
      const { tx, payload } = txP;
      if (!tx) {
        continue;
      }
      const now     = Math.floor(Date.now() / 1000);
      const timeOut = this.txTimeout(tx);
      const seconds = now - Math.floor(payload.receivedAt.getTime() / 1000);
      if (seconds > timeOut) {
        ids.push(tx.id);
        this.removeUnconfirmedTransaction(tx.id);
        this.logger.info(`Expired transaction: ${tx.id} received at: ${payload.receivedAt.toUTCString()}`);
      }
    }
    return ids;
  }

  /**
   * Picks bundled transactions, verifies them and then enqueue them
   */
  @WrapInBalanceSequence
  public async processBundled(): Promise<void> {
    const bundledTxs = this.bundled.list(true, this.bundleLimit);
    for (const tx of bundledTxs) {
      if (!tx) {
        continue;
      }

      try {
        const sender = await this.processVerifyTransaction(
          tx,
          true
        );
        this.bundled.remove(tx.id);
        if (sender.isMultisignature()) {
          tx.signatures = tx.signatures || []; // make sure that queueTransaction knows where to enqueue the tx.
        }
        try {
          this.queueTransaction(tx, false /* After processing the tx becomes unbundled */);
        } catch (e) {
          this.logger.warn(`Failed to queue bundled transaction: ${tx.id}`, e);
        }
      } catch (e) {
        this.logger.warn(`Failed to process / verify bundled transaction: ${tx.id}`, e);
        // this.removeUnconfirmedTransaction(tx.id);
        this.bundled.remove(tx.id);
      }
    }
  }

  /**
   * process a new incoming transaction. It may reject in case  the tx is not valid.
   */
  public async processNewTransaction(tx: IBaseTransaction<any>, broadcast: boolean): Promise<void> {
    if (this.transactionInPool(tx.id)) {
      return Promise.reject(`Transaction is already processed: ${tx.id}`);
    }
    this.processed++;
    if (this.processed > 1000) {
      // Reindex queues.
      this.reindexAllQueues();
      this.processed = 1; // TODO: Maybe one day use a different counter to keep stats clean
    }

    return this.queueTransaction(tx, true);
  }

  /**
   * Calls processVerifyTransaction for each transaction and applies
   * unconfirmed transaction.
   */
  @WrapInBalanceSequence
  // tslint:disable-next-line
  public async applyUnconfirmedList(txs: Array<IBaseTransaction<any> | string>, txModule: ITransactionsModule): Promise<void> {
    for (let theTx of txs) {
      if (!theTx) {
        continue; // move on the next item.
      }
      if (typeof(theTx) === 'string') {
        theTx = this.unconfirmed.get(theTx);
      }

      try {
        const sender = await this.processVerifyTransaction(
          theTx,
          false
        );
        try {
          await txModule.applyUnconfirmed(
            theTx,
            sender);
        } catch (e) {
          this.logger.error(`Failed to apply unconfirmed transaction ${theTx.id}`, e);
          this.removeUnconfirmedTransaction(theTx.id);
        }
      } catch (e) {
        this.logger.error(`Failed to process / verify unconfirmed transaction: ${theTx.id}`, e);
        this.removeUnconfirmedTransaction(theTx.id);
      }
    }
  }

  /**
   * Calls reindex to each queue to clean memory
   */
  private reindexAllQueues() {
    this.allQueues
      .forEach((queue) => queue.reindex());
  }

  private get allQueues(): InnerTXQueue[] {
    return [this.unconfirmed, this.bundled, this.queued, this.multisignature];
  }

  private removeUnconfirmedTransaction(txID: string) {
    this.unconfirmed.remove(txID);
    this.queued.remove(txID);
    this.multisignature.remove(txID);
  }

  /**
   * Gets sender account verifies if its multisignature and eventually gets requester
   * process transaction and verifies it.
   */
  private async processVerifyTransaction(transaction: IBaseTransaction<any>, broadcast: boolean) {
    if (!transaction) {
      throw new Error('Missing transaction');
    }

    const sender            = await this.accountsModule.setAccountAndGet({ publicKey: transaction.senderPublicKey });
    const isMultisigAccount = sender && sender.isMultisignature();
    if (isMultisigAccount) {
      transaction.signatures = transaction.signatures || [];
    }
    let requester = null;
    if (sender && transaction.requesterPublicKey && isMultisigAccount) {
      // Fetch the requester
      requester = await this.accountsModule.getAccount({ publicKey: transaction.requesterPublicKey });
    }

    // Process the transaction!
    await this.transactionLogic.process(transaction, sender, requester);

    // Normalize tx.
    const normalizedTx = this.transactionLogic.objectNormalize(transaction);

    // Verify the transaction
    await this.transactionLogic.verify(normalizedTx, sender, requester, null);

    await this.bus.message('unconfirmedTransaction', normalizedTx, broadcast);
    return sender;
  }

  /**
   * Returns a tx expiration timeout in seconds
   * @returns {number}
   */
  private txTimeout(tx: IBaseTransaction<any>): number {
    if (tx.type === TransactionType.MULTI) {
      return tx.asset.multisignature.lifetime * 3600;
    } else if (Array.isArray(tx.signatures)) {
      return this.constants.unconfirmedTransactionTimeOut * 8;
    } else {
      return this.constants.unconfirmedTransactionTimeOut;
    }
  }

}