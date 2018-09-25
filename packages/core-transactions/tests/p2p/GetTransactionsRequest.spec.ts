import { expect } from 'chai';
import { GetTransactionsRequest, TransactionPool, TXSymbols } from '../../src/';
import { createFakePeer } from '@risevision/core-p2p/tests/utils/fakePeersFactory';
import { createContainer } from '@risevision/core-launchpad/tests/utils/createContainer';
import { Container } from 'inversify';
import { p2pSymbols } from '@risevision/core-p2p';
import { createRandomTransaction, toBufferedTransaction } from '../utils/txCrafter';
import { Symbols } from '../../../core-interfaces/src';
import { ConstantsType } from '../../../core-types/src';
import { generateAccount } from '../../../core-accounts/tests/utils/accountsUtils';

// tslint:disable no-unused-expression
describe('apis/requests/GetTransactionsRequest', () => {
  let instance: GetTransactionsRequest;
  let peer: any;
  let container: Container;

  let txPool: TransactionPool;
  beforeEach(async () => {
    container = await createContainer(['core-transactions', 'core-helpers', 'core-blocks', 'core', 'core-accounts']);
    instance = container.getNamed(p2pSymbols.transportMethod, TXSymbols.p2p.getTransactions);
    txPool   = container.get(TXSymbols.pool);
    peer     = createFakePeer();
  });

  async function createRequest() {
    const { data }  = await instance.createRequestOptions();
    const resp      = await instance.handleRequest(data, null);
    return instance.handleResponse(null, resp);
  }
  it('emptytest', async () => {
    const finalData = await createRequest();
    expect(finalData).deep.eq({ transactions: [] });
  });
  it('with 1 tx', async () => {
    const tx = toBufferedTransaction(createRandomTransaction());
    txPool.unconfirmed.add(tx, { receivedAt: new Date() });
    const finalData = await createRequest();
    delete tx.signSignature;
    delete tx.signatures;
    expect(finalData).deep.eq({ transactions: [{...tx, relays: 1, asset: null}] });
  });
  it('with some txs from dif pool - order is respsected', async () => {
    const unconfirmed = toBufferedTransaction(createRandomTransaction());
    const pending = toBufferedTransaction(createRandomTransaction());
    const ready = toBufferedTransaction(createRandomTransaction());

    txPool.unconfirmed.add(unconfirmed, {receivedAt: new Date()});
    txPool.pending.add(pending, {receivedAt: new Date(), ready: false});
    txPool.ready.add(ready, {receivedAt: new Date()});

    delete unconfirmed.signSignature;
    delete pending.signSignature;
    delete ready.signSignature;
    delete unconfirmed.signatures;
    delete pending.signatures;
    delete ready.signatures;

    const finalData = await createRequest();
    expect(finalData).deep.eq({ transactions: [unconfirmed, pending, ready].map((t) => ({
        ...t, asset: null, relays: 1
      })) });
  });
  it('with some signatures', async () => {
    const t                = createRandomTransaction();
    const unconfirmed      = toBufferedTransaction(t);
    unconfirmed.signatures = new Array(3).fill(null)
      .map(() => generateAccount().getSignatureOfTransaction(t))
      .map((s) => Buffer.from(s, 'hex'));
    txPool.unconfirmed.add(unconfirmed, {receivedAt: new Date()});
    const finalData = await createRequest();
    expect(finalData.transactions).not.empty;
    expect(finalData.transactions[0].signatures).not.empty;
    expect(finalData.transactions[0].signatures.length).eq(3);
    expect(finalData.transactions[0].signatures).deep.eq(unconfirmed.signatures);
  });
  it('should honor limit', async () => {
    const constants = container.get<ConstantsType>(Symbols.generic.constants);
    constants.maxSharedTxs = 10;
    new Array(10)
      .fill(null)
      .map(() => toBufferedTransaction(createRandomTransaction()))
      .forEach((t) => txPool.unconfirmed.add(t, {receivedAt: new Date()}));
    txPool.pending.add(toBufferedTransaction(createRandomTransaction()), {receivedAt: new Date(), ready: false});
    txPool.ready.add(toBufferedTransaction(createRandomTransaction()), {receivedAt: new Date()});
    const finalData = await createRequest();
    expect(finalData.transactions.length).eq(10);
  });
});
