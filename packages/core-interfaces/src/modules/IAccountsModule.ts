import { DBOp, IBaseTransaction } from '@risevision/core-types';
import { As } from 'type-tagger';
import { AccountDiffType, AccountFilterData } from '../logic';
import { IAccountsModel } from '../models';

export interface IAccountsModule<T extends IAccountsModel = IAccountsModel> {
  unfoldSenders(
    txs: Array<IBaseTransaction<any>>
  ): Array<string & As<'address'>>;

  txAccounts(
    txs: Array<IBaseTransaction<any>>
  ): Promise<{ [address: string]: T }>;

  checkTXsAccountsMap(
    txs: Array<IBaseTransaction<any>>,
    accMap: { [address: string]: T }
  ): Promise<void>;

  getAccount(filter: AccountFilterData<T>): Promise<T>;

  getAccounts(filter: AccountFilterData<T>): Promise<T[]>;

  mergeAccountAndGetOPs(diff: AccountDiffType<T>): Array<DBOp<any>>;

  generateAddressByPubData(pd: Buffer): string & As<'address'>;
}
