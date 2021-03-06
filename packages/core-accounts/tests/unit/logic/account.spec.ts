// tslint:disable object-literal-sort-keys no-big-function
import { createContainer } from '@risevision/core-launchpad/tests/unit/utils/createContainer';
import { ModelSymbols } from '@risevision/core-models';
import { Address, DBUpdateOp, IAccountsModel } from '@risevision/core-types';
import * as chai from 'chai';
import { expect } from 'chai';
import * as chaiAsPromised from 'chai-as-promised';
import { Container } from 'inversify';
import 'reflect-metadata';
import { Op } from 'sequelize';
import { SinonSandbox, SinonStub } from 'sinon';
import * as sinon from 'sinon';
import { AccountsSymbols } from '../../../src';
import { AccountLogic } from '../../../src/';

chai.use(chaiAsPromised);

const table = 'mem_accounts';

// tslint:disable no-unused-expression max-line-length no-identical-functions

describe('logic/account', () => {
  let sandbox: SinonSandbox;
  let instance: AccountLogic;
  let container: Container;
  let accModel: typeof IAccountsModel;
  before(async () => {
    container = await createContainer([
      'core-accounts',
      'core',
      'core-helpers',
      'core-crypto',
      'core-transactions',
    ]);
  });
  beforeEach(async () => {
    sandbox = sinon.createSandbox();

    instance = container.get(AccountsSymbols.logic);
    accModel = container.getNamed(ModelSymbols.model, AccountsSymbols.model);
  });

  afterEach(() => {
    sandbox.restore();
  });

  // describe('recreateTables', () => {
  //   let dropStub: SinonStub;
  //   let sequelizeStub: SinonStub;
  //   beforeEach(() => {
  //     dropStub = sandbox.stub(accModel, 'drop').resolves();
  //     sequelizeStub = sandbox.stub(accModel.sequelize, 'query').resolves();
  //
  //   });
  //   it('should drop and issue SQL query', async () => {
  //     await instance.recreateTables();
  //     expect(dropStub.called).is.true;
  //     expect(sequelizeStub.called).is.true;
  //     expect(sequelizeStub.calledWith(fs.readFileSync(path.join(__dirname, '..', '..', 'sql', 'memoryTables.sql'), { encoding: 'utf8' })))
  //   });
  //
  //   it('should be called using hookSystem', async () => {
  //     const stub = sinon.stub(instance, 'recreateTables').resolves();
  //     const hookSystem: WordPressHookSystem = container.get(Symbols.generic.hookSystem);
  //     await hookSystem.do_action('core/loader/load/recreateAccountsDatastores');
  //     expect(stub.called).true;
  //   });
  // });

  //
  describe('account.get', () => {
    const filter = {};
    let getAllStub: SinonStub;
    beforeEach(() => {
      getAllStub = sandbox.stub(instance, 'getAll');
    });

    it('without fields; getAll error', async () => {
      const error = 'error';

      getAllStub.rejects(new Error(error));

      await expect(instance.get(filter)).to.be.rejectedWith('error');
      expect(getAllStub.calledOnce).is.true;
      expect(getAllStub.firstCall.args[0]).to.be.deep.eq(filter);
    });

    it('with fields; should propagate it', async () => {
      const error = 'error';
      getAllStub.rejects(new Error(error));
      await expect(instance.get(filter)).to.be.rejectedWith('error');
      expect(getAllStub.calledOnce).is.true;
      expect(getAllStub.firstCall.args[0]).to.be.deep.eq(filter);
    });

    it('should return first returned element from getAll', async () => {
      getAllStub.resolves(['1', '2']);
      const res = await instance.get(filter);
      expect(res).to.be.deep.eq('1');
    });
    it('should return undefined if no matching elements', async () => {
      getAllStub.resolves([]);
      const res = await instance.get(filter);
      expect(res).to.be.undefined;
    });
  });

  describe('account.getAll', () => {
    let filter: any;
    let fields: any[];
    let sql: string;
    let shortSql: string;
    let rows: any[];

    let findAllStub: SinonStub;
    beforeEach(() => {
      const scope = {
        findAll() {
          return void 0;
        },
      };
      findAllStub = sandbox.stub(accModel, 'findAll').resolves([]);
    });

    beforeEach(() => {
      filter = {
        address: '2841811297332056155r',
        limit: 4,
        offset: 2,
        sort: 'username',
      };
      fields = [];
      sql =
        'select "username", "isDelegate", "u_isDelegate", "secondSignature", "u_secondSignature", ' +
        '"u_username", UPPER("address") as "address", ENCODE("publicKey", \'hex\') as "publicKey", ' +
        'ENCODE("secondPublicKey", \'hex\') as "secondPublicKey", ("balance")::bigint as "balance", ' +
        '("u_balance")::bigint as "u_balance", ("vote")::bigint as "vote", ("rate")::bigint as "rate", ' +
        '(SELECT ARRAY_AGG("dependentId") FROM mem_accounts2delegates WHERE "accountId" = a."address") ' +
        'as "delegates", (SELECT ARRAY_AGG("dependentId") FROM mem_accounts2u_delegates WHERE "accountId" = ' +
        'a."address") as "u_delegates", (SELECT ARRAY_AGG("dependentId") FROM mem_accounts2multisignatures ' +
        'WHERE "accountId" = a."address") as "multisignatures", (SELECT ARRAY_AGG("dependentId") FROM ' +
        'mem_accounts2u_multisignatures WHERE "accountId" = a."address") as "u_multisignatures", "multimin",' +
        ' "u_multimin", "multilifetime", "u_multilifetime", "blockId", "nameexist", "u_nameexist", ' +
        '"producedblocks", "missedblocks", ("fees")::bigint as "fees", ("rewards")::bigint as "rewards", ' +
        '"virgin" from "mem_accounts" as "a" where upper("address") = upper(${p1}) order by "username" limit' +
        ' 4 offset 2;';
      shortSql =
        'select * from "mem_accounts" as "a" where upper("address") = upper(${p1}) order by "username" ' +
        'limit 4 offset 2;';
      rows = [];
    });

    describe('queries', () => {
      it('should filter out undefined filter fields', async () => {
        await instance.getAll({ address: '1', balance: undefined });

        expect(findAllStub.firstCall.args[0].where).to.be.deep.eq({
          address: '1',
        });
      });

      it('should honor limit param or use undefined', async () => {
        await instance.getAll({ address: '1', limit: 10 });

        expect(findAllStub.firstCall.args[0].limit).to.be.deep.eq(10);

        await instance.getAll({ address: '1' });
        expect(findAllStub.secondCall.args[0].limit).to.be.undefined;
      });
      it('should honor offset param or use undefined', async () => {
        await instance.getAll({ address: '1', offset: 10 });

        expect(findAllStub.firstCall.args[0].offset).to.be.deep.eq(10);

        await instance.getAll({ address: '1' });
        expect(findAllStub.secondCall.args[0].offset).to.be.undefined;
      });

      it('should allow array sort param', async () => {
        await instance.getAll({
          address: '1',
          sort: { username: 1, address: -1 },
        });
        expect(findAllStub.firstCall.args[0].order).to.be.deep.eq([
          ['username', 'ASC'],
          ['address', 'DESC'],
        ]);
      });
    });
  });

  describe('account.mergeBalanceDiff', () => {
    it('should return empty array if no ops to be performed', () => {
      const ops: any = instance.mergeBalanceDiff('1R' as Address, {});
      expect(ops.length).to.be.eq(1);
      const updateOp = ops[0] as DBUpdateOp<any>;
      expect(updateOp.type).to.be.deep.eq('update');
      expect(updateOp.values).to.be.deep.eq({});
    });
    it('should allow only balance fields and discard the others', () => {
      const ops = instance.mergeBalanceDiff(
        '1R' as Address,
        {
          balance: 11n,
          u_balance: 12n,
          rate: 13n,
          virgin: 14n,
          rewards: 15n,
          fees: 16n,
          producedblocks: 17n,
          publicKey: Buffer.alloc(32).fill('a'),
          secondSignature: 19n,
          u_secondSignature: 20n,
          isDelegate: 21n,
          u_isDelegate: 22n,
          missedblocks: 18n,
          blockId: '1',
          round: 10n,
          vote: 10n,
          username: 'meow',
          u_username: 'meow',
          address: '2R',
          secondPublicKey: Buffer.from('aa', 'hex'),
        } as any
      );

      const updateOp = ops[0] as DBUpdateOp<any>;
      expect(updateOp.type).to.be.deep.eq('update');
      expect(updateOp.values).to.be.deep.eq({
        balance: { val: 'balance + 11' },
        u_balance: { val: 'u_balance + 12' },
      });
    });
    it('should handle balance', () => {
      const ops: any = instance.mergeBalanceDiff('1R' as Address, {
        balance: 10n,
      });
      expect((ops[0] as DBUpdateOp<any>).values).to.be.deep.eq({
        balance: { val: 'balance + 10' },
      });
    });

    it('should remove account virginity on u_balance', () => {
      const ops: any = instance.mergeBalanceDiff('1R' as Address, {
        u_balance: -1n,
      });
      expect(ops[0].values).to.be.deep.eq({
        u_balance: { val: 'u_balance - 1' },
        virgin: 0,
      });
    });
  });

  describe('generateAddressFromPubData', () => {
    it('should return the address', () => {
      // tslint:disable max-line-length
      const address = instance.generateAddressFromPubData(
        Buffer.from(
          '29cca24dae30655882603ba49edba31d956c2e79a062c9bc33bcae26138b39da',
          'hex'
        )
      );
      expect(address).to.equal('2841811297332056155R');
    });
  });
});
