import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { RipleyHttpService } from './ripley-http.service.js';

@Module({
  imports: [HttpModule],
  providers: [RipleyHttpService],
  exports: [RipleyHttpService],
})
export class RipleyModule {}