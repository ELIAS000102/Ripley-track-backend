import { Global, Module } from '@nestjs/common';
import { CifradoService } from './cifrado.service.js';

/** Global: lo necesita quien guarde o lea tokens corporativos. */
@Global()
@Module({
  providers: [CifradoService],
  exports: [CifradoService],
})
export class CifradoModule {}
