import { IMultisignaturesModel } from '@risevision/core-interfaces';
import { publicKey } from '@risevision/core-types';
import { FilteredModelAttributes } from 'sequelize-typescript/lib/models/Model';
import { TransactionsModel } from './TransactionsModel';
import {
  Column,
  ForeignKey,
  IBuildOptions,
  Model,
  PrimaryKey,
  Table,
} from 'sequelize-typescript';

@Table({ tableName: 'multisignatures' })
export class MultiSignaturesModel extends Model<MultiSignaturesModel> implements IMultisignaturesModel {
  @Column
  public min: number;

  @Column
  public lifetime: number;

  @Column
  public keysgroup: string;

  @PrimaryKey
  @ForeignKey(() => TransactionsModel)
  @Column
  public transactionId: string;

  public added: publicKey[]   = [];
  public removed: publicKey[] = [];

  constructor(values?: FilteredModelAttributes<MultiSignaturesModel>, options?: IBuildOptions) {
    super(values, options);

    if (typeof(this.keysgroup) === 'string') {
      this.keysgroup.split(',')
        .forEach((key) => {
          if (key.startsWith('+')) {
            this.added.push(key.substr(1));
          } else if (key.startsWith('-')) {
            this.removed.push(key.substr(1));
          }
        });
    }
  }
}
