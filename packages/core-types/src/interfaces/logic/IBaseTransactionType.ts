import { Model } from 'sequelize-typescript';

import {
  DBOp,
  IBaseTransaction,
  SignedBlockType,
  TransactionType,
} from '../../types';
import { IAccountsModel } from '../models';

export interface IBaseTransactionType<T, M extends Model<any>> {
  type: number;

  calculateMinFee(
    tx: IBaseTransaction<T>,
    sender: IAccountsModel,
    height: number
  ): bigint;

  verify(tx: IBaseTransaction<T>, sender: IAccountsModel): Promise<void>;

  findConflicts(
    txs: Array<IBaseTransaction<T>>
  ): Promise<Array<IBaseTransaction<T>>>;

  fullBytes(tx: IBaseTransaction<T>): Buffer;

  signableBytes(tx: IBaseTransaction<T>): Buffer;

  assetBytes(tx: IBaseTransaction<T>): Buffer;

  readAssetFromBytes(bytes: Buffer): T;
  fromBytes(buff: Buffer): IBaseTransaction<T, bigint>;
  apply(
    tx: IBaseTransaction<T>,
    block: SignedBlockType,
    sender: IAccountsModel
  ): Promise<Array<DBOp<any>>>;

  applyUnconfirmed(
    tx: IBaseTransaction<T>,
    sender: IAccountsModel
  ): Promise<Array<DBOp<any>>>;

  undo(
    tx: IBaseTransaction<T>,
    block: SignedBlockType,
    sender: IAccountsModel
  ): Promise<Array<DBOp<any>>>;

  undoUnconfirmed(
    tx: IBaseTransaction<T>,
    sender: IAccountsModel
  ): Promise<Array<DBOp<any>>>;

  objectNormalize(tx: IBaseTransaction<T>): IBaseTransaction<T>;

  // tslint:disable-next-line max-line-length
  dbSave(
    tx: IBaseTransaction<T> & { senderId: string },
    blockId?: string,
    height?: number
  ): DBOp<M>;

  afterSave(tx: IBaseTransaction<T>): Promise<void>;

  ready(tx: IBaseTransaction<T>, sender: IAccountsModel): Promise<boolean>;

  attachAssets(txs: Array<IBaseTransaction<T>>): Promise<void>;

  /**
   * Returns static value of maximum bytes size this tx will occupy when serialized.
   */
  getMaxBytesSize(): number;
}
