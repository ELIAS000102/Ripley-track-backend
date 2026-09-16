/**
 * Configuración cargada por @nestjs/config desde variables de entorno (ver .env.example).
 * Cada país tiene su propia URL base y token; los endpoints son rutas relativas que
 * se arman con un prefijo común (RIPLEY_PATH_PREFIX), igual para PE y CL.
 */
export default () => {
  const prefijo = process.env.RIPLEY_PATH_PREFIX ?? '';

  return {
    port: parseInt(process.env.PORT ?? '', 10) || 3000,
    ripley: {
      urls: {
        PE: process.env.RIPLEY_API_URL_PE,
        CL: process.env.RIPLEY_API_URL_CL,
      },
      tokens: {
        PE: process.env.RIPLEY_TOKEN_PE,
        CL: process.env.RIPLEY_TOKEN_CL,
      },
      endpoints: {
        // Compartidos
        offices: `${prefijo}${process.env.RIPLEY_EP_OFFICES}`,
        services: `${prefijo}${process.env.RIPLEY_EP_SERVICES}`,
        // Picking
        capacitiesPicking: `${prefijo}${process.env.RIPLEY_EP_CAPACITIES_PICKING}`,
        schedulesPicking: `${prefijo}${process.env.RIPLEY_EP_SCHEDULES_PICKING}`,
        // Despacho
        mainzones: `${prefijo}${process.env.RIPLEY_EP_MAINZONES}`,
        mainschedules: `${prefijo}${process.env.RIPLEY_EP_MAINSCHEDULES}`,
        capacitiesBase: `${prefijo}${process.env.RIPLEY_EP_CAPACITIES_BASE}`,
        capacitiesSchedule: `${prefijo}${process.env.RIPLEY_EP_CAPACITIES_SCHEDULE}`,
        // Configuración masiva de tipos de servicio
        delivery: `${prefijo}${process.env.RIPLEY_EP_DELIVERY}`,
        catalogs: `${prefijo}${process.env.RIPLEY_EP_CATALOGS}`,
        routesState: `${prefijo}${process.env.RIPLEY_EP_ROUTES_STATE}`,
        routesUpdate: `${prefijo}${process.env.RIPLEY_EP_ROUTES_UPDATE}`,
        // Tipos de servicio por OPL
        listTypeServices: `${prefijo}${process.env.RIPLEY_EP_LIST_TYPE_SERVICES}`,
        saveOplService: `${prefijo}${process.env.RIPLEY_EP_SAVE_OPL_SERVICE}`,
        // Transferencia entre sucursales
        officeRelationship: `${prefijo}${process.env.RIPLEY_EP_OFFICE_RELATIONSHIP}`,
        // Simulación
        regions: `${prefijo}${process.env.RIPLEY_EP_REGIONS}`,
        sku: `${prefijo}${process.env.RIPLEY_EP_SKU}`,
        simulator: `${prefijo}${process.env.RIPLEY_EP_SIMULATOR}`,
      },
    },
  };
};
