import { checkIpInList, IoCSymbol } from '@risevision/core-utils';
import * as express from 'express';
import { inject, injectable } from 'inversify';
import { ExpressMiddlewareInterface, Middleware } from 'routing-controllers';
import { APIError } from '../errors';
import { APIConfig, APISymbols } from '../helpers/';
import { Symbols } from '@risevision/core-interfaces';

@Middleware({ type: 'before' })
@injectable()
@IoCSymbol(APISymbols.privateApiGuard)
export class PrivateApisGuard implements ExpressMiddlewareInterface {

  @inject(Symbols.generic.appConfig)
  private config: APIConfig;

  public use(request: express.Request, response: any, next: (err?: any) => any) {
    if (!checkIpInList(this.config.api.access.restrictedAPIwhiteList, request.ip)) {
      return next(new APIError('Private API access denied', 403));
    }
    next();
  }

}
