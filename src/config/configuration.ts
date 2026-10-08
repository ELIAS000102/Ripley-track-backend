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
      // Los tokens ya no viven aquí: cada usuario guarda el suyo cifrado
      // (ver src/configuracion/token-ripley).
      endpoints: {
        // Compartidos
        offices: `${prefijo}${process.env.RIPLEY_EP_OFFICES}`,
        services: `${prefijo}${process.env.RIPLEY_EP_SERVICES}`,
        // Picking
        capacitiesPicking: `${prefijo}${process.env.RIPLEY_EP_CAPACITIES_PICKING}`,
        schedulesPicking: `${prefijo}${process.env.RIPLEY_EP_SCHEDULES_PICKING}`,
        // Recepción
        schedulesReception: `${prefijo}${process.env.RIPLEY_EP_SCHEDULES_RECEPTION}`,
        capacitiesReception: `${prefijo}${process.env.RIPLEY_EP_CAPACITIES_RECEPTION}`,
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
        // Agendas de transferencia: cuánto puede transferir al día un origen a
        // un clúster de destino. Sus días se leen y se escriben en el mismo
        // /capacities que recepción, así que sin variable propia usan ese
        clusters: `${prefijo}${process.env.RIPLEY_EP_CLUSTERS}`,
        schedulesTransfer: `${prefijo}${process.env.RIPLEY_EP_SCHEDULES_TRANSFER}`,
        capacitiesTransfer: `${prefijo}${process.env.RIPLEY_EP_CAPACITIES_TRANSFER ?? process.env.RIPLEY_EP_CAPACITIES_RECEPTION}`,
        // Catálogo de servicios de las agendas de transferencia, si /services
        // no tiene alguno (opcional)
        servicesDispatchDate: process.env.RIPLEY_EP_SERVICES_DISPATCH_DATE
          ? `${prefijo}${process.env.RIPLEY_EP_SERVICES_DISPATCH_DATE}`
          : '',
        // Simulación
        regions: `${prefijo}${process.env.RIPLEY_EP_REGIONS}`,
        sku: `${prefijo}${process.env.RIPLEY_EP_SKU}`,
        simulator: `${prefijo}${process.env.RIPLEY_EP_SIMULATOR}`,
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
