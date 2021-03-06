import { expect } from 'chai';
import { fetchCoreModuleImplementations } from '../../src/modulesLoader';

describe('modulesLoader', () => {
  it('should return modules sorted by dependencies', () => {
    const modules = fetchCoreModuleImplementations(
      `${__dirname}/../../../rise`
    );
    expect(modules.map((m) => m.name)).deep.eq([
      '@risevision/core-models',
      '@risevision/core-helpers',
      '@risevision/core-apis',
      '@risevision/core-crypto',
      '@risevision/core-p2p',
      '@risevision/core-blocks',
      '@risevision/core',
      '@risevision/core-accounts',
      '@risevision/core-transactions',
      '@risevision/core-consensus-dpos',
      '@risevision/core-exceptions',
      '@risevision/core-secondsignature',
      '@risevision/rise',
    ]);
  });
});
