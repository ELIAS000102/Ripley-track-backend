import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Put } from '@nestjs/common';
import { Auditar } from '../auditoria/decorators/auditar.decorator.js';
import { Usuario } from '../auth/decorators/usuario.decorator.js';
import type { UsuarioAutenticado } from '../auth/interfaces/auth.interface.js';
import { CrearRutinaDto, EditarRutinaDto } from './dto/rutinas.dto.js';
import { RutinasService } from './rutinas.service.js';

/**
 * Rutinas: tareas que Silvana ejecuta sola, a su hora.
 *
 * **Silvana no las alcanza.** Ninguna ruta lleva `@PermitidoAgente()` y además
 * `/rutinas` está en la lista negra de `AgenteGuard`: una instrucción colada en
 * un dato que lea no puede crear una rutina que luego corra sola con la cuenta
 * de alguien. Las crea, las prueba y las activa una persona desde el panel.
 */
@Controller('rutinas')
export class RutinasController {
  constructor(private readonly rutinas: RutinasService) {}

  /** GET /rutinas — todas, con sus horarios, cómo están y cuándo les toca */
  @Get()
  async listar(@Usuario() usuario: UsuarioAutenticado) {
    return this.rutinas.listar(usuario);
  }

  /** GET /rutinas/{id} — entera: tareas con sus pasos, y horarios */
  @Get(':id')
  async obtener(@Param('id', ParseUUIDPipe) id: string, @Usuario() usuario: UsuarioAutenticado) {
    return this.rutinas.obtener(id, usuario);
  }

  /** GET /rutinas/{id}/ejecuciones — las últimas veces que corrió */
  @Get(':id/ejecuciones')
  async ejecuciones(@Param('id', ParseUUIDPipe) id: string) {
    return this.rutinas.ejecuciones(id);
  }

  /** POST /rutinas — se crea desactivada: se activa tras probarla */
  @Auditar('rutina.crear')
  @Post()
  async crear(@Usuario() usuario: UsuarioAutenticado, @Body() body: CrearRutinaDto) {
    return this.rutinas.crear(usuario, body);
  }

  /** PUT /rutinas/{id} — cambiar lo que hace la desactiva hasta volver a probarla */
  @Auditar('rutina.editar')
  @Put(':id')
  async editar(@Param('id', ParseUUIDPipe) id: string, @Usuario() usuario: UsuarioAutenticado, @Body() body: EditarRutinaDto) {
    return this.rutinas.editar(id, usuario, body);
  }

  /** DELETE /rutinas/{id} — con sus tareas, horarios y su historial */
  @Auditar('rutina.borrar')
  @Delete(':id')
  async borrar(@Param('id', ParseUUIDPipe) id: string, @Usuario() usuario: UsuarioAutenticado) {
    return this.rutinas.borrar(id, usuario);
  }

  /** POST /rutinas/{id}/activar — solo con una prueba correcta de la versión actual */
  @Auditar('rutina.activar')
  @Post(':id/activar')
  @HttpCode(200)
  async activar(@Param('id', ParseUUIDPipe) id: string, @Usuario() usuario: UsuarioAutenticado) {
    return this.rutinas.activar(id, usuario);
  }

  /** POST /rutinas/{id}/desactivar */
  @Auditar('rutina.desactivar')
  @Post(':id/desactivar')
  @HttpCode(200)
  async desactivar(@Param('id', ParseUUIDPipe) id: string, @Usuario() usuario: UsuarioAutenticado) {
    return this.rutinas.desactivar(id, usuario);
  }
}
