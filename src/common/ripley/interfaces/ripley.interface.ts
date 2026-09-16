/** Respuesta paginada genérica de los catálogos de Ripley */
export interface RipleyListResponse<T> {
  count: number;
  rows: T[];
}

/**
 * Una oficina del catálogo /offices.
 * El mismo endpoint sirve almacenes (isStoreOffice) y OPL (isOPLOffice).
 */
export interface OfficeRow {
  id: string;
  code: string;
  name?: string;
  storeCode?: string;
  isActive?: boolean;
  stockSourceType?: string;
  type?: Record<string, boolean>;
}

/**
 * Respuesta de /catalogs?q={identificador}&takeFirst=1
 * Ojo: algunos catálogos traen "code" y otros solo "id" y "label".
 */
export interface CatalogoResponse {
  id: string;
  identifier: string;
  description: string;
  parameters: { id: number; code?: string; label: string }[];
}
