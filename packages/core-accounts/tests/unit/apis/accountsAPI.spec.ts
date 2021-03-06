import { APISymbols } from '@risevision/core-apis';
import { createContainer } from '@risevision/core-launchpad/tests/unit/utils/createContainer';
import { ModelSymbols } from '@risevision/core-models';
import {
  AppConfig,
  ConstantsType,
  IAccountsModel,
  Symbols,
} from '@risevision/core-types';
import * as chai from 'chai';
import { expect } from 'chai';
import * as chaiAsPromised from 'chai-as-promised';
import { Container } from 'inversify';
import { WordPressHookSystem, WPHooksSubscriber } from 'mangiafuoco';
import 'reflect-metadata';
import { SinonSandbox, SinonStub } from 'sinon';
import * as sinon from 'sinon';
import * as z_schema from 'z-schema';
import {
  AccountsAPI,
  AccountsModule,
  AccountsSymbols,
  FilterAPIGetAccount,
} from '../../../src';

chai.use(chaiAsPromised);

// tslint:disable no-unused-expression max-line-length no-big-function
describe('apis/accountsAPI', () => {
  let sandbox: SinonSandbox;
  let instance: AccountsAPI;
  let container: Container;
  beforeEach(async () => {
    sandbox = sinon.createSandbox();
    container = await createContainer([
      'core-accounts',
      'core',
      'core-helpers',
      'core-crypto',
      'core-blocks',
      'core-transactions',
    ]);

    instance = container.getNamed(APISymbols.class, AccountsSymbols.api);
    z_schema.registerFormat('address', (str: string) => {
      // tslint:disable-next-line
      return /[0-9]{1,20}R$/.test(str);
    });
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe('getAccount', () => {
    it('should validate schema', async () => {
      await expect(instance.getAccount({ address: 'meow' })).rejectedWith(
        "address - Object didn't pass"
      );
      await expect(instance.getAccount({} as any)).rejectedWith(
        'Missing required property: address'
      );
    });

    it('should query accountsModule', async () => {
      const accModule = container.get<AccountsModule>(AccountsSymbols.module);
      const stub = sandbox.stub(accModule, 'getAccount').resolves(null);
      await expect(instance.getAccount({ address: '1R' })).rejectedWith(
        'Account not found'
      );

      expect(stub.calledOnce).is.true;
      expect(stub.firstCall.args[0]).deep.eq({ address: '1R' });
      stub.resetHistory();
    });

    it('should applyFilter for return response', async () => {
      const hookSystem: WordPressHookSystem = container.get(
        Symbols.generic.hookSystem
      );

      class FilterAccountResponse extends WPHooksSubscriber(Object) {
        public hookSystem = hookSystem;

        @FilterAPIGetAccount()
        public async filterAccount(acc: any) {
          return { ...acc, meow: true };
        }
      }

      const filterInstance = new FilterAccountResponse();
      await filterInstance.hookMethods();

      const accModule = container.get<AccountsModule>(AccountsSymbols.module);
      sandbox.stub(accModule, 'getAccount').resolves({
        address: '1R',
        balance: 10,
        hexPublicKey: 'hey',
        u_balance: 11,
      });

      const res = await instance.getAccount({ address: '1R' });
      expect(res).deep.eq({
        account: {
          address: '1R',
          balance: '10',
          meow: true,
          unconfirmedBalance: '11',
        },
      });

      await filterInstance.unHook();
    });
  });
  describe('getBalance', () => {
    it('should reject if input does not pass validation schema', async () => {
      await expect(instance.getBalance({ address: 'meow' })).to.rejectedWith(
        "address - Object didn't pass validation"
      );
    });
    it('should query accountsModule and return balance and unconfirmedBalance', async () => {
      const accModule = container.get<AccountsModule>(AccountsSymbols.module);
      const stub = sandbox.stub(accModule, 'getAccount').resolves({
        address: '1R',
        balance: 10,
        hexPublicKey: 'hey',
        u_balance: 11,
      });

      expect(await instance.getBalance({ address: '1R' })).deep.eq({
        balance: '10',
        unconfirmedBalance: '11',
      });
      expect(stub.calledWith({ address: '1R' })).true;
    });
    it('should throw if accountsModule throws', async () => {
      const accModule = container.get<AccountsModule>(AccountsSymbols.module);
      sandbox.stub(accModule, 'getAccount').rejects(new Error('hey'));
      await expect(instance.getBalance({ address: '1R' })).to.rejectedWith(
        'hey'
      );
    });
  });

  describe('topAccounts', () => {
    let appConfig: AppConfig;
    let getAccountsStub: SinonStub;
    let AccountsModel: typeof IAccountsModel;
    beforeEach(() => {
      appConfig = container.get(Symbols.generic.appConfig);
      appConfig.topAccounts = true; // Enable it.
      const accountsModule = container.get<AccountsModule>(
        AccountsSymbols.module
      );
      getAccountsStub = sinon.stub(accountsModule, 'getAccounts');
      AccountsModel = container.getNamed<any>(
        ModelSymbols.model,
        AccountsSymbols.model
      );
    });

    it('should reject with appConfig.topAccounts not defined', async () => {
      delete appConfig.topAccounts;
      await expect(instance.topAccounts({})).to.be.rejectedWith(
        'Top Accounts is not enabled'
      );
      expect(getAccountsStub.called).is.false;
    });
    it('should reject with appConfig.topAccounts set to false', async () => {
      appConfig.topAccounts = false;
      await expect(instance.topAccounts({})).to.be.rejectedWith(
        'Top Accounts is not enabled'
      );
      expect(getAccountsStub.called).is.false;
    });
    it('should propagate request correctly with default params when not provided', async () => {
      appConfig.topAccounts = true;
      getAccountsStub.resolves([]);

      await instance.topAccounts({});
      expect(getAccountsStub.calledOnce).is.true;
      expect(getAccountsStub.firstCall.args[0]).deep.eq({
        limit: 100,
        offset: 0,
        sort: { balance: -1 },
      });
    });
    it('should query accountsModule.getAccounts with proper params', async () => {
      getAccountsStub.resolves([]);
      const res = await instance.topAccounts({ limit: 1, offset: 10 });
      expect(getAccountsStub.calledOnce).is.true;
      expect(getAccountsStub.firstCall.args[0]).deep.eq({
        limit: 1,
        offset: 10,
        sort: { balance: -1 },
      });
      expect(res).to.be.deep.eq({ accounts: [] });
    });
    it('should remap getAccountsResult properly', async () => {
      getAccountsStub.resolves([
        new AccountsModel({
          address: '1',
          balance: 10n,
          u_balance: 11n,
        } as any),
        new AccountsModel({
          address: '2',
          balance: 12n,
          // publicKey: Buffer.alloc(32).fill(0xab),
        }),
      ]);
      const res = await instance.topAccounts({});
      expect(res).to.be.deep.eq({
        accounts: [
          { address: '1', balance: '10' },
          {
            address: '2',
            balance: '12',
            // publicKey:
            //   'abababababababababababababababababababababababababababababababab',
          },
        ],
      });
    });
  });
});
