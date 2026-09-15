import { Module } from '@nestjs/common';
import { RipleyModule } from '../../../common/ripley/ripley.module.js';
import { OplController } from './opl.controller.js';
import { OplService } from './opl.service.js';

@Module({
  imports: [RipleyModule],
  controllers: [OplController],
  providers: [OplService],
})
export class OplModule {}