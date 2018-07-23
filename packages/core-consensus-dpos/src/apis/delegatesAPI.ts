import { APIError, DeprecatedAPIError, PrivateApisGuard } from '@risevision/core-apis';
import { Crypto, IoCSymbol, SchemaValid, Symbols, ValidateSchema } from '@risevision/core-helpers';
import {
  IAccounts2DelegatesModel,
  IAccountsModel,
  IAccountsModule,
  IBlocksModel,
  IBlocksModule,
  IBlocksModuleUtils,
  ISystemModule,
  ITransactionsModel,
} from '@risevision/core-interfaces';
import { publicKey } from '@risevision/core-types';
import BigNumber from 'bignumber.js';
import * as crypto from 'crypto';
import * as filterObject from 'filter-object';
import { inject, injectable } from 'inversify';
import * as pgp from 'pg-promise';
import { Body, Get, JsonController, Post, Put, QueryParam, QueryParams, UseBefore } from 'routing-controllers';
import * as sequelize from 'sequelize';
import * as z_schema from 'z-schema';
import { DposConstantsType, dPoSSymbols, Slots } from '../helpers/';
import { AccountsModelForDPOS } from '../models';
import { DelegatesModule, ForgeModule } from '../modules';
import { Op } from 'sequelize';

const schema = require('../../schema/delegates.json');

@JsonController('/api/delegates')
@injectable()
@IoCSymbol(dPoSSymbols.delegatesAPI)
export class DelegatesAPI {
  @inject(Symbols.generic.zschema)
  public schema: z_schema;
  @inject(dPoSSymbols.dposConstants)
  public constants: DposConstantsType;
  @inject(Symbols.modules.accounts)
  private accounts: IAccountsModule<AccountsModelForDPOS>;
  @inject(Symbols.modules.blocks)
  private blocks: IBlocksModule;
  @inject(dPoSSymbols.modules.delegates)
  private delegatesModule: DelegatesModule;
  @inject(Symbols.helpers.crypto)
  private crypto: Crypto;
  @inject(dPoSSymbols.modules.forge)
  private forgeModule: ForgeModule;
  @inject(dPoSSymbols.helpers.slots)
  private slots: Slots;
  @inject(Symbols.modules.system)
  private system: ISystemModule;

  // models
  @inject(dPoSSymbols.models.accounts2Delegates)
  private Accounts2DelegatesModel: typeof IAccounts2DelegatesModel;
  @inject(Symbols.models.accounts)
  private AccountsModel: typeof IAccountsModel;
  @inject(Symbols.models.blocks)
  private BlocksModel: typeof IBlocksModel;
  @inject(Symbols.models.transactions)
  private TransactionsModel: typeof ITransactionsModel;

  @Get('/')
  @ValidateSchema()
  public async getDelegates(@SchemaValid(schema.getDelegates, { castNumbers: true })
                            @QueryParams() data: { orderBy: string, limit: number, offset: number }) {
    const d         = await this.delegatesModule.getDelegates(data);
    const delegates = d.delegates.map((item) => {
      // tslint:disable object-literal-sort-keys
      return {
        address       : item.delegate.address,
        username      : item.delegate.username,
        publicKey     : item.delegate.hexPublicKey,
        vote          : item.delegate.vote ? `${item.delegate.vote}` : '0',
        producedblocks: item.delegate.producedblocks,
        missedblocks  : item.delegate.missedblocks,
        rate          : item.info.rank,
        rank          : item.info.rank,
        approval      : item.info.approval,
        productivity  : item.info.productivity,
      };
      // tslint:enable object-literal-sort-keys
    });
    if (d.sortField) {
      if (['approval', 'productivity', 'rank', 'vote'].indexOf(d.sortField) > -1) {
        delegates.sort((a, b) => {
          if (d.sortMethod === 'ASC') {
            return a[d.sortField] - b[d.sortField];
          } else {
            return b[d.sortField] - a[d.sortField];
          }
        });
      } else if (['username', 'address', 'publicKey'].indexOf(d.sortField) > -1) {
        delegates.sort((a, b) => {
          if (d.sortMethod === 'ASC') {
            return a[d.sortField].localeCompare(b[d.sortField]);
          } else {
            return b[d.sortField].localeCompare(a[d.sortField]);
          }
        });
      }
    }
    return { delegates: delegates.slice(d.offset, d.limit), totalCount: d.count };
  }

  @Get('/fee')
  @ValidateSchema()
  public async getFee(@SchemaValid(schema.getFee, { castNumbers: true })
                      @QueryParams() params: { height?: number }) {
    const f            = this.system.getFees(params.height);
    const { delegate } = f.fees;
    delete f.fees;
    return { ...f, ... { fee: delegate } };

  }

  @Get('/forging/getForgedByAccount')
  @ValidateSchema()
  public async getForgedByAccount(@SchemaValid(schema.getForgedByAccount, { castNumbers: true })
                                  // tslint:disable-next-line max-line-length
                                  @QueryParams() params: { generatorPublicKey: publicKey, start?: number, end?: number }) {
    if (typeof(params.start) !== 'undefined' || typeof(params.end) !== 'undefined') {
      const reward = await this.aggregateBlockReward({
        end               : params.end,
        generatorPublicKey: params.generatorPublicKey,
        start             : params.start,
      });
      const forged = new BigNumber(reward.fees).plus(reward.rewards).toString();
      return {
        count  : reward.count,
        fees   : reward.fees,
        forged,
        rewards: reward.rewards,
      };
    } else {
      const account = await this.accounts
        .getAccount({ publicKey: Buffer.from(params.generatorPublicKey, 'hex') }, ['fees', 'rewards']);

      if (!account) {
        throw new APIError('Account not found', 200);
      }

      return {
        fees   : account.fees,
        forged : new BigNumber(account.fees).plus(account.rewards).toString(),
        rewards: account.rewards,
      };
    }

  }

  @Get('/get')
  @ValidateSchema()
  public async getDelegate(@SchemaValid(schema.getDelegate)
                           @QueryParams() params: { publicKey: publicKey, username: string }) {
    // FIXME: Delegates returned are automatically limited by maxDelegates. This means that a delegate cannot be found
    // if ranked (username) below the desired value.
    const { delegates } = await this.delegatesModule.getDelegates({ orderBy: 'username:asc' });
    const delegate      = delegates
      .find((d) => d.delegate.hexPublicKey === params.publicKey || d.delegate.username === params.username);
    if (delegate) {
      return {
        delegate: filterObject(
          { ...delegate.delegate.toPOJO(), ...delegate.info, ...{ rate: delegate.info.rank } },
          ['username', 'address', 'publicKey', 'vote', 'producedblocks',
            'missedblocks', 'rank', 'approval', 'productivity', 'rate']
        ),
      };
    }
    throw new APIError('Delegate not found', 200);
  }

  @Get('/voters')
  @ValidateSchema()
  public async getVoters(@SchemaValid(schema.getVoters)
                         @QueryParams() params: { publicKey: publicKey }) {
    const rows      = await this.Accounts2DelegatesModel.findAll({
      attributes: ['accountId'],
      where     : { dependentId: params.publicKey },
    });
    const addresses = rows.map((r) => r.accountId);

    const accounts = await this.accounts.getAccounts(
      { address: { $in: addresses }, sort: 'balance' },
      ['address', 'balance', 'username', 'publicKey']);

    return {
      accounts: accounts.map((a) => filterObject(
        a.toPOJO(),
        ['address', 'balance', 'username', 'publicKey'])
      ),
    };
  }

  @Get('/search')
  @ValidateSchema()
  public async search(@SchemaValid(schema.search, { castNumbers: true })
                      @QueryParams() params: { q: string, limit?: number, orderBy?: string }) {

    const orderBy = params.orderBy ? params.orderBy.split(':') : ['username', 'ASC'];
    if (orderBy.length === 1) {
      orderBy.push('ASC');
    }
    const delQuery  = DelegatesAPI.searchDelegate(
      params.q,
      params.limit || this.constants.activeDelegates,
      orderBy[0],
      orderBy[1] as any
    );
    const delegates = await this.Accounts2DelegatesModel.sequelize.query(
      delQuery,
      { raw: true, type: sequelize.QueryTypes.SELECT }
    );
    return { delegates };
  }

  @Get('/count')
  public async count() {
    return { count: await this.Accounts2DelegatesModel.count() };
  }

  @Get('/getNextForgers')
  public async getNextForgers(@QueryParam('limit', { required: false }) limit: number = 10) {
    const curBlock = this.blocks.lastBlock;

    const activeDelegates = await this.delegatesModule.generateDelegateList(curBlock.height);

    const currentBlockSlot      = this.slots.getSlotNumber(curBlock.timestamp);
    const currentSlot           = this.slots.getSlotNumber();
    const nextForgers: string[] = [];
    for (let i = 1; i <= this.slots.delegates && i <= limit; i++) {
      // This if looks a bit stupid to me.
      if (activeDelegates[(currentSlot + i) % this.slots.delegates]) {
        nextForgers.push(activeDelegates[(currentSlot + i) % this.slots.delegates].toString('hex'));
      }
    }

    return {
      currentBlock: this.BlocksModel.toStringBlockType(curBlock, this.TransactionsModel, this.blocks),
      currentBlockSlot,
      currentSlot,
      delegates   : nextForgers,
    };
  }

  @Put('/')
  public async createDelegate() {
    throw new DeprecatedAPIError();
  }

  // internal stuff.
  @Get('/forging/status')
  @ValidateSchema()
  @UseBefore(PrivateApisGuard)
  public async getForgingStatus(@SchemaValid(schema.forgingStatus)
                                @QueryParams() params: { publicKey: publicKey }) {
    if (params.publicKey) {
      return {
        delegates: [params.publicKey],
        enabled  : this.forgeModule.isForgeEnabledOn(params.publicKey),
      };
    } else {
      const delegates = this.forgeModule.getEnabledKeys();
      return {
        delegates,
        enabled: delegates.length > 0,
      };
    }

  }

  @Post('/forging/enable')
  @ValidateSchema()
  @UseBefore(PrivateApisGuard)
  public async forgingEnable(@SchemaValid(schema.disableForging)
                             @Body() params: { secret: string, publicKey: string }) {
    const kp = this.crypto.makeKeypair(crypto
      .createHash('sha256').update(params.secret, 'utf8')
      .digest());

    const pk = kp.publicKey.toString('hex');
    if (params.publicKey && pk !== params.publicKey) {
      throw new APIError('Invalid passphrase', 200);
    }

    if (this.forgeModule.isForgeEnabledOn(pk)) {
      throw new APIError('Forging is already enabled', 200);
    }

    const account = await this.accounts.getAccount({ publicKey: kp.publicKey });
    if (!account) {
      throw new APIError('Account not found', 200);
    }
    if (!account.isDelegate) {
      throw new APIError('Delegate not found', 200);
    }

    this.forgeModule.enableForge(kp);
  }

  @Post('/forging/disable')
  @ValidateSchema()
  @UseBefore(PrivateApisGuard)
  public async forgingDisable(@SchemaValid(schema.disableForging)
                              @Body() params: { secret: string, publicKey: string }) {
    const kp = this.crypto.makeKeypair(crypto
      .createHash('sha256').update(params.secret, 'utf8')
      .digest());

    const pk = kp.publicKey.toString('hex');
    if (params.publicKey && pk !== params.publicKey) {
      throw new APIError('Invalid passphrase', 200);
    }

    if (!this.forgeModule.isForgeEnabledOn(pk)) {
      throw new APIError('Forging is already disabled', 200);
    }

    const account = await this.accounts.getAccount({ publicKey: kp.publicKey });
    if (!account) {
      throw new APIError('Account not found', 200);
    }
    if (!account.isDelegate) {
      throw new APIError('Delegate not found', 200);
    }

    this.forgeModule.disableForge(pk);
  }

  private static searchDelegate(q: string, limit: number, orderBy: string, orderHow: 'ASC' | 'DESC' = 'ASC') {
    if (['ASC', 'DESC'].indexOf(orderHow.toLocaleUpperCase()) === -1) {
      throw new Error('Invalid ordering mechanism');
    }

    return pgp.as.format(`
    WITH
      supply AS (SELECT calcSupply((SELECT height FROM blocks ORDER BY height DESC LIMIT 1))::numeric),
      delegates AS (SELECT row_number() OVER (ORDER BY vote DESC, m."publicKey" ASC)::int AS rank,
        m.username,
        m.address,
        ENCODE(m."publicKey", 'hex') AS "publicKey",
        m.vote,
        m.producedblocks,
        m.missedblocks,
        ROUND(vote / (SELECT * FROM supply) * 100, 2)::float AS approval,
        (CASE WHEN producedblocks + missedblocks = 0 THEN 0.00 ELSE
        ROUND(100 - (missedblocks::numeric / (producedblocks + missedblocks) * 100), 2)
        END)::float AS productivity,
        COALESCE(v.voters_cnt, 0) AS voters_cnt,
        t.timestamp AS register_timestamp
        FROM delegates d
        LEFT JOIN mem_accounts m ON d.username = m.username
        LEFT JOIN trs t ON d."transactionId" = t.id
        LEFT JOIN (SELECT "dependentId", COUNT(1)::int AS voters_cnt from mem_accounts2delegates GROUP BY "dependentId") v ON v."dependentId" = ENCODE(m."publicKey", 'hex')
        WHERE m."isDelegate" = 1
        ORDER BY \${orderBy:name} \${orderHow:raw})
      SELECT * FROM delegates WHERE username LIKE \${q} LIMIT \${limit}
    `, {
      q: `%${q}%`,
      limit,
      orderBy,
      orderHow,
    });

  }

  /**
   * Gets block rewards for a delegate for time period
   */
  // tslint:disable-next-line max-line-length
  public async aggregateBlockReward(filter: { generatorPublicKey: publicKey, start?: number, end?: number }): Promise<{ fees: number, rewards: number, count: number }> {
    const params: any                            = {};
    params.generatorPublicKey                    = filter.generatorPublicKey;
    params.delegates                             = this.constants.activeDelegates;
    const timestampClausole: { timestamp?: any } = { timestamp: {} };

    if (typeof(filter.start) !== 'undefined') {
      timestampClausole.timestamp[Op.gte] = filter.start - this.constants.epochTime.getTime() / 1000;
    }

    if (typeof(filter.end) !== 'undefined') {
      timestampClausole.timestamp[Op.lte] = filter.end - this.constants.epochTime.getTime() / 1000;
    }

    if (typeof(timestampClausole.timestamp[Op.gte]) === 'undefined'
      && typeof(timestampClausole.timestamp[Op.lte]) === 'undefined') {
      delete timestampClausole.timestamp;
    }

    const bufPublicKey = Buffer.from(params.generatorPublicKey, 'hex');
    const acc          = await this.AccountsModel
      .findOne({ where: { isDelegate: 1, publicKey: bufPublicKey } });
    if (acc === null) {
      throw new Error('Account not found or is not a delegate');
    }

    const res: { count: string, rewards: string } = await this.BlocksModel.findOne({
      attributes: [
        sequelize.literal('COUNT(1)'),
        sequelize.literal('SUM("reward") as rewards'),
      ],
      raw       : true,
      where     : {
        ...timestampClausole,
        generatorPublicKey: bufPublicKey,
      },
    }) as any;

    const data = {
      count  : parseInt(res.count, 10),
      fees   : (await this.RoundsFeesModel.aggregate('fees', 'sum', {
        where: {
          ...timestampClausole,
          publicKey: bufPublicKey,
        },
      })) as number,
      rewards: res.rewards === null ? 0 : parseInt(res.rewards, 10),
    };
    if (isNaN(data.fees)) {
      // see https://github.com/sequelize/sequelize/issues/6299
      data.fees = 0;
    }
    return data;
  }

}