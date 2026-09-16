import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type {
  RequestConUsuario,
  UsuarioAutenticado,
} from '../interfaces/auth.interface.js';

/**
 * Inyecta en el controller el usuario que ya validó el guard.
 * Solo es válido en rutas protegidas: en una ruta @Publico() llega undefined.
 */
export const Usuario = createParamDecorator(
  (_dato: unknown, ctx: ExecutionContext): UsuarioAutenticado | undefined => {
    return ctx.switchToHttp().getRequest<RequestConUsuario>().usuario;
  },
);
