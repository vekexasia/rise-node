import { ModelSymbols } from '@risevision/core-models';
import { BaseTx } from '@risevision/core-transactions';
import {
  DBOp,
  IAccountsModel,
  IAccountsModule,
  IBaseTransaction,
  ISystemModule,
  SignedBlockType,
  Symbols,
} from '@risevision/core-types';
import { inject, injectable, named } from 'inversify';
import * as _ from 'lodash';
import * as z_schema from 'z-schema';
import { AccountsModelWith2ndSign } from './AccountsModelWith2ndSign';
import { SignaturesModel } from './SignaturesModel';
import { SigSymbols } from './symbols';

// tslint:disable-next-line no-var-requires
const secondSignatureSchema = require('../schema/secondSignature.json');

// tslint:disable-next-line interface-over-type-literal
export type SecondSignatureAsset<T = Buffer> = {
  signature: {
    publicKey: T;
  };
};

@injectable()
export class SecondSignatureTransaction extends BaseTx<
  SecondSignatureAsset,
  SignaturesModel
> {
  @inject(Symbols.modules.accounts)
  private accountsModule: IAccountsModule;

  @inject(Symbols.generic.zschema)
  private schema: z_schema;

  @inject(Symbols.modules.system)
  private systemModule: ISystemModule;

  // models
  @inject(ModelSymbols.model)
  @named(Symbols.models.accounts)
  private AccountsModel: typeof AccountsModelWith2ndSign;
  @inject(ModelSymbols.model)
  @named(SigSymbols.model)
  private SignaturesModel: typeof SignaturesModel;

  public calculateMinFee(
    tx: IBaseTransaction<SecondSignatureAsset>,
    sender: IAccountsModel,
    height: number
  ) {
    return this.systemModule.getFees(height).fees.secondsignature;
  }

  public assetBytes(tx: IBaseTransaction<SecondSignatureAsset>): Buffer {
    return tx.asset.signature.publicKey;
  }

  /**
   * Returns asset, given Buffer containing it
   */
  public readAssetFromBytes(bytes: Buffer): SecondSignatureAsset {
    return {
      signature: {
        publicKey: bytes,
      },
    };
  }

  public async verify(
    tx: IBaseTransaction<SecondSignatureAsset>,
    sender: IAccountsModel
  ): Promise<void> {
    if (!tx.asset || !tx.asset.signature) {
      throw new Error('Invalid transaction asset');
    }

    if (tx.recipientId) {
      throw new Error('Invalid recipient');
    }

    if (tx.amount !== 0n) {
      throw new Error('Invalid transaction amount');
    }

    if (
      !tx.asset.signature.publicKey ||
      !this.schema.validate(tx.asset.signature.publicKey, {
        format: 'publicKeyBuf',
      })
    ) {
      throw new Error('Invalid public key');
    }
  }

  public async findConflicts(
    txs: Array<IBaseTransaction<SecondSignatureAsset>>
  ): Promise<Array<IBaseTransaction<SecondSignatureAsset>>> {
    // This piece of logic does find conflicting transactions from same sender
    // this will ensure no conflicting 2nd sign txs from same sender that are casted wont get included in the block.

    const grouped = _.groupBy(txs, (a) => a.senderId);
    const conflictingTransactions: Array<
      IBaseTransaction<SecondSignatureAsset>
    > = [];
    // tslint:disable-next-line
    for (const senderId in grouped) {
      const groupedTXsBySender = grouped[senderId];
      if (groupedTXsBySender.length > 1) {
        conflictingTransactions.push(...groupedTXsBySender.slice(1));
      }
    }
    return conflictingTransactions;
  }

  public async apply(
    tx: IBaseTransaction<SecondSignatureAsset>,
    block: SignedBlockType,
    sender: AccountsModelWith2ndSign
  ): Promise<Array<DBOp<AccountsModelWith2ndSign>>> {
    const secondPublicKey = tx.asset.signature.publicKey;
    sender.applyValues({
      secondPublicKey,
      secondSignature: 1,
      u_secondSignature: 0,
    });
    return [
      {
        model: this.AccountsModel,
        options: {
          where: { address: sender.address },
        },
        type: 'update',
        values: {
          secondPublicKey,
          secondSignature: 1,
          u_secondSignature: 0,
        },
      },
    ];
  }

  public async undo(
    tx: IBaseTransaction<SecondSignatureAsset>,
    block: SignedBlockType,
    sender: AccountsModelWith2ndSign
  ): Promise<Array<DBOp<AccountsModelWith2ndSign>>> {
    sender.applyValues({
      secondPublicKey: null,
      secondSignature: 0,
      u_secondSignature: 1,
    });
    return [
      {
        model: this.AccountsModel,
        options: {
          where: { address: sender.address },
        },
        type: 'update',
        values: {
          secondPublicKey: null,
          secondSignature: 0,
          u_secondSignature: 1,
        },
      },
    ];
  }

  public async applyUnconfirmed(
    tx: IBaseTransaction<SecondSignatureAsset>,
    sender: AccountsModelWith2ndSign
  ): Promise<Array<DBOp<AccountsModelWith2ndSign>>> {
    if (sender.u_secondSignature || sender.secondSignature) {
      throw new Error('Second signature already enabled');
    }
    sender.applyValues({
      u_secondSignature: 1,
    });
    return [
      {
        model: this.AccountsModel,
        options: {
          where: { address: sender.address },
        },
        type: 'update',
        values: {
          u_secondSignature: 1,
        },
      },
    ];
  }

  public async undoUnconfirmed(
    tx: IBaseTransaction<SecondSignatureAsset>,
    sender: AccountsModelWith2ndSign
  ): Promise<Array<DBOp<AccountsModelWith2ndSign>>> {
    sender.applyValues({
      u_secondSignature: 0,
    });
    return [
      {
        model: this.AccountsModel,
        options: {
          where: { address: sender.address },
        },
        type: 'update',
        values: {
          u_secondSignature: 0,
        },
      },
    ];
  }

  public objectNormalize(
    tx: IBaseTransaction<SecondSignatureAsset<string | Buffer>, bigint>
  ): IBaseTransaction<SecondSignatureAsset, bigint> {
    if (typeof tx.asset.signature.publicKey === 'string') {
      tx.asset.signature.publicKey = Buffer.from(
        tx.asset.signature.publicKey,
        'hex'
      );
    }

    const report = this.schema.validate(
      tx.asset.signature,
      secondSignatureSchema
    );
    if (!report) {
      throw new Error(
        `Failed to validate signature schema: ${this.schema
          .getLastErrors()
          .map((err) => err.message)
          .join(', ')}`
      );
    }

    return tx as IBaseTransaction<SecondSignatureAsset<Buffer>, bigint>;
  }

  // tslint:disable-next-line max-line-length
  public dbSave(
    tx: IBaseTransaction<SecondSignatureAsset>
  ): DBOp<SignaturesModel> {
    return {
      model: this.SignaturesModel,
      type: 'create',
      values: {
        publicKey: tx.asset.signature.publicKey,
        transactionId: tx.id,
      },
    };
  }

  public async attachAssets(
    txs: Array<IBaseTransaction<SecondSignatureAsset>>
  ) {
    const res = await this.SignaturesModel.findAll({
      where: { transactionId: txs.map((tx) => tx.id) },
    });

    const indexes = {};
    res.forEach((tx, idx) => (indexes[tx.transactionId] = idx));

    txs.forEach((tx) => {
      if (typeof indexes[tx.id] === 'undefined') {
        throw new Error(`Couldn't restore asset for Signature tx: ${tx.id}`);
      }
      const info = res[indexes[tx.id]];
      tx.asset = {
        signature: {
          publicKey: info.publicKey,
        },
      };
    });
  }

  public getMaxBytesSize(): number {
    let size = super.getMaxBytesSize();
    size += 32; // publicKey
    return size;
  }
}
