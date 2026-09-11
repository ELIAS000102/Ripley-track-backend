import { Module } from '@nestjs/common';
import { TokenController } from './token.controller.js';
import { TokenService } from './token.service.js';

@Module({
  controllers: [TokenController],
  providers: [TokenService],
})
export class TokenModule {}