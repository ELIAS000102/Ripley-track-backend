import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TokenModule } from './token/token.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    TokenModule,
  ],
})
export class AppModule {}