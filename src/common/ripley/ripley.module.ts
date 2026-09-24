import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { CacheCatalogosService } from './cache-catalogos.service.js';
import { CatalogosRipleyService } from './catalogos.service.js';
import { RipleyHttpService } from './ripley-http.service.js';

@Module({
  imports: [HttpModule],
  providers: [RipleyHttpService, CatalogosRipleyService, CacheCatalogosService],
  exports: [RipleyHttpService, CatalogosRipleyService],
})
/**
 * Módulo compartido: expone a cualquier feature que hable con la API corporativa
 * el cliente HTTP y los catálogos que varios módulos leen igual.
 */
export class RipleyModule {}
