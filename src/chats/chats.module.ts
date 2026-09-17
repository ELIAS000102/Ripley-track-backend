import { Module } from '@nestjs/common';
import { ChatsController } from './chats.controller.js';
import { ChatsService } from './chats.service.js';

/**
 * Feature de conversaciones: cada usuario guarda las suyas, crea las que
 * quiera y las borra cuando quiera.
 */
@Module({
  controllers: [ChatsController],
  providers: [ChatsService],
})
export class ChatsModule {}
