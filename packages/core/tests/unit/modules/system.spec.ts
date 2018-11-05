import {
  IBlocksModel,
  IBlocksModule,
  Symbols,
} from '@risevision/core-interfaces';
import { createContainer } from '@risevision/core-launchpad/tests/unit/utils/createContainer';
import { ModelSymbols } from '@risevision/core-models';
import { ConstantsType } from '@risevision/core-types';
import { expect } from 'chai';
import 'chai-as-promised';
import { Container } from 'inversify';
import 'reflect-metadata';
import * as sinon from 'sinon';
import { SinonSandbox, SinonStub } from 'sinon';
import { SystemModule } from '../../../src/modules';

// tslint:disable no-unused-expression no-identical-functions object-literal-sort-keys no-big-function
describe('modules/system', () => {
  let inst: SystemModule;
  let container: Container;
  const appConfig = {
    port: 1234,
    version: '1.0.0',
    forging: {
      pollingInterval: 1000,
    },
  };
  let constants: ConstantsType;
  let sandbox: SinonSandbox;
  let blocksModule: IBlocksModule;
  before(async () => {
    container = await createContainer([
      'core',
      'core-helpers',
      'core-crypto',
      'core-accounts',
    ]);
    constants = {
      fees: [
        { height: 1, fees: { send: 1 } },
        { height: 2, fees: { send: 2 } },
        { height: 3, fees: { send: 3 } },
        { height: 40, fees: { send: 4 } },
      ],
      minVersion: [
        { height: 1, ver: '^0.1.0' },
        { height: 2, ver: '^0.1.2' },
        { height: 3, ver: '^0.1.3' },
        { height: 11, ver: '0.1.4b' },
      ],
    } as any;
    container.rebind(Symbols.generic.constants).toConstantValue(constants);
    container.rebind(Symbols.generic.appConfig).toConstantValue(appConfig);
    container.rebind(Symbols.generic.nonce).toConstantValue('nonce');
    container.rebind(Symbols.modules.system).to(SystemModule);
  });

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    inst = container.get(Symbols.modules.system);
    blocksModule = container.get(Symbols.modules.blocks);
    blocksModule.lastBlock = {
      height: 10,
    } as any;
  });
  afterEach(() => {
    sandbox.restore();
  });

  describe('.getMinVersion', () => {
    it('should return string', () => {
      expect(inst.getMinVersion()).to.be.a('string');
    });
    it('should return ^0.1.0 for height 1', () => {
      expect(inst.getMinVersion(1)).to.be.eq('^0.1.0');
    });
    it('should return ^0.1.2 for height 2', () => {
      expect(inst.getMinVersion(2)).to.be.eq('^0.1.2');
    });
    it('should return ^0.1.3 for height 3', () => {
      expect(inst.getMinVersion(3)).to.be.eq('^0.1.3');
    });
    it('should return ^0.1.3 for default height taken from blocksModule', () => {
      const origStub = sinon.stub().returns(10);
      const stub = sinon
        .stub(blocksModule.lastBlock, 'height')
        .get(() => origStub());
      expect(inst.getMinVersion()).to.be.eq('^0.1.3');

      expect(origStub.called).to.be.true;
      stub.restore();
    });
    it('should remove letters from the end', () => {
      inst.getMinVersion(11);
      expect(inst.minVersion).to.be.eq('0.1.4');
      // tslint:disable no-string-literal
      expect(inst['minVersionChar']).to.be.eq('b');
    });
  });

  describe('.getFees', () => {
    it('should return an object', () => {
      expect(inst.getFees()).to.be.an('object');
    });
    it('should return fees property', () => {
      expect(inst.getFees()).to.haveOwnProperty('fees');
    });
    it('should return fromHeight property', () => {
      expect(inst.getFees()).to.haveOwnProperty('fromHeight');
    });
    it('should return height property', () => {
      expect(inst.getFees()).to.haveOwnProperty('height');
    });
    it('should return toHeight property', () => {
      expect(inst.getFees()).to.haveOwnProperty('toHeight');
    });

    it('should return correct data for height 1', () => {
      const r = inst.getFees(1);
      expect(r.fromHeight).to.be.eq(1);
      expect(r.toHeight).to.be.eq(1);
      expect(r.height).to.be.eq(1);
      expect(r.fees).to.be.deep.eq(constants.fees[0].fees);
    });
    it('should return correct data for height 2', () => {
      const r = inst.getFees(2);
      expect(r.fromHeight).to.be.eq(2);
      expect(r.toHeight).to.be.eq(2);
      expect(r.height).to.be.eq(2);
      expect(r.fees).to.be.deep.eq(constants.fees[1].fees);
    });

    it('should return correct data for height 30', () => {
      const r = inst.getFees(30);
      expect(r.fromHeight).to.be.eq(3);
      expect(r.toHeight).to.be.eq(39);
      expect(r.height).to.be.eq(30);
      expect(r.fees).to.be.deep.eq(constants.fees[2].fees);
    });

    it('should use height from blockmodule if not provided', () => {
      const origStub = sinon.stub().returns(10);
      const stub = sinon
        .stub(blocksModule.lastBlock, 'height')
        .get(() => origStub());

      inst.getFees();

      expect(origStub.called).to.be.true;
      stub.restore();
    });
  });

  describe('.getBroadHash', () => {
    let blocksModel: typeof IBlocksModel;
    let findAllStub: SinonStub;
    beforeEach(() => {
      blocksModel = container.getNamed(
        ModelSymbols.model,
        Symbols.models.blocks
      );
      findAllStub = sandbox.stub(blocksModel, 'findAll').resolves([]);
    });
    it('should return broadhash from genesisBlock if db.query returns empty array', async () => {
      expect(await inst.getBroadhash()).to.be.eq(
        'e4c527bd888c257377c18615d021e9cedd2bc2fd6de04b369f22a8780264c2f6'
      );
    });
    it('should compute broadhash from returned db data', async () => {
      findAllStub.resolves([1, 2, 3, 4].map((id) => ({ id })));
      expect(await inst.getBroadhash()).to.be.eq(
        '03ac674216f3e15c761ee1a5e255f067953623c8b388b4459e13f978d7c846f4'
      );
    });
  });

  describe('.networkCompatible', () => {
    it('should return true if given is same as headers nethash', () => {
      expect(
        inst.networkCompatible(
          'e4c527bd888c257377c18615d021e9cedd2bc2fd6de04b369f22a8780264c2f6'
        )
      ).is.true;
    });
    it('should return false if given is same as headers nethash', () => {
      expect(inst.networkCompatible('balallaa')).is.false;
    });
  });

  describe('.versionCompatible', () => {
    beforeEach(() => {
      blocksModule.lastBlock = {
        height: 2,
      } as any; // ^0.1.2
    });
    it('should return true if 0.1.2', () => {
      expect(inst.versionCompatible('0.1.2')).is.true;
    });
    it('should return false if 0.1.1', () => {
      expect(inst.versionCompatible('0.1.1')).is.false;
    });
    it('should return true if 0.1.3', () => {
      expect(inst.versionCompatible('0.1.3')).is.true;
    });
    it('should return true if 0.1.3a', () => {
      expect(inst.versionCompatible('0.1.3a')).is.true;
    });
    it('should return false if 0.2.0', () => {
      expect(inst.versionCompatible('0.2.0')).is.false;
    });
    it('should return true if 0.1.4b', () => {
      blocksModule.lastBlock = {
        height: 11,
      } as any;
      expect(inst.versionCompatible('0.1.4b')).is.true;
    });
  });

  describe('.update', () => {
    it('should update height and broadhash value', async () => {
      sandbox.stub(inst, 'getBroadhash').resolves('meow');
      inst.headers.height = 0;
      inst.headers.broadhash = 'haha';
      blocksModule.lastBlock = {
        height: 2,
      } as any; // ^0.1.2
      await inst.update();
      expect(inst.headers.broadhash).to.be.eq('meow');
      expect(inst.headers.height).to.be.eq(2);
    });
  });

  describe('.headers', () => {
    [
      'os',
      'version',
      'port',
      'height',
      'nethash',
      'broadhash',
      'nonce',
    ].forEach((what) =>
      it(`should contain ${what}`, () => {
        expect(inst.headers).to.haveOwnProperty(what);
      })
    );
  });

  // instance methods
  describe('.cleanup', () => {
    it('should return promise', async () => {
      expect(inst.cleanup()).to.be.instanceof(Promise);
    });
  });

  describe('getOS', () => {
    it('should return headers.os', () => {
      expect(inst.getOS()).to.be.deep.eq(inst.headers.os);
    });
  });

  describe('getVersion', () => {
    it('should return headers.version', () => {
      expect(inst.getVersion()).to.be.deep.eq(inst.headers.version);
    });
  });

  describe('getPort', () => {
    it('should return headers.port', () => {
      expect(inst.getPort()).to.be.deep.eq(inst.headers.port);
    });
  });

  describe('getHeight', () => {
    it('should return headers.height', () => {
      expect(inst.getHeight()).to.be.deep.eq(inst.headers.height);
    });
  });

  describe('getNethash', () => {
    it('should return headers.nethash', () => {
      expect(inst.getNethash()).to.be.deep.eq(inst.headers.nethash);
    });
  });

  describe('getNonce', () => {
    it('should return headers.nonce', () => {
      expect(inst.getNonce()).to.be.deep.eq(inst.headers.nonce);
    });
  });

  describe('get broadhash', () => {
    it('should return headers.broadhash', () => {
      expect(inst.broadhash).to.be.deep.eq(inst.headers.broadhash);
    });
  });
});
