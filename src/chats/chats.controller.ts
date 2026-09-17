import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
} from '@nestjs/common';
import { Usuario } from '../auth/decorators/usuario.decorator.js';
import type { UsuarioAutenticado } from '../auth/interfaces/auth.interface.js';
import { ChatsService } from './chats.service.js';
import {
  AgregarMensajeDto,
  CrearChatDto,
  RenombrarChatDto,
} from './dto/chats.dto.js';

/**
 * Conversaciones con el agente.
 *
 * Todas las rutas trabajan sobre los chats del usuario de la sesión: el id de
 * usuario nunca viaja en la URL, se toma del token. Así no hay forma de pedir
 * los chats de otro, ni por error ni a propósito.
 *
 * Ninguna lleva `@PermitidoAgente()`: esto lo consume el panel, no el agente.
 * El agente no necesita leer conversaciones —recibe la suya en el contexto de
 * n8n— y dejarle acceso solo abriría la puerta a que lea las de otros temas.
 */
@Controller('chats')
export class ChatsController {
  constructor(private readonly chats: ChatsService) {}

  /** GET /chats — los míos, el más reciente primero */
  @Get()
  async listar(@Usuario() usuario: UsuarioAutenticado) {
    return this.chats.listar(usuario.id);
  }

  /** POST /chats — abre una conversación nueva */
  @Post()
  async crear(
    @Usuario() usuario: UsuarioAutenticado,
    @Body() body: CrearChatDto,
  ) {
    return this.chats.crear(usuario.id, body.titulo);
  }

  /** GET /chats/:id/mensajes — el historial de una conversación */
  @Get(':id/mensajes')
  async mensajes(
    @Usuario() usuario: UsuarioAutenticado,
    @Param('id') id: string,
  ) {
    return this.chats.mensajes(usuario.id, id);
  }

  /**
   * POST /chats/:id/mensajes — guarda un turno.
   *
   * Lo llama el panel dos veces por intercambio: la pregunta al enviarla y la
   * respuesta al recibirla de n8n. Se hace desde el panel y no desde el flujo
   * para no acoplar el guardado a que n8n esté bien configurado.
   */
  @Post(':id/mensajes')
  async agregar(
    @Usuario() usuario: UsuarioAutenticado,
    @Param('id') id: string,
    @Body() body: AgregarMensajeDto,
  ) {
    return this.chats.agregarMensaje(usuario.id, id, body.rol, body.texto);
  }

  /** PUT /chats/:id — cambia el título */
  @Put(':id')
  async renombrar(
    @Usuario() usuario: UsuarioAutenticado,
    @Param('id') id: string,
    @Body() body: RenombrarChatDto,
  ) {
    return this.chats.renombrar(usuario.id, id, body.titulo);
  }

  /**
   * DELETE /chats/:id — borra la conversación y sus mensajes.
   *
   * No se audita: el registro de uso guarda lo que cambia en Ripley, y esto es
   * un dato del propio usuario sobre sí mismo.
   */
  @Delete(':id')
  async eliminar(
    @Usuario() usuario: UsuarioAutenticado,
    @Param('id') id: string,
  ) {
    return this.chats.eliminar(usuario.id, id);
  }
}
