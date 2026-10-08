/**
 * Configuración cargada por @nestjs/config desde variables de entorno (ver .env.example).
 * Cada país tiene su propia URL base y token; los endpoints son rutas relativas que
 * se arman con un prefijo común (RIPLEY_PATH_PREFIX), igual para PE y CL.
 */
export default () => {
  const prefijo = process.env.RIPLEY_PATH_PREFIX ?? '';

  /*
   * La ruta de un endpoint, o vacía si su variable no está puesta. Antes se
   * armaba con la variable tal cual, y una que faltaba acababa en la URL como
   * "…/v1undefined": Ripley respondía 404 y el panel decía "No hay datos para
   * ese recurso", que no se parece en nada a lo que pasaba. Vacía, la lee
   * RipleyHttpService.endpoint() y responde "Falta configurar el endpoint".
   */
  const ruta = (variable: string | undefined) => (variable?.trim() ? `${prefijo}${variable.trim()}` : '');

  return {
    port: parseInt(process.env.PORT ?? '', 10) || 3000,
    ripley: {
      urls: {
        PE: process.env.RIPLEY_API_URL_PE,
        CL: process.env.RIPLEY_API_URL_CL,
      },
      // Los tokens ya no viven aquí: cada usuario guarda el suyo cifrado
      // (ver src/configuracion/token-ripley).
      endpoints: {
        // Compartidos
        offices: ruta(process.env.RIPLEY_EP_OFFICES),
        services: ruta(process.env.RIPLEY_EP_SERVICES),
        // Picking
        capacitiesPicking: ruta(process.env.RIPLEY_EP_CAPACITIES_PICKING),
        schedulesPicking: ruta(process.env.RIPLEY_EP_SCHEDULES_PICKING),
        // Recepción
        schedulesReception: ruta(process.env.RIPLEY_EP_SCHEDULES_RECEPTION),
        capacitiesReception: ruta(process.env.RIPLEY_EP_CAPACITIES_RECEPTION),
        // Despacho
        mainzones: ruta(process.env.RIPLEY_EP_MAINZONES),
        mainschedules: ruta(process.env.RIPLEY_EP_MAINSCHEDULES),
        capacitiesBase: ruta(process.env.RIPLEY_EP_CAPACITIES_BASE),
        capacitiesSchedule: ruta(process.env.RIPLEY_EP_CAPACITIES_SCHEDULE),
        // Configuración masiva de tipos de servicio
        delivery: ruta(process.env.RIPLEY_EP_DELIVERY),
        catalogs: ruta(process.env.RIPLEY_EP_CATALOGS),
        routesState: ruta(process.env.RIPLEY_EP_ROUTES_STATE),
        routesUpdate: ruta(process.env.RIPLEY_EP_ROUTES_UPDATE),
        // Tipos de servicio por OPL
        listTypeServices: ruta(process.env.RIPLEY_EP_LIST_TYPE_SERVICES),
        saveOplService: ruta(process.env.RIPLEY_EP_SAVE_OPL_SERVICE),
        // Transferencia entre sucursales
        officeRelationship: ruta(process.env.RIPLEY_EP_OFFICE_RELATIONSHIP),
        // Agendas de transferencia: cuánto puede transferir al día un origen a
        // un clúster de destino. Sus días se leen y se escriben en el mismo
        // /capacities que recepción, así que sin variable propia usan ese
        clusters: ruta(process.env.RIPLEY_EP_CLUSTERS),
        schedulesTransfer: ruta(process.env.RIPLEY_EP_SCHEDULES_TRANSFER),
        // `||` y no `??`: una variable puesta pero vacía también cae en la de recepción
        capacitiesTransfer: ruta(process.env.RIPLEY_EP_CAPACITIES_TRANSFER || process.env.RIPLEY_EP_CAPACITIES_RECEPTION),
        // Catálogo de servicios de las agendas de transferencia, si /services
        // no tiene alguno (opcional)
        servicesDispatchDate: ruta(process.env.RIPLEY_EP_SERVICES_DISPATCH_DATE),
        // Simulación
        regions: ruta(process.env.RIPLEY_EP_REGIONS),
        sku: ruta(process.env.RIPLEY_EP_SKU),
        simulator: ruta(process.env.RIPLEY_EP_SIMULATOR),
      },
    },
    cifrado: {
      /** Con esta clave se cifran los tokens corporativos antes de guardarlos */
      clave: process.env.TOKENS_CLAVE_CIFRADO,
    },
    agente: {
      /**
       * Webhook del agente en n8n. Lo consume el frontend, no el backend:
       * se sirve desde aquí para que la URL viva en el entorno y no repartida
       * por el código de cada cliente.
       */
      webhookUrl: process.env.N8N_WEBHOOK_URL ?? '',
      /**
       * API de n8n, para parar una ejecución cuando alguien pulsa "Detener"
       * en el chat. Opcional: sin ella, detener corta igualmente las
       * herramientas de esa petición. La clave no sale nunca del backend.
       */
      n8nApiUrl: process.env.N8N_API_URL ?? '',
      n8nApiKey: process.env.N8N_API_KEY ?? '',
    },
    supabase: {
      url: process.env.SUPABASE_URL,
      /** Key pública: solo se usa para las operaciones de login */
      anonKey: process.env.SUPABASE_ANON_KEY,
      /** Key privada: escribe el registro de uso saltándose las políticas RLS */
      serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
      tablaAuditoria: process.env.SUPABASE_TABLA_AUDITORIA,
    },
  };
};
