export const Symbols = {
  class: Symbol.for('rise.classSymbol'),
  generic: {
    appConfig: Symbol.for('rise.appConfig'),
    constants: Symbol.for('rise.constants'),
    crypto: Symbol.for('rise.crypto'),
    genesisBlock: Symbol.for('rise.genesisBlock'),
    hookSystem: Symbol.for('rise.hookSystem'),
    nonce: Symbol.for('rise.nonce'),
    socketIO: Symbol.for('rise.socketIO'),
    txtypes: Symbol.for('rise.txtypes'),
    versionBuild: Symbol.for('rise.versionBuild'),
    zschema: Symbol.for('rise.zschema'),
  },
  helpers: {
    db: Symbol.for('rise.dbHelper'),
    idsHandler: Symbol.for('rise.helpers.iidsHandler'),
    jobsQueue: Symbol.for('rise.jobsQueue'),
    logger: Symbol.for('rise.logger'),
    sequence: Symbol.for('rise.sequence'),
    timeToEpoch: Symbol.for('rise.timeToEpoch'),
    txBytes: Symbol.for('rise.helpers.txBytes'),
  },
  logic: {
    account: Symbol.for('rise.account'),
    appState: Symbol.for('rise.appState'),
    block: Symbol.for('rise.block'),
    blockReward: Symbol.for('rise.blockReward'),
    broadcaster: Symbol.for('rise.broadcaster'),
    peer: Symbol.for('rise.peerLogic'),
    peers: Symbol.for('rise.peerSlogic'),
    transaction: Symbol.for('rise.transaction'),
    txpool: Symbol.for('rise.txPool'),
  },
  models: {
    accounts: Symbol.for('rise.accountsModel'),
    blocks: Symbol.for('rise.blocksModel'),
    info: Symbol.for('rise.infoModel'),
    migrations: Symbol.for('rise.migrations'),
    peers: Symbol.for('rise.peers'),
    transactions: Symbol.for('rise.transactions'),
  },
  modules: {
    accounts: Symbol.for('rise.accountsModule'),
    blocks: Symbol.for('rise.blocksModule'),
    blocksSubmodules: {
      chain: Symbol.for('rise.chainSub'),
      process: Symbol.for('rise.processSub'),
      utils: Symbol.for('rise.utilsSub'),
      verify: Symbol.for('rise.verifySub'),
    },
    fork: Symbol.for('rise.forkModule'),
    peers: Symbol.for('rise.peers'),
    system: Symbol.for('rise.systemModule'),
    transactions: Symbol.for('rise.transactionsModule'),
    transport: Symbol.for('rise.transportModule'),
  },
  names: {
    helpers: {
      balancesSequence: Symbol.for('rise.balancesSequence'),
      dbSequence: Symbol.for('rise.dbSequence'),
      defaultSequence: Symbol.for('rise.defaultSequence'),
    },
  },
};
