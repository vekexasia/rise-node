import { ModelSymbols } from '@risevision/core-models';
import { BaseCoreModule } from '@risevision/core-types';
import { ExceptionsManager } from './exceptionManager';
import { ExceptionModel } from './ExceptionModel';
import { ExceptionSymbols } from './symbols';

export class CoreModule extends BaseCoreModule<any> {
  public configSchema = {};
  public constants = {};

  public addElementsToContainer(): void {
    this.container
      .bind(ExceptionSymbols.manager)
      .to(ExceptionsManager)
      .inSingletonScope();
    this.container
      .bind(ModelSymbols.model)
      .toConstructor(ExceptionModel)
      .whenTargetNamed(ExceptionSymbols.model);
  }
}
