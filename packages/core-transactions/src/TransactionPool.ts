import {
  ILogger,
  ITransactionLogic,
  ITransactionPool,
  Symbols,
} from '@risevision/core-types';
import { inject, injectable, postConstruct } from 'inversify';
import { TXAppConfig } from './helpers/appconfig';
import { InnerTXQueue } from './poolTXsQueue';
import { TXSymbols } from './txSymbols';

type QueueType = 'queued' | 'pending' | 'ready' | 'unconfirmed';

// tslint:disable-next-line
@injectable()
export class TransactionPool implements ITransactionPool {
  protected queues: { [k in QueueType]: InnerTXQueue };

  get queued() {
    return this.queues.queued;
  }

  get pending() {
    return this.queues.pending as InnerTXQueue<{
      ready: boolean;
      receivedAt: Date;
    }>;
  }

  get ready() {
    return this.queues.ready;
  }

  get unconfirmed() {
    return this.queues.unconfirmed;
  }

  // generic
  @inject(Symbols.generic.appConfig)
  private config: TXAppConfig;

  // Helpers
  @inject(Symbols.helpers.logger)
  private logger: ILogger;

  // Logic
  @inject(Symbols.logic.transaction)
  private transactionLogic: ITransactionLogic;

  @inject(TXSymbols.poolQueue)
  private PoolQueue: typeof InnerTXQueue;

  @postConstruct()
  public afterConstruction() {
    this.queues = {
      pending: new this.PoolQueue('pending'),
      queued: new this.PoolQueue('queued'),
      ready: new this.PoolQueue('ready'),
      unconfirmed: new this.PoolQueue('unconfirmed'),
    };
  }

  public moveTx(txId: string, from: QueueType, to: QueueType): void {
    const fromQ = this[from];
    const toQ: InnerTXQueue = this[to];
    const { tx, payload } = fromQ.get(txId);
    fromQ.remove(txId);
    toQ.add(tx, payload);
  }

  public transactionInPool(txID: string): boolean {
    return this.whatQueue(txID) !== null;
  }

  public whatQueue(txID: string): InnerTXQueue | null {
    for (const q of this.allQueues) {
      if (q.has(txID)) {
        return q;
      }
    }
    return null;
  }

  public removeFromPool(transactionId: string) {
    this.allQueues.forEach((q) => q.remove(transactionId));
  }

  public get allQueues(): InnerTXQueue[] {
    return [this.ready, this.queued, this.pending, this.unconfirmed];
  }
}
