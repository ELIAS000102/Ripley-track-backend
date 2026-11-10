/**
 * La configuración del G12 de Perú tal como estaba en el Excel
 * ("REPORTE - G12 - PE V.6.12"): sus filas, los gatillos del simulador y las
 * agendas que leía de SharePoint. Generada con un script desde el libro.
 *
 * Las comunas y las agendas llevan su id solo como referencia (`ref`): al
 * cargarla, el backend los traduce a nombres —región, provincia, distrito,
 * nombre de agenda— y la configuración guardada no lleva ningún id.
 */
import type { SemillaG12 } from './inicial-g12.service.js';

export const SEMILLA_G12_PE: SemillaG12 = {
  "componentes": [
    {
      "clave": "dd_lima",
      "filas": [
        {
          "nombre": "Paquetería Lima Total",
          "suma": [
            "Centralizado MailAmericas",
            "Centralizado URBANO",
            "Centralizado FLOTA Ñ",
            "Courrier Lima Periferia"
          ]
        },
        {
          "nombre": "Centralizado MailAmericas"
        },
        {
          "nombre": "Centralizado URBANO"
        },
        {
          "nombre": "Centralizado FLOTA Ñ"
        },
        {
          "nombre": "Courrier Lima Periferia"
        },
        {
          "nombre": "Big Ticket Lima"
        },
        {
          "nombre": "SAME DAY"
        },
        {
          "nombre": "90 MIN"
        }
      ],
      "bloques": [
        {
          "tipo": "simulacion",
          "nota": "Primera fecha de despacho",
          "items": [
            {
              "fila": "Centralizado URBANO",
              "campos": {
                "servicio": "S",
                "metodo": "DP",
                "operador": "1100",
                "almacen": "20026",
                "sku": "2025364075592",
                "canal": "TVI"
              },
              "ref": {
                "comunaId": "5d2f8c2f40ae9d7f94e5b26a",
                "ubigeo": "150117"
              }
            },
            {
              "fila": "Centralizado MailAmericas",
              "campos": {
                "servicio": "S",
                "metodo": "DP",
                "operador": "1100",
                "almacen": "20026",
                "sku": "2025364075592",
                "canal": "TVI"
              },
              "ref": {
                "comunaId": "5d2f8c2f40ae9d7f94e5b267",
                "ubigeo": "150114"
              }
            },
            {
              "fila": "Centralizado FLOTA Ñ",
              "campos": {
                "servicio": "S",
                "metodo": "DP",
                "operador": "1100",
                "almacen": "20026",
                "sku": "2025364075592",
                "canal": "TVI"
              },
              "ref": {
                "comunaId": "5d2f8c2f40ae9d7f94e5b25a",
                "ubigeo": "150101"
              }
            },
            {
              "fila": "Courrier Lima Periferia",
              "campos": {
                "servicio": "S",
                "metodo": "DP",
                "operador": "1007",
                "almacen": "20026",
                "sku": "2003349815609",
                "canal": "TVI"
              },
              "ref": {
                "comunaId": "5d2f8c2f40ae9d7f94e5b26c",
                "ubigeo": "150119"
              }
            },
            {
              "fila": "Big Ticket Lima",
              "campos": {
                "servicio": "S",
                "metodo": "DP",
                "operador": "1401",
                "almacen": "20096",
                "sku": "2003349815609",
                "canal": "TVI"
              },
              "ref": {
                "comunaId": "5d2f8c2f40ae9d7f94e5b26f",
                "ubigeo": "150122"
              }
            },
            {
              "fila": "SAME DAY",
              "campos": {
                "servicio": "SD",
                "metodo": "DP",
                "operador": "1110",
                "almacen": "20026",
                "sku": "2014311147048",
                "canal": "TVI"
              },
              "ref": {
                "comunaId": "5d2f8c2f40ae9d7f94e5b25d",
                "ubigeo": "150104"
              }
            },
            {
              "fila": "90 MIN",
              "campos": {
                "servicio": "EX",
                "metodo": "DP",
                "operador": "1130",
                "almacen": "20030",
                "sku": "2014301323889",
                "canal": "TVI"
              },
              "ref": {
                "comunaId": "5d2f8c2f40ae9d7f94e5b26f",
                "ubigeo": "150122"
              }
            }
          ]
        },
        {
          "tipo": "capacidad",
          "nota": "Cupo de cada flujo (era la hoja CAPACIDADES y los números fijos)",
          "items": [
            {
              "fila": "Centralizado MailAmericas",
              "campos": {
                "lun": 800,
                "mar": 800,
                "mie": 800,
                "jue": 800,
                "vie": 800,
                "sab": 800,
                "dom": 800
              }
            },
            {
              "fila": "Centralizado URBANO",
              "campos": {
                "lun": 500,
                "mar": 500,
                "mie": 500,
                "jue": 500,
                "vie": 500,
                "sab": 500,
                "dom": 500
              }
            },
            {
              "fila": "Centralizado FLOTA Ñ",
              "campos": {
                "lun": 150,
                "mar": 150,
                "mie": 150,
                "jue": 150,
                "vie": 150,
                "sab": 150,
                "dom": 150
              }
            },
            {
              "fila": "Courrier Lima Periferia",
              "campos": {
                "lun": 100,
                "mar": 100,
                "mie": 100,
                "jue": 100,
                "vie": 100,
                "sab": 100,
                "dom": 100
              }
            },
            {
              "fila": "Big Ticket Lima",
              "campos": {
                "lun": 400,
                "mar": 400,
                "mie": 280,
                "jue": 280,
                "vie": 280,
                "sab": 280,
                "dom": 0
              }
            },
            {
              "fila": "SAME DAY",
              "campos": {
                "lun": 300,
                "mar": 300,
                "mie": 300,
                "jue": 300,
                "vie": 300,
                "sab": 300,
                "dom": 0
              }
            },
            {
              "fila": "90 MIN",
              "campos": {
                "lun": 90,
                "mar": 90,
                "mie": 90,
                "jue": 90,
                "vie": 90,
                "sab": 90,
                "dom": 0
              }
            }
          ]
        }
      ]
    },
    {
      "clave": "sfs",
      "filas": [
        {
          "nombre": "SFS Arequipa  - EXACTA"
        },
        {
          "nombre": "SFS Ica  - EXACTA"
        },
        {
          "nombre": "SFS Piura II  - EXACTA"
        },
        {
          "nombre": "SFS Trujillo  - E&G"
        },
        {
          "nombre": "SFS Chiclayo II  - EXACTA"
        },
        {
          "nombre": "SFS Chorrillos  - SHARF"
        },
        {
          "nombre": "SFS Los Olivos  - SHARF"
        },
        {
          "nombre": "SFS San isidro  - SHARF"
        },
        {
          "nombre": "SFS Jockey Plaza  - SHARF"
        },
        {
          "nombre": "SFS San Miguel  - SHARF"
        },
        {
          "nombre": "SFS Miraflores  - SHARF"
        },
        {
          "nombre": "SFS - SJL  - SHARF"
        },
        {
          "nombre": "SFS Comas  - SHARF"
        },
        {
          "nombre": "SFS Chimbote  - EXACTA"
        },
        {
          "nombre": "SFS Huancayo  - TFART"
        }
      ],
      "bloques": [
        {
          "tipo": "simulacion",
          "nota": "Primera fecha de despacho (DT)",
          "items": [
            {
              "fila": "SFS San isidro  - SHARF",
              "campos": {
                "servicio": "DT",
                "metodo": "DP",
                "operador": "1017",
                "almacen": "20027",
                "sku": "2025364075592",
                "canal": "TVI"
              },
              "ref": {
                "comunaId": "5d2f8c2f40ae9d7f94e5b281",
                "ubigeo": "150140"
              }
            },
            {
              "fila": "SFS Los Olivos  - SHARF",
              "campos": {
                "servicio": "DT",
                "metodo": "DP",
                "operador": "1024",
                "almacen": "20024",
                "sku": "2025364075592",
                "canal": "TVI"
              },
              "ref": {
                "comunaId": "5d2f8c2f40ae9d7f94e5b281",
                "ubigeo": "150140"
              }
            },
            {
              "fila": "SFS Miraflores  - SHARF",
              "campos": {
                "servicio": "DT",
                "metodo": "DP",
                "operador": "1030",
                "almacen": "20030",
                "sku": "2025364075592",
                "canal": "TVI"
              },
              "ref": {
                "comunaId": "5d2f8c2f40ae9d7f94e5b281",
                "ubigeo": "150140"
              }
            },
            {
              "fila": "SFS Chorrillos  - SHARF",
              "campos": {
                "servicio": "DT",
                "metodo": "DP",
                "operador": "1121",
                "almacen": "20021",
                "sku": "2025364075592",
                "canal": "TVI"
              },
              "ref": {
                "comunaId": "5d2f8c2f40ae9d7f94e5b281",
                "ubigeo": "150140"
              }
            },
            {
              "fila": "SFS Jockey Plaza  - SHARF",
              "campos": {
                "servicio": "DT",
                "metodo": "DP",
                "operador": "1125",
                "almacen": "20025",
                "sku": "2025364075592",
                "canal": "TVI"
              },
              "ref": {
                "comunaId": "5d2f8c2f40ae9d7f94e5b281",
                "ubigeo": "150140"
              }
            },
            {
              "fila": "SFS San Miguel  - SHARF",
              "campos": {
                "servicio": "DT",
                "metodo": "DP",
                "operador": "1128",
                "almacen": "20028",
                "sku": "2025364075592",
                "canal": "TVI"
              },
              "ref": {
                "comunaId": "5d2f8c2f40ae9d7f94e5b281",
                "ubigeo": "150140"
              }
            },
            {
              "fila": "SFS Comas  - SHARF",
              "campos": {
                "servicio": "DT",
                "metodo": "DP",
                "operador": "1189",
                "almacen": "20089",
                "sku": "2025364075592",
                "canal": "TVI"
              },
              "ref": {
                "comunaId": "5d2f8c2f40ae9d7f94e5b281",
                "ubigeo": "150140"
              }
            },
            {
              "fila": "SFS - SJL  - SHARF",
              "campos": {
                "servicio": "DT",
                "metodo": "DP",
                "operador": "1157",
                "almacen": "20057",
                "sku": "2025364075592",
                "canal": "TVI"
              },
              "ref": {
                "comunaId": "5d2f8c2f40ae9d7f94e5b281",
                "ubigeo": "150140"
              }
            },
            {
              "fila": "SFS Arequipa  - EXACTA",
              "campos": {
                "servicio": "DT",
                "metodo": "DP",
                "operador": "1162",
                "almacen": "20062",
                "sku": "2025364075592",
                "canal": "TVI"
              },
              "ref": {
                "comunaId": "5d2f8c2140ae9d7f94e5aeb9",
                "ubigeo": "040101"
              }
            },
            {
              "fila": "SFS Chimbote  - EXACTA",
              "campos": {
                "servicio": "DT",
                "metodo": "DP",
                "operador": "1169",
                "almacen": "20069",
                "sku": "2025364075592",
                "canal": "TVI"
              },
              "ref": {
                "comunaId": "5d2f8c1f40ae9d7f94e5ae4e",
                "ubigeo": "021801"
              }
            },
            {
              "fila": "SFS Huancayo  - TFART",
              "campos": {
                "servicio": "DT",
                "metodo": "DP",
                "operador": "1172",
                "almacen": "20072",
                "sku": "2025364075592",
                "canal": "TVI"
              },
              "ref": {
                "comunaId": "5d2f8c2b40ae9d7f94e5b166",
                "ubigeo": "120101"
              }
            },
            {
              "fila": "SFS Piura II  - EXACTA",
              "campos": {
                "servicio": "DT",
                "metodo": "DP",
                "operador": "1177",
                "almacen": "20077",
                "sku": "2025364075592",
                "canal": "TVI"
              },
              "ref": {
                "comunaId": "5d2f8c3340ae9d7f94e5b376",
                "ubigeo": "200101"
              }
            },
            {
              "fila": "SFS Ica  - EXACTA",
              "campos": {
                "servicio": "DT",
                "metodo": "DP",
                "operador": "1180",
                "almacen": "20080",
                "sku": "2025364075592",
                "canal": "TVI"
              },
              "ref": {
                "comunaId": "5d2f8c2b40ae9d7f94e5b13b",
                "ubigeo": "110101"
              }
            },
            {
              "fila": "SFS Chiclayo II  - EXACTA",
              "campos": {
                "servicio": "DT",
                "metodo": "DP",
                "operador": "1188",
                "almacen": "20088",
                "sku": "2025364075592",
                "canal": "TVI"
              },
              "ref": {
                "comunaId": "5d2f8c2e40ae9d7f94e5b234",
                "ubigeo": "140101"
              }
            },
            {
              "fila": "SFS Trujillo  - E&G",
              "campos": {
                "servicio": "DT",
                "metodo": "DP",
                "operador": "1140",
                "almacen": "20040",
                "sku": "2025364075592",
                "canal": "TVI"
              },
              "ref": {
                "comunaId": "5d2f8c2d40ae9d7f94e5b1e1",
                "ubigeo": "130101"
              }
            }
          ]
        },
        {
          "tipo": "despacho",
          "nota": "Agenda de despacho de cada SFS",
          "items": [
            {
              "fila": "SFS San isidro  - SHARF",
              "campos": {
                "codigo": "1017",
                "zona": "Zona SFS 1017"
              }
            },
            {
              "fila": "SFS Los Olivos  - SHARF",
              "campos": {
                "codigo": "1024",
                "zona": "Zona SFS 1024"
              }
            },
            {
              "fila": "SFS Miraflores  - SHARF",
              "campos": {
                "codigo": "1030",
                "zona": "Zona SFS 1030"
              }
            },
            {
              "fila": "SFS Chorrillos  - SHARF",
              "campos": {
                "codigo": "1121",
                "zona": "Zona1121 - Suc. Chorrillos"
              }
            },
            {
              "fila": "SFS Jockey Plaza  - SHARF",
              "campos": {
                "codigo": "1125",
                "zona": "Zona SFS 1125"
              }
            },
            {
              "fila": "SFS San Miguel  - SHARF",
              "campos": {
                "codigo": "1128",
                "zona": "Zona 1128 - Suc. San Miguel II"
              }
            },
            {
              "fila": "SFS Trujillo  - E&G",
              "campos": {
                "codigo": "1140",
                "zona": "Zona SFS 1140"
              }
            },
            {
              "fila": "SFS - SJL  - SHARF",
              "campos": {
                "codigo": "1157",
                "zona": "Zona  1157 - SFS San Juan de Lurigancho"
              }
            },
            {
              "fila": "SFS Arequipa  - EXACTA",
              "campos": {
                "codigo": "1162",
                "zona": "SFS Arequipa"
              }
            },
            {
              "fila": "SFS Chimbote  - EXACTA",
              "campos": {
                "codigo": "1169",
                "zona": "Zona SFS 1169"
              }
            },
            {
              "fila": "SFS Huancayo  - TFART",
              "campos": {
                "codigo": "1172",
                "zona": "Zona SFS 1172"
              }
            },
            {
              "fila": "SFS Piura II  - EXACTA",
              "campos": {
                "codigo": "1177",
                "zona": "Zona SFS 1177"
              }
            },
            {
              "fila": "SFS Ica  - EXACTA",
              "campos": {
                "codigo": "1180",
                "zona": "Zona SFS 1180"
              }
            },
            {
              "fila": "SFS Chiclayo II  - EXACTA",
              "campos": {
                "codigo": "1188",
                "zona": "SFS Chiclayo II"
              }
            },
            {
              "fila": "SFS Comas  - SHARF",
              "campos": {
                "codigo": "1189",
                "zona": "Zona SFS 1189"
              }
            }
          ]
        }
      ]
    },
    {
      "clave": "store_to_store",
      "filas": [
        {
          "nombre": "San Isidro"
        },
        {
          "nombre": "Jockey Plaza"
        },
        {
          "nombre": "San Miguel"
        },
        {
          "nombre": "San Juan de Lurigancho"
        },
        {
          "nombre": "Miraflores"
        },
        {
          "nombre": "Chorrillos"
        },
        {
          "nombre": "Los Olivos"
        }
      ],
      "bloques": [
        {
          "tipo": "picking",
          "nota": "Picking SS de cada tienda",
          "items": [
            {
              "fila": "San Isidro",
              "campos": {
                "codigo": "20027",
                "servicio": "SS"
              }
            },
            {
              "fila": "Jockey Plaza",
              "campos": {
                "codigo": "20025",
                "servicio": "SS"
              }
            },
            {
              "fila": "San Miguel",
              "campos": {
                "codigo": "20028",
                "servicio": "SS"
              }
            },
            {
              "fila": "San Juan de Lurigancho",
              "campos": {
                "codigo": "20057",
                "servicio": "SS"
              }
            },
            {
              "fila": "Miraflores",
              "campos": {
                "codigo": "20030",
                "servicio": "SS"
              }
            },
            {
              "fila": "Chorrillos",
              "campos": {
                "codigo": "20021",
                "servicio": "SS"
              }
            },
            {
              "fila": "Los Olivos",
              "campos": {
                "codigo": "20024",
                "servicio": "SS"
              }
            }
          ]
        }
      ]
    },
    {
      "clave": "pickup_lima",
      "filas": [
        {
          "nombre": "San Isidro"
        },
        {
          "nombre": "Miraflores"
        },
        {
          "nombre": "San Miguel"
        },
        {
          "nombre": "Primavera"
        },
        {
          "nombre": "Ripley SJL"
        },
        {
          "nombre": "Breña"
        },
        {
          "nombre": "Atocongo"
        },
        {
          "nombre": "Comas"
        },
        {
          "nombre": "San Borja"
        },
        {
          "nombre": "Jockey Plaza"
        },
        {
          "nombre": "Plaza Lima Norte"
        },
        {
          "nombre": "Salaverry"
        },
        {
          "nombre": "Ripley Callao"
        },
        {
          "nombre": "Los Olivos"
        },
        {
          "nombre": "Puruchuco"
        },
        {
          "nombre": "Chorrillos"
        },
        {
          "nombre": "Santa Anita"
        }
      ],
      "bloques": [
        {
          "tipo": "simulacion",
          "nota": "RE: se prueba con una tienda; si no da fecha, no se piden las demás",
          "items": [
            {
              "fila": "San Isidro",
              "campos": {
                "servicio": "RE",
                "metodo": "RT",
                "operador": "20027",
                "almacen": "20027",
                "sku": "2025364075592",
                "canal": "TVI"
              },
              "ref": {
                "comunaId": "5d2f8c2f40ae9d7f94e5b26b",
                "ubigeo": "150118"
              }
            },
            {
              "fila": "Miraflores",
              "campos": {
                "servicio": "RE",
                "metodo": "RT",
                "operador": "20030",
                "almacen": "20030",
                "sku": "2025364075592",
                "canal": "TVI"
              },
              "ref": {
                "comunaId": "5d2f8c2f40ae9d7f94e5b26d",
                "ubigeo": "150120"
              }
            },
            {
              "fila": "San Miguel",
              "campos": {
                "servicio": "RE",
                "metodo": "RT",
                "operador": "20028",
                "almacen": "20028",
                "sku": "2025364075592",
                "canal": "TVI"
              },
              "ref": {
                "comunaId": "5d2f8c2f40ae9d7f94e5b26c",
                "ubigeo": "150119"
              }
            },
            {
              "fila": "Primavera",
              "campos": {
                "servicio": "RE",
                "metodo": "RT",
                "operador": "20023",
                "almacen": "20023",
                "sku": "2025364075592",
                "canal": "TVI"
              },
              "ref": {
                "comunaId": "5d2f8c2f40ae9d7f94e5b268",
                "ubigeo": "150115"
              }
            },
            {
              "fila": "Ripley SJL",
              "campos": {
                "servicio": "RE",
                "metodo": "RT",
                "operador": "20057",
                "almacen": "20057",
                "sku": "2025364075592",
                "canal": "TVI"
              },
              "ref": {
                "comunaId": "5d2f8c2f40ae9d7f94e5b272",
                "ubigeo": "150125"
              }
            },
            {
              "fila": "Breña",
              "campos": {
                "servicio": "RE",
                "metodo": "RT",
                "operador": "20048",
                "almacen": "20048",
                "sku": "2025364075592",
                "canal": "TVI"
              },
              "ref": {
                "comunaId": "5d2f8c2f40ae9d7f94e5b25a",
                "ubigeo": "150101"
              }
            },
            {
              "fila": "Atocongo",
              "campos": {
                "servicio": "RE",
                "metodo": "RT",
                "operador": "20058",
                "almacen": "20058",
                "sku": "2025364075592",
                "canal": "TVI"
              },
              "ref": {
                "comunaId": "5d2f8c2f40ae9d7f94e5b26e",
                "ubigeo": "150121"
              }
            },
            {
              "fila": "Comas",
              "campos": {
                "servicio": "RE",
                "metodo": "RT",
                "operador": "20089",
                "almacen": "20089",
                "sku": "2025364075592",
                "canal": "TVI"
              },
              "ref": {
                "comunaId": "5d2f8c2f40ae9d7f94e5b25d",
                "ubigeo": "150104"
              }
            },
            {
              "fila": "San Borja",
              "campos": {
                "servicio": "RE",
                "metodo": "RT",
                "operador": "20074",
                "almacen": "20074",
                "sku": "2025364075592",
                "canal": "TVI"
              },
              "ref": {
                "comunaId": "5d2f8c2f40ae9d7f94e5b271",
                "ubigeo": "150124"
              }
            },
            {
              "fila": "Jockey Plaza",
              "campos": {
                "servicio": "RE",
                "metodo": "RT",
                "operador": "20025",
                "almacen": "20025",
                "sku": "2025364075592",
                "canal": "TVI"
              },
              "ref": {
                "comunaId": "5d2f8c2f40ae9d7f94e5b26a",
                "ubigeo": "150117"
              }
            },
            {
              "fila": "Plaza Lima Norte",
              "campos": {
                "servicio": "RE",
                "metodo": "RT",
                "operador": "20066",
                "almacen": "20066",
                "sku": "2025364075592",
                "canal": "TVI"
              },
              "ref": {
                "comunaId": "5d2f8c2f40ae9d7f94e5b26f",
                "ubigeo": "150122"
              }
            },
            {
              "fila": "Salaverry",
              "campos": {
                "servicio": "RE",
                "metodo": "RT",
                "operador": "20079",
                "almacen": "20079",
                "sku": "2025364075592",
                "canal": "TVI"
              },
              "ref": {
                "comunaId": "5d2f8c2f40ae9d7f94e5b270",
                "ubigeo": "150123"
              }
            },
            {
              "fila": "Ripley Callao",
              "campos": {
                "servicio": "RE",
                "metodo": "RT",
                "operador": "20043",
                "almacen": "20043",
                "sku": "2025364075592",
                "canal": "TVI"
              },
              "ref": {
                "comunaId": "5d2f8c2640ae9d7f94e5b01a",
                "ubigeo": "070101"
              }
            },
            {
              "fila": "Los Olivos",
              "campos": {
                "servicio": "RE",
                "metodo": "RT",
                "operador": "20024",
                "almacen": "20024",
                "sku": "2025364075592",
                "canal": "TVI"
              },
              "ref": {
                "comunaId": "5d2f8c2f40ae9d7f94e5b269",
                "ubigeo": "150116"
              }
            },
            {
              "fila": "Puruchuco",
              "campos": {
                "servicio": "RE",
                "metodo": "RT",
                "operador": "20095",
                "almacen": "20095",
                "sku": "2025364075592",
                "canal": "TVI"
              },
              "ref": {
                "comunaId": "5d2f8c2f40ae9d7f94e5b277",
                "ubigeo": "150130"
              }
            },
            {
              "fila": "Chorrillos",
              "campos": {
                "servicio": "RE",
                "metodo": "RT",
                "operador": "20021",
                "almacen": "20021",
                "sku": "2025364075592",
                "canal": "TVI"
              },
              "ref": {
                "comunaId": "5d2f8c2f40ae9d7f94e5b267",
                "ubigeo": "150114"
              }
            },
            {
              "fila": "Santa Anita",
              "campos": {
                "servicio": "RE",
                "metodo": "RT",
                "operador": "20073",
                "almacen": "20073",
                "sku": "2025364075592",
                "canal": "TVI"
              },
              "ref": {
                "comunaId": "5d2f8c2f40ae9d7f94e5b270",
                "ubigeo": "150123"
              }
            }
          ],
          "muestra": true
        },
        {
          "tipo": "simulacion",
          "nota": "RT",
          "items": [
            {
              "fila": "San Isidro",
              "campos": {
                "servicio": "RT",
                "metodo": "RT",
                "operador": "20027",
                "almacen": "20027",
                "sku": "2025364075592",
                "canal": "TVI"
              },
              "ref": {
                "comunaId": "5d2f8c2f40ae9d7f94e5b26b",
                "ubigeo": "150118"
              }
            },
            {
              "fila": "Miraflores",
              "campos": {
                "servicio": "RT",
                "metodo": "RT",
                "operador": "20030",
                "almacen": "20030",
                "sku": "2025364075592",
                "canal": "TVI"
              },
              "ref": {
                "comunaId": "5d2f8c2f40ae9d7f94e5b26d",
                "ubigeo": "150120"
              }
            },
            {
              "fila": "San Miguel",
              "campos": {
                "servicio": "RT",
                "metodo": "RT",
                "operador": "20028",
                "almacen": "20028",
                "sku": "2025364075592",
                "canal": "TVI"
              },
              "ref": {
                "comunaId": "5d2f8c2f40ae9d7f94e5b26c",
                "ubigeo": "150119"
              }
            },
            {
              "fila": "Primavera",
              "campos": {
                "servicio": "RT",
                "metodo": "RT",
                "operador": "20023",
                "almacen": "20023",
                "sku": "2025364075592",
                "canal": "TVI"
              },
              "ref": {
                "comunaId": "5d2f8c2f40ae9d7f94e5b268",
                "ubigeo": "150115"
              }
            },
            {
              "fila": "Ripley SJL",
              "campos": {
                "servicio": "RT",
                "metodo": "RT",
                "operador": "20057",
                "almacen": "20057",
                "sku": "2025364075592",
                "canal": "TVI"
              },
              "ref": {
                "comunaId": "5d2f8c2f40ae9d7f94e5b272",
                "ubigeo": "150125"
              }
            },
            {
              "fila": "Breña",
              "campos": {
                "servicio": "RT",
                "metodo": "RT",
                "operador": "20048",
                "almacen": "20048",
                "sku": "2025364075592",
                "canal": "TVI"
              },
              "ref": {
                "comunaId": "5d2f8c2f40ae9d7f94e5b25a",
                "ubigeo": "150101"
              }
            },
            {
              "fila": "Atocongo",
              "campos": {
                "servicio": "RT",
                "metodo": "RT",
                "operador": "20058",
                "almacen": "20058",
                "sku": "2025364075592",
                "canal": "TVI"
              },
              "ref": {
                "comunaId": "5d2f8c2f40ae9d7f94e5b26e",
                "ubigeo": "150121"
              }
            },
            {
              "fila": "Comas",
              "campos": {
                "servicio": "RT",
                "metodo": "RT",
                "operador": "20089",
                "almacen": "20089",
                "sku": "2025364075592",
                "canal": "TVI"
              },
              "ref": {
                "comunaId": "5d2f8c2f40ae9d7f94e5b25d",
                "ubigeo": "150104"
              }
            },
            {
              "fila": "San Borja",
              "campos": {
                "servicio": "RT",
                "metodo": "RT",
                "operador": "20074",
                "almacen": "20074",
                "sku": "2025364075592",
                "canal": "TVI"
              },
              "ref": {
                "comunaId": "5d2f8c2f40ae9d7f94e5b271",
                "ubigeo": "150124"
              }
            },
            {
              "fila": "Jockey Plaza",
              "campos": {
                "servicio": "RT",
                "metodo": "RT",
                "operador": "20025",
                "almacen": "20025",
                "sku": "2025364075592",
                "canal": "TVI"
              },
              "ref": {
                "comunaId": "5d2f8c2f40ae9d7f94e5b26a",
                "ubigeo": "150117"
              }
            },
            {
              "fila": "Plaza Lima Norte",
              "campos": {
                "servicio": "RT",
                "metodo": "RT",
                "operador": "20066",
                "almacen": "20066",
                "sku": "2025364075592",
                "canal": "TVI"
              },
              "ref": {
                "comunaId": "5d2f8c2f40ae9d7f94e5b26f",
                "ubigeo": "150122"
              }
            },
            {
              "fila": "Salaverry",
              "campos": {
                "servicio": "RT",
                "metodo": "RT",
                "operador": "20079",
                "almacen": "20079",
                "sku": "2025364075592",
                "canal": "TVI"
              },
              "ref": {
                "comunaId": "5d2f8c2f40ae9d7f94e5b270",
                "ubigeo": "150123"
              }
            },
            {
              "fila": "Ripley Callao",
              "campos": {
                "servicio": "RT",
                "metodo": "RT",
                "operador": "20043",
                "almacen": "20043",
                "sku": "2025364075592",
                "canal": "TVI"
              },
              "ref": {
                "comunaId": "5d2f8c2640ae9d7f94e5b01a",
                "ubigeo": "070101"
              }
            },
            {
              "fila": "Los Olivos",
              "campos": {
                "servicio": "RT",
                "metodo": "RT",
                "operador": "20024",
                "almacen": "20024",
                "sku": "2025364075592",
                "canal": "TVI"
              },
              "ref": {
                "comunaId": "5d2f8c2f40ae9d7f94e5b269",
                "ubigeo": "150116"
              }
            },
            {
              "fila": "Puruchuco",
              "campos": {
                "servicio": "RT",
                "metodo": "RT",
                "operador": "20095",
                "almacen": "20095",
                "sku": "2025364075592",
                "canal": "TVI"
              },
              "ref": {
                "comunaId": "5d2f8c2f40ae9d7f94e5b277",
                "ubigeo": "150130"
              }
            },
            {
              "fila": "Chorrillos",
              "campos": {
                "servicio": "RT",
                "metodo": "RT",
                "operador": "20021",
                "almacen": "20021",
                "sku": "2025364075592",
                "canal": "TVI"
              },
              "ref": {
                "comunaId": "5d2f8c2f40ae9d7f94e5b267",
                "ubigeo": "150114"
              }
            },
            {
              "fila": "Santa Anita",
              "campos": {
                "servicio": "RT",
                "metodo": "RT",
                "operador": "20073",
                "almacen": "20073",
                "sku": "2025364075592",
                "canal": "TVI"
              },
              "ref": {
                "comunaId": "5d2f8c2f40ae9d7f94e5b270",
                "ubigeo": "150123"
              }
            }
          ]
        },
        {
          "tipo": "picking",
          "nota": "Picking RT/RE de cada tienda (con RT, el día anterior)",
          "items": [
            {
              "fila": "San Isidro",
              "campos": {
                "codigo": "20027",
                "servicio": "RT"
              },
              "ref": {
                "agendaId": "65d3b945220003c4ab977efe"
              }
            },
            {
              "fila": "San Isidro",
              "campos": {
                "codigo": "20027",
                "servicio": "RE"
              },
              "ref": {
                "agendaId": "697b78f2610ae59cb349289d"
              }
            },
            {
              "fila": "Miraflores",
              "campos": {
                "codigo": "20030",
                "servicio": "RT"
              },
              "ref": {
                "agendaId": "650392670a680c0012ad685d"
              }
            },
            {
              "fila": "Miraflores",
              "campos": {
                "codigo": "20030",
                "servicio": "RE"
              },
              "ref": {
                "agendaId": "697b89ba610ae59cb3498bdb"
              }
            },
            {
              "fila": "San Miguel",
              "campos": {
                "codigo": "20028",
                "servicio": "RT"
              },
              "ref": {
                "agendaId": "650486380a680c0012ad6be4"
              }
            },
            {
              "fila": "San Miguel",
              "campos": {
                "codigo": "20028",
                "servicio": "RE"
              },
              "ref": {
                "agendaId": "697b8158610ae59cb34954f4"
              }
            },
            {
              "fila": "Primavera",
              "campos": {
                "codigo": "20023",
                "servicio": "RT"
              },
              "ref": {
                "agendaId": "6328cad38e6d0300124189ac"
              }
            },
            {
              "fila": "Primavera",
              "campos": {
                "codigo": "20023",
                "servicio": "RE"
              },
              "ref": {
                "agendaId": "697b6475610ae59cb348bef0"
              }
            },
            {
              "fila": "Ripley SJL",
              "campos": {
                "codigo": "20057",
                "servicio": "RT"
              },
              "ref": {
                "agendaId": "6567baeeb99d710012a7f2d2"
              }
            },
            {
              "fila": "Ripley SJL",
              "campos": {
                "codigo": "20057",
                "servicio": "RE"
              },
              "ref": {
                "agendaId": "697cc3c1610ae59cb34f343f"
              }
            },
            {
              "fila": "Breña",
              "campos": {
                "codigo": "20048",
                "servicio": "RT"
              },
              "ref": {
                "agendaId": "6328b2fcfb418200132c7dd9"
              }
            },
            {
              "fila": "Breña",
              "campos": {
                "codigo": "20048",
                "servicio": "RE"
              },
              "ref": {
                "agendaId": "697e06b9610ae59cb34fba78"
              }
            },
            {
              "fila": "Atocongo",
              "campos": {
                "codigo": "20058",
                "servicio": "RT"
              },
              "ref": {
                "agendaId": "6324ba85efb8b80012ca7530"
              }
            },
            {
              "fila": "Atocongo",
              "campos": {
                "codigo": "20058",
                "servicio": "RE"
              },
              "ref": {
                "agendaId": "697cda979e95a7dd94616205"
              }
            },
            {
              "fila": "Comas",
              "campos": {
                "codigo": "20089",
                "servicio": "RT"
              },
              "ref": {
                "agendaId": "6329d3a38e6d030012421215"
              }
            },
            {
              "fila": "Comas",
              "campos": {
                "codigo": "20089",
                "servicio": "RE"
              },
              "ref": {
                "agendaId": "697e25a69e95a7dd94621a92"
              }
            },
            {
              "fila": "San Borja",
              "campos": {
                "codigo": "20074",
                "servicio": "RT"
              },
              "ref": {
                "agendaId": "6328e4d42f6f630012528481"
              }
            },
            {
              "fila": "San Borja",
              "campos": {
                "codigo": "20074",
                "servicio": "RE"
              },
              "ref": {
                "agendaId": "697d170c610ae59cb34f7bf8"
              }
            },
            {
              "fila": "Jockey Plaza",
              "campos": {
                "codigo": "20025",
                "servicio": "RT"
              },
              "ref": {
                "agendaId": "650481fce0689f00120bbe9f"
              }
            },
            {
              "fila": "Jockey Plaza",
              "campos": {
                "codigo": "20025",
                "servicio": "RE"
              },
              "ref": {
                "agendaId": "69616235e11e7ea3877f02a5"
              }
            },
            {
              "fila": "Plaza Lima Norte",
              "campos": {
                "codigo": "20066",
                "servicio": "RT"
              },
              "ref": {
                "agendaId": "63249534efb8b80012ca60e9"
              }
            },
            {
              "fila": "Plaza Lima Norte",
              "campos": {
                "codigo": "20066",
                "servicio": "RE"
              },
              "ref": {
                "agendaId": "697ce2bc610ae59cb34f4500"
              }
            },
            {
              "fila": "Salaverry",
              "campos": {
                "codigo": "20079",
                "servicio": "RT"
              },
              "ref": {
                "agendaId": "6329f74b1f7899001497ffec"
              }
            },
            {
              "fila": "Salaverry",
              "campos": {
                "codigo": "20079",
                "servicio": "RE"
              },
              "ref": {
                "agendaId": "697d282e610ae59cb34f7ff4"
              }
            },
            {
              "fila": "Ripley Callao",
              "campos": {
                "codigo": "20043",
                "servicio": "RT"
              },
              "ref": {
                "agendaId": "6329e2478e6d030012422525"
              }
            },
            {
              "fila": "Ripley Callao",
              "campos": {
                "codigo": "20043",
                "servicio": "RE"
              },
              "ref": {
                "agendaId": "697e1c479e95a7dd9462154c"
              }
            },
            {
              "fila": "Los Olivos",
              "campos": {
                "codigo": "20024",
                "servicio": "RT"
              },
              "ref": {
                "agendaId": "6504808c051b700012e74a4e"
              }
            },
            {
              "fila": "Los Olivos",
              "campos": {
                "codigo": "20024",
                "servicio": "RE"
              },
              "ref": {
                "agendaId": "697b704f610ae59cb348f323"
              }
            },
            {
              "fila": "Puruchuco",
              "campos": {
                "codigo": "20095",
                "servicio": "RT"
              },
              "ref": {
                "agendaId": "6328ed791f78990014974625"
              }
            },
            {
              "fila": "Puruchuco",
              "campos": {
                "codigo": "20095",
                "servicio": "RE"
              },
              "ref": {
                "agendaId": "697e340c9e95a7dd946252b4"
              }
            },
            {
              "fila": "Chorrillos",
              "campos": {
                "codigo": "20021",
                "servicio": "RT"
              },
              "ref": {
                "agendaId": "6328c9e7372ed3001324e3fa"
              }
            },
            {
              "fila": "Chorrillos",
              "campos": {
                "codigo": "20021",
                "servicio": "RE"
              },
              "ref": {
                "agendaId": "697a13469e95a7dd9460a0c8"
              }
            },
            {
              "fila": "Santa Anita",
              "campos": {
                "codigo": "20073",
                "servicio": "RT"
              },
              "ref": {
                "agendaId": "6324eaf4f834b8001201b3ea"
              }
            },
            {
              "fila": "Santa Anita",
              "campos": {
                "codigo": "20073",
                "servicio": "RE"
              },
              "ref": {
                "agendaId": "697e2cdd9e95a7dd94621e30"
              }
            }
          ]
        }
      ]
    },
    {
      "clave": "pickup_provincia",
      "filas": [
        {
          "nombre": "Chiclayo II"
        },
        {
          "nombre": "Huancayo"
        },
        {
          "nombre": "Ica"
        },
        {
          "nombre": "Iquitos"
        },
        {
          "nombre": "Chiclayo"
        },
        {
          "nombre": "Piura II"
        },
        {
          "nombre": "Trujillo"
        },
        {
          "nombre": "Chimbote"
        },
        {
          "nombre": "Arequipa"
        },
        {
          "nombre": "Cajamarca"
        },
        {
          "nombre": "Pucallpa"
        },
        {
          "nombre": "Cayma"
        },
        {
          "nombre": "Juliaca"
        }
      ],
      "bloques": [
        {
          "tipo": "simulacion",
          "nota": "RE: se prueba con una tienda; si no da fecha, no se piden las demás",
          "items": [
            {
              "fila": "Chiclayo II",
              "campos": {
                "servicio": "RE",
                "metodo": "RT",
                "operador": "20088",
                "almacen": "20088",
                "sku": "2025364075592",
                "canal": "TVI"
              },
              "ref": {
                "comunaId": "5d2f8c2e40ae9d7f94e5b235",
                "ubigeo": "140102"
              }
            },
            {
              "fila": "Huancayo",
              "campos": {
                "servicio": "RE",
                "metodo": "RT",
                "operador": "20072",
                "almacen": "20072",
                "sku": "2025364075592",
                "canal": "TVI"
              },
              "ref": {
                "comunaId": "5d2f8c2b40ae9d7f94e5b166",
                "ubigeo": "120101"
              }
            },
            {
              "fila": "Ica",
              "campos": {
                "servicio": "RE",
                "metodo": "RT",
                "operador": "20080",
                "almacen": "20080",
                "sku": "2025364075592",
                "canal": "TVI"
              },
              "ref": {
                "comunaId": "5d2f8c2b40ae9d7f94e5b13b",
                "ubigeo": "110101"
              }
            },
            {
              "fila": "Iquitos",
              "campos": {
                "servicio": "RE",
                "metodo": "RT",
                "operador": "20056",
                "almacen": "20056",
                "sku": "2025364075592",
                "canal": "TVI"
              },
              "ref": {
                "comunaId": "5d2f8c3140ae9d7f94e5b305",
                "ubigeo": "160101"
              }
            },
            {
              "fila": "Chiclayo",
              "campos": {
                "servicio": "RE",
                "metodo": "RT",
                "operador": "20041",
                "almacen": "20041",
                "sku": "2025364075592",
                "canal": "TVI"
              },
              "ref": {
                "comunaId": "5d2f8c2e40ae9d7f94e5b234",
                "ubigeo": "140101"
              }
            },
            {
              "fila": "Piura II",
              "campos": {
                "servicio": "RE",
                "metodo": "RT",
                "operador": "20077",
                "almacen": "20077",
                "sku": "2025364075592",
                "canal": "TVI"
              },
              "ref": {
                "comunaId": "5d2f8c3340ae9d7f94e5b376",
                "ubigeo": "200101"
              }
            },
            {
              "fila": "Trujillo",
              "campos": {
                "servicio": "RE",
                "metodo": "RT",
                "operador": "20040",
                "almacen": "20040",
                "sku": "2025364075592",
                "canal": "TVI"
              },
              "ref": {
                "comunaId": "5d2f8c2d40ae9d7f94e5b1e1",
                "ubigeo": "130101"
              }
            },
            {
              "fila": "Chimbote",
              "campos": {
                "servicio": "RE",
                "metodo": "RT",
                "operador": "20069",
                "almacen": "20069",
                "sku": "2025364075592",
                "canal": "TVI"
              },
              "ref": {
                "comunaId": "5d2f8c1d40ae9d7f94e5adc3",
                "ubigeo": "020101"
              }
            },
            {
              "fila": "Arequipa",
              "campos": {
                "servicio": "RE",
                "metodo": "RT",
                "operador": "20062",
                "almacen": "20062",
                "sku": "2025364075592",
                "canal": "TVI"
              },
              "ref": {
                "comunaId": "5d2f8c2140ae9d7f94e5aeb9",
                "ubigeo": "040101"
              }
            },
            {
              "fila": "Cajamarca",
              "campos": {
                "servicio": "RE",
                "metodo": "RT",
                "operador": "20078",
                "almacen": "20078",
                "sku": "2025364075592",
                "canal": "TVI"
              },
              "ref": {
                "comunaId": "5d2f8c2440ae9d7f94e5af9b",
                "ubigeo": "060101"
              }
            },
            {
              "fila": "Pucallpa",
              "campos": {
                "servicio": "RE",
                "metodo": "RT",
                "operador": "20086",
                "almacen": "20086",
                "sku": "2025364075592",
                "canal": "TVI"
              },
              "ref": {
                "comunaId": "6202ae28af2ff9145a5dcec4",
                "ubigeo": "250108"
              }
            },
            {
              "fila": "Cayma",
              "campos": {
                "servicio": "RE",
                "metodo": "RT",
                "operador": "20049",
                "almacen": "20049",
                "sku": "2025364075592",
                "canal": "TVI"
              },
              "ref": {
                "comunaId": "5d2f8c2140ae9d7f94e5aeba",
                "ubigeo": "040102"
              }
            },
            {
              "fila": "Juliaca",
              "campos": {
                "servicio": "RE",
                "metodo": "RT",
                "operador": "20047",
                "almacen": "20047",
                "sku": "2025364075592",
                "canal": "TVI"
              },
              "ref": {
                "comunaId": "5d2f8c3540ae9d7f94e5b40f",
                "ubigeo": "211101"
              }
            }
          ],
          "muestra": true
        },
        {
          "tipo": "simulacion",
          "nota": "RT",
          "items": [
            {
              "fila": "Chiclayo II",
              "campos": {
                "servicio": "RT",
                "metodo": "RT",
                "operador": "20088",
                "almacen": "20088",
                "sku": "2025364075592",
                "canal": "TVI"
              },
              "ref": {
                "comunaId": "5d2f8c2e40ae9d7f94e5b235",
                "ubigeo": "140102"
              }
            },
            {
              "fila": "Huancayo",
              "campos": {
                "servicio": "RT",
                "metodo": "RT",
                "operador": "20072",
                "almacen": "20072",
                "sku": "2025364075592",
                "canal": "TVI"
              },
              "ref": {
                "comunaId": "5d2f8c2b40ae9d7f94e5b166",
                "ubigeo": "120101"
              }
            },
            {
              "fila": "Ica",
              "campos": {
                "servicio": "RT",
                "metodo": "RT",
                "operador": "20080",
                "almacen": "20080",
                "sku": "2025364075592",
                "canal": "TVI"
              },
              "ref": {
                "comunaId": "5d2f8c2b40ae9d7f94e5b13b",
                "ubigeo": "110101"
              }
            },
            {
              "fila": "Iquitos",
              "campos": {
                "servicio": "RT",
                "metodo": "RT",
                "operador": "20056",
                "almacen": "20056",
                "sku": "2025364075592",
                "canal": "TVI"
              },
              "ref": {
                "comunaId": "5d2f8c3140ae9d7f94e5b305",
                "ubigeo": "160101"
              }
            },
            {
              "fila": "Chiclayo",
              "campos": {
                "servicio": "RT",
                "metodo": "RT",
                "operador": "20041",
                "almacen": "20041",
                "sku": "2025364075592",
                "canal": "TVI"
              },
              "ref": {
                "comunaId": "5d2f8c2e40ae9d7f94e5b234",
                "ubigeo": "140101"
              }
            },
            {
              "fila": "Piura II",
              "campos": {
                "servicio": "RT",
                "metodo": "RT",
                "operador": "20077",
                "almacen": "20077",
                "sku": "2025364075592",
                "canal": "TVI"
              },
              "ref": {
                "comunaId": "5d2f8c3340ae9d7f94e5b376",
                "ubigeo": "200101"
              }
            },
            {
              "fila": "Trujillo",
              "campos": {
                "servicio": "RT",
                "metodo": "RT",
                "operador": "20040",
                "almacen": "20040",
                "sku": "2025364075592",
                "canal": "TVI"
              },
              "ref": {
                "comunaId": "5d2f8c2d40ae9d7f94e5b1e1",
                "ubigeo": "130101"
              }
            },
            {
              "fila": "Chimbote",
              "campos": {
                "servicio": "RT",
                "metodo": "RT",
                "operador": "20069",
                "almacen": "20069",
                "sku": "2025364075592",
                "canal": "TVI"
              },
              "ref": {
                "comunaId": "5d2f8c1d40ae9d7f94e5adc3",
                "ubigeo": "020101"
              }
            },
            {
              "fila": "Arequipa",
              "campos": {
                "servicio": "RT",
                "metodo": "RT",
                "operador": "20062",
                "almacen": "20062",
                "sku": "2025364075592",
                "canal": "TVI"
              },
              "ref": {
                "comunaId": "5d2f8c2140ae9d7f94e5aeb9",
                "ubigeo": "040101"
              }
            },
            {
              "fila": "Cajamarca",
              "campos": {
                "servicio": "RT",
                "metodo": "RT",
                "operador": "20078",
                "almacen": "20078",
                "sku": "2025364075592",
                "canal": "TVI"
              },
              "ref": {
                "comunaId": "5d2f8c2440ae9d7f94e5af9b",
                "ubigeo": "060101"
              }
            },
            {
              "fila": "Pucallpa",
              "campos": {
                "servicio": "RT",
                "metodo": "RT",
                "operador": "20086",
                "almacen": "20086",
                "sku": "2025364075592",
                "canal": "TVI"
              },
              "ref": {
                "comunaId": "6202ae28af2ff9145a5dcec4",
                "ubigeo": "250108"
              }
            },
            {
              "fila": "Cayma",
              "campos": {
                "servicio": "RT",
                "metodo": "RT",
                "operador": "20049",
                "almacen": "20049",
                "sku": "2025364075592",
                "canal": "TVI"
              },
              "ref": {
                "comunaId": "5d2f8c2140ae9d7f94e5aeba",
                "ubigeo": "040102"
              }
            },
            {
              "fila": "Juliaca",
              "campos": {
                "servicio": "RT",
                "metodo": "RT",
                "operador": "20047",
                "almacen": "20047",
                "sku": "2025364075592",
                "canal": "TVI"
              },
              "ref": {
                "comunaId": "5d2f8c3540ae9d7f94e5b40f",
                "ubigeo": "211101"
              }
            }
          ]
        },
        {
          "tipo": "picking",
          "nota": "Picking RT/RE de cada tienda (con RT, el día anterior)",
          "items": [
            {
              "fila": "Chiclayo II",
              "campos": {
                "codigo": "20088",
                "servicio": "RT"
              },
              "ref": {
                "agendaId": "632b82cb1f7899001498902d"
              }
            },
            {
              "fila": "Chiclayo II",
              "campos": {
                "codigo": "20088",
                "servicio": "RE"
              },
              "ref": {
                "agendaId": "698282b89e95a7dd946335f8"
              }
            },
            {
              "fila": "Huancayo",
              "campos": {
                "codigo": "20072",
                "servicio": "RT"
              },
              "ref": {
                "agendaId": "632b4c1cbc132600125a28c8"
              }
            },
            {
              "fila": "Huancayo",
              "campos": {
                "codigo": "20072",
                "servicio": "RE"
              },
              "ref": {
                "agendaId": "698280e0b228b32564103a24"
              }
            },
            {
              "fila": "Ica",
              "campos": {
                "codigo": "20080",
                "servicio": "RT"
              },
              "ref": {
                "agendaId": "632b53971f789900149881c3"
              }
            },
            {
              "fila": "Ica",
              "campos": {
                "codigo": "20080",
                "servicio": "RE"
              },
              "ref": {
                "agendaId": "69828344b228b32564103d88"
              }
            },
            {
              "fila": "Iquitos",
              "campos": {
                "codigo": "20056",
                "servicio": "RT"
              },
              "ref": {
                "agendaId": "64ee847713379a0012e9d17c"
              }
            },
            {
              "fila": "Iquitos",
              "campos": {
                "codigo": "20056",
                "servicio": "RE"
              },
              "ref": {
                "agendaId": "698352379e95a7dd94635df6"
              }
            },
            {
              "fila": "Chiclayo",
              "campos": {
                "codigo": "20041",
                "servicio": "RT"
              },
              "ref": {
                "agendaId": "632cc7261f7899001498c313"
              }
            },
            {
              "fila": "Chiclayo",
              "campos": {
                "codigo": "20041",
                "servicio": "RE"
              },
              "ref": {
                "agendaId": "696172095321f7a9af485d3b"
              }
            },
            {
              "fila": "Piura II",
              "campos": {
                "codigo": "20077",
                "servicio": "RT"
              },
              "ref": {
                "agendaId": "632b3c9c8e6d03001242aefd"
              }
            },
            {
              "fila": "Piura II",
              "campos": {
                "codigo": "20077",
                "servicio": "RE"
              },
              "ref": {
                "agendaId": "698269059e95a7dd94630346"
              }
            },
            {
              "fila": "Trujillo",
              "campos": {
                "codigo": "20040",
                "servicio": "RT"
              },
              "ref": {
                "agendaId": "632b287fbc1326001259eec8"
              }
            },
            {
              "fila": "Trujillo",
              "campos": {
                "codigo": "20040",
                "servicio": "RE"
              },
              "ref": {
                "agendaId": "698249a5610ae59cb3506b49"
              }
            },
            {
              "fila": "Chimbote",
              "campos": {
                "codigo": "20069",
                "servicio": "RT"
              },
              "ref": {
                "agendaId": "632e2733372ed3001326eaa2"
              }
            },
            {
              "fila": "Chimbote",
              "campos": {
                "codigo": "20069",
                "servicio": "RE"
              },
              "ref": {
                "agendaId": "6990c9d980f47d3f926f0043"
              }
            },
            {
              "fila": "Arequipa",
              "campos": {
                "codigo": "20062",
                "servicio": "RT"
              },
              "ref": {
                "agendaId": "632b36ee2f6f630012539d88"
              }
            },
            {
              "fila": "Arequipa",
              "campos": {
                "codigo": "20062",
                "servicio": "RE"
              },
              "ref": {
                "agendaId": "69825d2cb228b32564100bd3"
              }
            },
            {
              "fila": "Cajamarca",
              "campos": {
                "codigo": "20078",
                "servicio": "RT"
              },
              "ref": {
                "agendaId": "63346de6124243001255bc5f"
              }
            },
            {
              "fila": "Cajamarca",
              "campos": {
                "codigo": "20078",
                "servicio": "RE"
              },
              "ref": {
                "agendaId": "69827f5ab228b3256410391b"
              }
            },
            {
              "fila": "Pucallpa",
              "campos": {
                "codigo": "20086",
                "servicio": "RT"
              },
              "ref": {
                "agendaId": "63346d394f13cc0012bc1933"
              }
            },
            {
              "fila": "Pucallpa",
              "campos": {
                "codigo": "20086",
                "servicio": "RE"
              },
              "ref": {
                "agendaId": "6990ca2a80f47d3f926f0067"
              }
            },
            {
              "fila": "Cayma",
              "campos": {
                "codigo": "20049",
                "servicio": "RT"
              },
              "ref": {
                "agendaId": "632dd61f1f789900149906c1"
              }
            },
            {
              "fila": "Cayma",
              "campos": {
                "codigo": "20049",
                "servicio": "RE"
              },
              "ref": {
                "agendaId": "69827af99e95a7dd94630a2b"
              }
            },
            {
              "fila": "Juliaca",
              "campos": {
                "codigo": "20047",
                "servicio": "RT"
              },
              "ref": {
                "agendaId": "632cda73372ed30013268e68"
              }
            },
            {
              "fila": "Juliaca",
              "campos": {
                "codigo": "20047",
                "servicio": "RE"
              },
              "ref": {
                "agendaId": "69827d5fb228b32564102f64"
              }
            }
          ]
        }
      ]
    },
    {
      "clave": "sts_lima",
      "filas": [
        {
          "nombre": "San Borja"
        },
        {
          "nombre": "Puruchuco"
        },
        {
          "nombre": "Jockey Plaza"
        },
        {
          "nombre": "Salaverry"
        },
        {
          "nombre": "Breña"
        },
        {
          "nombre": "Miraflores"
        },
        {
          "nombre": "Primavera"
        },
        {
          "nombre": "Ripley Callao"
        },
        {
          "nombre": "Ripley SJL"
        },
        {
          "nombre": "Comas"
        },
        {
          "nombre": "San Isidro"
        },
        {
          "nombre": "San Miguel"
        },
        {
          "nombre": "Atocongo"
        },
        {
          "nombre": "Chorrillos"
        },
        {
          "nombre": "Plaza Lima Norte"
        },
        {
          "nombre": "Santa Anita"
        },
        {
          "nombre": "Los Olivos"
        }
      ],
      "bloques": [
        {
          "tipo": "simulacion",
          "nota": "SE: se prueba con una tienda; si no da fecha, no se piden las demás",
          "items": [
            {
              "fila": "Breña",
              "campos": {
                "servicio": "SE",
                "metodo": "RT",
                "operador": "20048",
                "almacen": "20026",
                "sku": "2025364075592",
                "canal": "TVI"
              },
              "ref": {
                "comunaId": "5d2f8c2f40ae9d7f94e5b25a",
                "ubigeo": "150101"
              }
            },
            {
              "fila": "Miraflores",
              "campos": {
                "servicio": "SE",
                "metodo": "RT",
                "operador": "20030",
                "almacen": "20026",
                "sku": "2025364075592",
                "canal": "TVI"
              },
              "ref": {
                "comunaId": "5d2f8c2f40ae9d7f94e5b26d",
                "ubigeo": "150120"
              }
            },
            {
              "fila": "Primavera",
              "campos": {
                "servicio": "SE",
                "metodo": "RT",
                "operador": "20023",
                "almacen": "20026",
                "sku": "2025364075592",
                "canal": "TVI"
              },
              "ref": {
                "comunaId": "5d2f8c2f40ae9d7f94e5b268",
                "ubigeo": "150115"
              }
            },
            {
              "fila": "Ripley SJL",
              "campos": {
                "servicio": "SE",
                "metodo": "RT",
                "operador": "20057",
                "almacen": "20026",
                "sku": "2025364075592",
                "canal": "TVI"
              },
              "ref": {
                "comunaId": "5d2f8c2f40ae9d7f94e5b272",
                "ubigeo": "150125"
              }
            },
            {
              "fila": "Comas",
              "campos": {
                "servicio": "SE",
                "metodo": "RT",
                "operador": "20089",
                "almacen": "20026",
                "sku": "2025364075592",
                "canal": "TVI"
              },
              "ref": {
                "comunaId": "5d2f8c2f40ae9d7f94e5b270",
                "ubigeo": "150123"
              }
            },
            {
              "fila": "San Isidro",
              "campos": {
                "servicio": "SE",
                "metodo": "RT",
                "operador": "20027",
                "almacen": "20026",
                "sku": "2025364075592",
                "canal": "TVI"
              },
              "ref": {
                "comunaId": "5d2f8c2f40ae9d7f94e5b25a",
                "ubigeo": "150101"
              }
            },
            {
              "fila": "San Miguel",
              "campos": {
                "servicio": "SE",
                "metodo": "RT",
                "operador": "20028",
                "almacen": "20026",
                "sku": "2025364075592",
                "canal": "TVI"
              },
              "ref": {
                "comunaId": "5d2f8c2f40ae9d7f94e5b26c",
                "ubigeo": "150119"
              }
            },
            {
              "fila": "Atocongo",
              "campos": {
                "servicio": "SE",
                "metodo": "RT",
                "operador": "20058",
                "almacen": "20026",
                "sku": "2025364075592",
                "canal": "TVI"
              },
              "ref": {
                "comunaId": "5d2f8c2f40ae9d7f94e5b26e",
                "ubigeo": "150121"
              }
            },
            {
              "fila": "Chorrillos",
              "campos": {
                "servicio": "SE",
                "metodo": "RT",
                "operador": "20021",
                "almacen": "20026",
                "sku": "2025364075592",
                "canal": "TVI"
              },
              "ref": {
                "comunaId": "5d2f8c2f40ae9d7f94e5b272",
                "ubigeo": "150125"
              }
            },
            {
              "fila": "Plaza Lima Norte",
              "campos": {
                "servicio": "SE",
                "metodo": "RT",
                "operador": "20066",
                "almacen": "20026",
                "sku": "2025364075592",
                "canal": "TVI"
              },
              "ref": {
                "comunaId": "5d2f8c2f40ae9d7f94e5b26f",
                "ubigeo": "150122"
              }
            },
            {
              "fila": "Santa Anita",
              "campos": {
                "servicio": "SE",
                "metodo": "RT",
                "operador": "20073",
                "almacen": "20026",
                "sku": "2025364075592",
                "canal": "TVI"
              },
              "ref": {
                "comunaId": "5d2f8c2f40ae9d7f94e5b270",
                "ubigeo": "150123"
              }
            }
          ],
          "muestra": true
        },
        {
          "tipo": "simulacion",
          "nota": "ST",
          "items": [
            {
              "fila": "San Borja",
              "campos": {
                "servicio": "ST",
                "metodo": "RT",
                "operador": "20074",
                "almacen": "20026",
                "sku": "2025364075592",
                "canal": "TVI"
              },
              "ref": {
                "comunaId": "5d2f8c2f40ae9d7f94e5b271",
                "ubigeo": "150124"
              }
            },
            {
              "fila": "Puruchuco",
              "campos": {
                "servicio": "ST",
                "metodo": "RT",
                "operador": "20095",
                "almacen": "20026",
                "sku": "2025364075592",
                "canal": "TVI"
              },
              "ref": {
                "comunaId": "5d2f8c2f40ae9d7f94e5b277",
                "ubigeo": "150130"
              }
            },
            {
              "fila": "Jockey Plaza",
              "campos": {
                "servicio": "ST",
                "metodo": "RT",
                "operador": "20025",
                "almacen": "20026",
                "sku": "2025364075592",
                "canal": "TVI"
              },
              "ref": {
                "comunaId": "5d2f8c2f40ae9d7f94e5b26a",
                "ubigeo": "150117"
              }
            },
            {
              "fila": "Salaverry",
              "campos": {
                "servicio": "ST",
                "metodo": "RT",
                "operador": "20079",
                "almacen": "20026",
                "sku": "2025364075592",
                "canal": "TVI"
              },
              "ref": {
                "comunaId": "5d2f8c2f40ae9d7f94e5b270",
                "ubigeo": "150123"
              }
            },
            {
              "fila": "Breña",
              "campos": {
                "servicio": "ST",
                "metodo": "RT",
                "operador": "20048",
                "almacen": "20026",
                "sku": "2025364075592",
                "canal": "TVI"
              },
              "ref": {
                "comunaId": "5d2f8c2f40ae9d7f94e5b25a",
                "ubigeo": "150101"
              }
            },
            {
              "fila": "Miraflores",
              "campos": {
                "servicio": "ST",
                "metodo": "RT",
                "operador": "20030",
                "almacen": "20026",
                "sku": "2025364075592",
                "canal": "TVI"
              },
              "ref": {
                "comunaId": "5d2f8c2f40ae9d7f94e5b26d",
                "ubigeo": "150120"
              }
            },
            {
              "fila": "Primavera",
              "campos": {
                "servicio": "ST",
                "metodo": "RT",
                "operador": "20023",
                "almacen": "20026",
                "sku": "2025364075592",
                "canal": "TVI"
              },
              "ref": {
                "comunaId": "5d2f8c2f40ae9d7f94e5b268",
                "ubigeo": "150115"
              }
            },
            {
              "fila": "Ripley Callao",
              "campos": {
                "servicio": "ST",
                "metodo": "RT",
                "operador": "20043",
                "almacen": "20026",
                "sku": "2025364075592",
                "canal": "TVI"
              },
              "ref": {
                "comunaId": "5d2f8c2640ae9d7f94e5b01a",
                "ubigeo": "070101"
              }
            },
            {
              "fila": "Ripley SJL",
              "campos": {
                "servicio": "ST",
                "metodo": "RT",
                "operador": "20057",
                "almacen": "20026",
                "sku": "2025364075592",
                "canal": "TVI"
              },
              "ref": {
                "comunaId": "5d2f8c2f40ae9d7f94e5b272",
                "ubigeo": "150125"
              }
            },
            {
              "fila": "Comas",
              "campos": {
                "servicio": "ST",
                "metodo": "RT",
                "operador": "20089",
                "almacen": "20026",
                "sku": "2025364075592",
                "canal": "TVI"
              },
              "ref": {
                "comunaId": "5d2f8c2f40ae9d7f94e5b25d",
                "ubigeo": "150104"
              }
            },
            {
              "fila": "San Isidro",
              "campos": {
                "servicio": "ST",
                "metodo": "RT",
                "operador": "20027",
                "almacen": "20026",
                "sku": "2025364075592",
                "canal": "TVI"
              },
              "ref": {
                "comunaId": "5d2f8c2f40ae9d7f94e5b26b",
                "ubigeo": "150118"
              }
            },
            {
              "fila": "San Miguel",
              "campos": {
                "servicio": "ST",
                "metodo": "RT",
                "operador": "20028",
                "almacen": "20026",
                "sku": "2025364075592",
                "canal": "TVI"
              },
              "ref": {
                "comunaId": "5d2f8c2f40ae9d7f94e5b26c",
                "ubigeo": "150119"
              }
            },
            {
              "fila": "Atocongo",
              "campos": {
                "servicio": "ST",
                "metodo": "RT",
                "operador": "20058",
                "almacen": "20026",
                "sku": "2025364075592",
                "canal": "TVI"
              },
              "ref": {
                "comunaId": "5d2f8c2f40ae9d7f94e5b26e",
                "ubigeo": "150121"
              }
            },
            {
              "fila": "Chorrillos",
              "campos": {
                "servicio": "ST",
                "metodo": "RT",
                "operador": "20021",
                "almacen": "20026",
                "sku": "2025364075592",
                "canal": "TVI"
              },
              "ref": {
                "comunaId": "5d2f8c2f40ae9d7f94e5b267",
                "ubigeo": "150114"
              }
            },
            {
              "fila": "Plaza Lima Norte",
              "campos": {
                "servicio": "ST",
                "metodo": "RT",
                "operador": "20066",
                "almacen": "20026",
                "sku": "2025364075592",
                "canal": "TVI"
              },
              "ref": {
                "comunaId": "5d2f8c2f40ae9d7f94e5b26f",
                "ubigeo": "150122"
              }
            },
            {
              "fila": "Santa Anita",
              "campos": {
                "servicio": "ST",
                "metodo": "RT",
                "operador": "20073",
                "almacen": "20026",
                "sku": "2025364075592",
                "canal": "TVI"
              },
              "ref": {
                "comunaId": "5d2f8c2f40ae9d7f94e5b270",
                "ubigeo": "150123"
              }
            },
            {
              "fila": "Los Olivos",
              "campos": {
                "servicio": "ST",
                "metodo": "RT",
                "operador": "20024",
                "almacen": "20026",
                "sku": "2025364075592",
                "canal": "TVI"
              },
              "ref": {
                "comunaId": "5d2f8c2f40ae9d7f94e5b269",
                "ubigeo": "150116"
              }
            }
          ]
        },
        {
          "tipo": "recepcion",
          "nota": "Recepción ST/SE de cada tienda",
          "items": [
            {
              "fila": "San Borja",
              "campos": {
                "codigo": "20074",
                "servicio": "ST"
              },
              "ref": {
                "agendaId": "65cb7a2878d1046fec083587"
              }
            },
            {
              "fila": "Puruchuco",
              "campos": {
                "codigo": "20095",
                "servicio": "ST"
              },
              "ref": {
                "agendaId": "65cba595b3f4c4d3f8bffa21"
              }
            },
            {
              "fila": "Jockey Plaza",
              "campos": {
                "codigo": "20025",
                "servicio": "ST"
              },
              "ref": {
                "agendaId": "65cbaaf7b3142e74dbf7c3d1"
              }
            },
            {
              "fila": "Salaverry",
              "campos": {
                "codigo": "20079",
                "servicio": "ST"
              },
              "ref": {
                "agendaId": "65cb7e35b9d12c7f8a668325"
              }
            },
            {
              "fila": "Breña",
              "campos": {
                "codigo": "20048",
                "servicio": "ST"
              },
              "ref": {
                "agendaId": "65cbf06578d1046fec0882c3"
              }
            },
            {
              "fila": "Breña",
              "campos": {
                "codigo": "20048",
                "servicio": "SE"
              },
              "ref": {
                "agendaId": "69b8102c1dab04e027f54562"
              }
            },
            {
              "fila": "Miraflores",
              "campos": {
                "codigo": "20030",
                "servicio": "ST"
              },
              "ref": {
                "agendaId": "65cbe8afceddc7321f87a3a1"
              }
            },
            {
              "fila": "Miraflores",
              "campos": {
                "codigo": "20030",
                "servicio": "SE"
              },
              "ref": {
                "agendaId": "69dab67cf662663a01af2f6b"
              }
            },
            {
              "fila": "Primavera",
              "campos": {
                "codigo": "20023",
                "servicio": "ST"
              },
              "ref": {
                "agendaId": "65c27cf1b9d12c7f8a621de2"
              }
            },
            {
              "fila": "Primavera",
              "campos": {
                "codigo": "20023",
                "servicio": "SE"
              },
              "ref": {
                "agendaId": "69daba528cc50b972e3d595d"
              }
            },
            {
              "fila": "Ripley Callao",
              "campos": {
                "codigo": "20043",
                "servicio": "ST"
              },
              "ref": {
                "agendaId": "65ca7893b9d12c7f8a66675a"
              }
            },
            {
              "fila": "Ripley SJL",
              "campos": {
                "codigo": "20057",
                "servicio": "ST"
              },
              "ref": {
                "agendaId": "65cb914178d1046fec0849a1"
              }
            },
            {
              "fila": "Ripley SJL",
              "campos": {
                "codigo": "20057",
                "servicio": "SE"
              },
              "ref": {
                "agendaId": "69daa6eaf662663a01af28a2"
              }
            },
            {
              "fila": "Comas",
              "campos": {
                "codigo": "20089",
                "servicio": "ST"
              },
              "ref": {
                "agendaId": "65cb886db9d12c7f8a6687c3"
              }
            },
            {
              "fila": "Comas",
              "campos": {
                "codigo": "20089",
                "servicio": "SE"
              },
              "ref": {
                "agendaId": "6329d6a8bc1326001259571b"
              }
            },
            {
              "fila": "San Isidro",
              "campos": {
                "codigo": "20027",
                "servicio": "ST"
              },
              "ref": {
                "agendaId": "65cbdf8bb9d12c7f8a669406"
              }
            },
            {
              "fila": "San Isidro",
              "campos": {
                "codigo": "20027",
                "servicio": "SE"
              },
              "ref": {
                "agendaId": "63210cd6af3b27001255a6f4"
              }
            },
            {
              "fila": "San Miguel",
              "campos": {
                "codigo": "20028",
                "servicio": "ST"
              },
              "ref": {
                "agendaId": "65cbe5f978d1046fec087f20"
              }
            },
            {
              "fila": "San Miguel",
              "campos": {
                "codigo": "20028",
                "servicio": "SE"
              },
              "ref": {
                "agendaId": "69a8b5b8c04a1f469f98dfb2"
              }
            },
            {
              "fila": "Atocongo",
              "campos": {
                "codigo": "20058",
                "servicio": "ST"
              },
              "ref": {
                "agendaId": "65cac1f1b3f4c4d3f8bfd88b"
              }
            },
            {
              "fila": "Atocongo",
              "campos": {
                "codigo": "20058",
                "servicio": "SE"
              },
              "ref": {
                "agendaId": "6915e7b89b03587048d39039"
              }
            },
            {
              "fila": "Chorrillos",
              "campos": {
                "codigo": "20021",
                "servicio": "ST"
              },
              "ref": {
                "agendaId": "65c2567db3142e74dbf30225"
              }
            },
            {
              "fila": "Chorrillos",
              "campos": {
                "codigo": "20021",
                "servicio": "SE"
              },
              "ref": {
                "agendaId": "6328cdfb8e6d030012418a23"
              }
            },
            {
              "fila": "Plaza Lima Norte",
              "campos": {
                "codigo": "20066",
                "servicio": "ST"
              },
              "ref": {
                "agendaId": "65cad29a78d1046fec081dd5"
              }
            },
            {
              "fila": "Plaza Lima Norte",
              "campos": {
                "codigo": "20066",
                "servicio": "SE"
              },
              "ref": {
                "agendaId": "69dab091f662663a01af2c2f"
              }
            },
            {
              "fila": "Santa Anita",
              "campos": {
                "codigo": "20073",
                "servicio": "ST"
              },
              "ref": {
                "agendaId": "65cad9a3b3142e74dbf7abea"
              }
            },
            {
              "fila": "Santa Anita",
              "campos": {
                "codigo": "20073",
                "servicio": "SE"
              },
              "ref": {
                "agendaId": "69b807c7b09c5b48e06f4ad8"
              }
            },
            {
              "fila": "Los Olivos",
              "campos": {
                "codigo": "20024",
                "servicio": "ST"
              },
              "ref": {
                "agendaId": "65ca5afaa3cf3c40ce4c3bcc"
              }
            }
          ]
        }
      ]
    },
    {
      "clave": "sts_provincia",
      "filas": [
        {
          "nombre": "Arequipa"
        },
        {
          "nombre": "Ica"
        },
        {
          "nombre": "Iquitos"
        },
        {
          "nombre": "Cayma"
        },
        {
          "nombre": "Juliaca"
        },
        {
          "nombre": "Chimbote"
        },
        {
          "nombre": "Cajamarca"
        },
        {
          "nombre": "Piura II"
        },
        {
          "nombre": "Pucallpa"
        },
        {
          "nombre": "Chiclayo II"
        },
        {
          "nombre": "Chiclayo"
        },
        {
          "nombre": "Huancayo"
        },
        {
          "nombre": "Trujillo"
        }
      ],
      "bloques": [
        {
          "tipo": "simulacion",
          "nota": "ST",
          "items": [
            {
              "fila": "Arequipa",
              "campos": {
                "servicio": "ST",
                "metodo": "RT",
                "operador": "20062",
                "almacen": "20026",
                "sku": "2025364075592",
                "canal": "TVI"
              },
              "ref": {
                "comunaId": "5d2f8c2140ae9d7f94e5aeb9",
                "ubigeo": "040101"
              }
            },
            {
              "fila": "Ica",
              "campos": {
                "servicio": "ST",
                "metodo": "RT",
                "operador": "20080",
                "almacen": "20026",
                "sku": "2025364075592",
                "canal": "TVI"
              },
              "ref": {
                "comunaId": "5d2f8c2b40ae9d7f94e5b13b",
                "ubigeo": "110101"
              }
            },
            {
              "fila": "Iquitos",
              "campos": {
                "servicio": "ST",
                "metodo": "RT",
                "operador": "20056",
                "almacen": "20026",
                "sku": "2025364075592",
                "canal": "TVI"
              },
              "ref": {
                "comunaId": "5d2f8c3140ae9d7f94e5b305",
                "ubigeo": "160101"
              }
            },
            {
              "fila": "Cayma",
              "campos": {
                "servicio": "ST",
                "metodo": "RT",
                "operador": "20049",
                "almacen": "20026",
                "sku": "2025364075592",
                "canal": "TVI"
              },
              "ref": {
                "comunaId": "5d2f8c2140ae9d7f94e5aeba",
                "ubigeo": "040102"
              }
            },
            {
              "fila": "Juliaca",
              "campos": {
                "servicio": "ST",
                "metodo": "RT",
                "operador": "20047",
                "almacen": "20026",
                "sku": "2025364075592",
                "canal": "TVI"
              },
              "ref": {
                "comunaId": "5d2f8c3540ae9d7f94e5b40f",
                "ubigeo": "211101"
              }
            },
            {
              "fila": "Chimbote",
              "campos": {
                "servicio": "ST",
                "metodo": "RT",
                "operador": "20069",
                "almacen": "20026",
                "sku": "2025364075592",
                "canal": "TVI"
              },
              "ref": {
                "comunaId": "5d2f8c1d40ae9d7f94e5adc3",
                "ubigeo": "020101"
              }
            },
            {
              "fila": "Cajamarca",
              "campos": {
                "servicio": "ST",
                "metodo": "RT",
                "operador": "20078",
                "almacen": "20026",
                "sku": "2025364075592",
                "canal": "TVI"
              },
              "ref": {
                "comunaId": "5d2f8c2440ae9d7f94e5af9b",
                "ubigeo": "060101"
              }
            },
            {
              "fila": "Piura II",
              "campos": {
                "servicio": "ST",
                "metodo": "RT",
                "operador": "20077",
                "almacen": "20026",
                "sku": "2025364075592",
                "canal": "TVI"
              },
              "ref": {
                "comunaId": "5d2f8c3340ae9d7f94e5b376",
                "ubigeo": "200101"
              }
            },
            {
              "fila": "Pucallpa",
              "campos": {
                "servicio": "ST",
                "metodo": "RT",
                "operador": "20086",
                "almacen": "20026",
                "sku": "2025364075592",
                "canal": "TVI"
              },
              "ref": {
                "comunaId": "6202ae28af2ff9145a5dcec4",
                "ubigeo": "250108"
              }
            },
            {
              "fila": "Chiclayo II",
              "campos": {
                "servicio": "ST",
                "metodo": "RT",
                "operador": "20088",
                "almacen": "20026",
                "sku": "2025364075592",
                "canal": "TVI"
              },
              "ref": {
                "comunaId": "5d2f8c2e40ae9d7f94e5b235",
                "ubigeo": "140102"
              }
            },
            {
              "fila": "Chiclayo",
              "campos": {
                "servicio": "ST",
                "metodo": "RT",
                "operador": "20041",
                "almacen": "20026",
                "sku": "2025364075592",
                "canal": "TVI"
              },
              "ref": {
                "comunaId": "5d2f8c2e40ae9d7f94e5b234",
                "ubigeo": "140101"
              }
            },
            {
              "fila": "Huancayo",
              "campos": {
                "servicio": "ST",
                "metodo": "RT",
                "operador": "20072",
                "almacen": "20026",
                "sku": "2025364075592",
                "canal": "TVI"
              },
              "ref": {
                "comunaId": "5d2f8c2b40ae9d7f94e5b166",
                "ubigeo": "120101"
              }
            },
            {
              "fila": "Trujillo",
              "campos": {
                "servicio": "ST",
                "metodo": "RT",
                "operador": "20040",
                "almacen": "20026",
                "sku": "2025364075592",
                "canal": "TVI"
              },
              "ref": {
                "comunaId": "5d2f8c2d40ae9d7f94e5b1e1",
                "ubigeo": "130101"
              }
            }
          ]
        },
        {
          "tipo": "recepcion",
          "nota": "Recepción ST/SE de cada tienda",
          "items": [
            {
              "fila": "Arequipa",
              "campos": {
                "codigo": "20062",
                "servicio": "ST"
              },
              "ref": {
                "agendaId": "65ce3078b3142e74dbfbdd05"
              }
            },
            {
              "fila": "Ica",
              "campos": {
                "codigo": "20080",
                "servicio": "ST"
              },
              "ref": {
                "agendaId": "65cf755e1eae18c5180e573d"
              }
            },
            {
              "fila": "Iquitos",
              "campos": {
                "codigo": "20056",
                "servicio": "ST"
              },
              "ref": {
                "agendaId": "65cf7d289c27d989927de8bd"
              }
            },
            {
              "fila": "Cayma",
              "campos": {
                "codigo": "20049",
                "servicio": "ST"
              },
              "ref": {
                "agendaId": "65cf7a581eae18c5180e579b"
              }
            },
            {
              "fila": "Juliaca",
              "campos": {
                "codigo": "20047",
                "servicio": "ST"
              },
              "ref": {
                "agendaId": "65cf79889c27d989927de853"
              }
            },
            {
              "fila": "Chimbote",
              "campos": {
                "codigo": "20069",
                "servicio": "ST"
              },
              "ref": {
                "agendaId": "65cf7bd09c27d989927de8a6"
              }
            },
            {
              "fila": "Cajamarca",
              "campos": {
                "codigo": "20078",
                "servicio": "ST"
              },
              "ref": {
                "agendaId": "65cf7ee11eae18c5180e5804"
              }
            },
            {
              "fila": "Piura II",
              "campos": {
                "codigo": "20077",
                "servicio": "ST"
              },
              "ref": {
                "agendaId": "65cf6ed3f1a442701645872e"
              }
            },
            {
              "fila": "Pucallpa",
              "campos": {
                "codigo": "20086",
                "servicio": "ST"
              },
              "ref": {
                "agendaId": "65cf7fcc36e1e04840247cb4"
              }
            },
            {
              "fila": "Chiclayo II",
              "campos": {
                "codigo": "20088",
                "servicio": "ST"
              },
              "ref": {
                "agendaId": "65cf768836e1e04840247bf5"
              }
            },
            {
              "fila": "Chiclayo",
              "campos": {
                "codigo": "20041",
                "servicio": "ST"
              },
              "ref": {
                "agendaId": "65cf77831eae18c5180e575c"
              }
            },
            {
              "fila": "Huancayo",
              "campos": {
                "codigo": "20072",
                "servicio": "ST"
              },
              "ref": {
                "agendaId": "65ce35bcb3f4c4d3f8c034f4"
              }
            },
            {
              "fila": "Trujillo",
              "campos": {
                "codigo": "20040",
                "servicio": "ST"
              },
              "ref": {
                "agendaId": "65cd6718b3142e74dbfbd265"
              }
            }
          ]
        }
      ]
    },
    {
      "clave": "dd_troncal",
      "filas": [
        {
          "nombre": "BT. F.E. Trujillo"
        },
        {
          "nombre": "PQT. F.E. Piura"
        },
        {
          "nombre": "BT. F.E. Piura"
        },
        {
          "nombre": "PQT. F.E. Arequipa"
        },
        {
          "nombre": "PQT. F.E. Chimbote"
        },
        {
          "nombre": "BT. F.E. Arequipa"
        },
        {
          "nombre": "PQT. F.E. Huancayo"
        },
        {
          "nombre": "PQT. F.E. Trujillo"
        },
        {
          "nombre": "BT. F.E. Chiclayo"
        },
        {
          "nombre": "BT. F.E. Huancayo"
        },
        {
          "nombre": "PQT. F.E. Chiclayo"
        },
        {
          "nombre": "BT. F.E. Chimbote"
        },
        {
          "nombre": "BT. F.E. Ica"
        },
        {
          "nombre": "PQT. F.E. Ica"
        }
      ],
      "bloques": [
        {
          "tipo": "simulacion",
          "nota": "Primera fecha de despacho (S)",
          "items": [
            {
              "fila": "PQT. F.E. Arequipa",
              "campos": {
                "servicio": "S",
                "metodo": "DP",
                "operador": "1363",
                "almacen": "20026",
                "sku": "2025364075592",
                "canal": "TVI"
              },
              "ref": {
                "comunaId": "5d2f8c2140ae9d7f94e5aeb9",
                "ubigeo": "040101"
              }
            },
            {
              "fila": "BT. F.E. Arequipa",
              "campos": {
                "servicio": "S",
                "metodo": "DP",
                "operador": "1463",
                "almacen": "20096",
                "sku": "2003349815609",
                "canal": "TVI"
              },
              "ref": {
                "comunaId": "5d2f8c2140ae9d7f94e5aeb9",
                "ubigeo": "040101"
              }
            },
            {
              "fila": "PQT. F.E. Piura",
              "campos": {
                "servicio": "S",
                "metodo": "DP",
                "operador": "1365",
                "almacen": "20026",
                "sku": "2025364075592",
                "canal": "TVI"
              },
              "ref": {
                "comunaId": "5d2f8c3340ae9d7f94e5b376",
                "ubigeo": "200101"
              }
            },
            {
              "fila": "BT. F.E. Piura",
              "campos": {
                "servicio": "S",
                "metodo": "DP",
                "operador": "1465",
                "almacen": "20096",
                "sku": "2003349815609",
                "canal": "TVI"
              },
              "ref": {
                "comunaId": "5d2f8c3340ae9d7f94e5b376",
                "ubigeo": "200101"
              }
            },
            {
              "fila": "PQT. F.E. Chiclayo",
              "campos": {
                "servicio": "S",
                "metodo": "DP",
                "operador": "1342",
                "almacen": "20026",
                "sku": "2025364075592",
                "canal": "TVI"
              },
              "ref": {
                "comunaId": "5d2f8c2e40ae9d7f94e5b234",
                "ubigeo": "140101"
              }
            },
            {
              "fila": "BT. F.E. Chiclayo",
              "campos": {
                "servicio": "S",
                "metodo": "DP",
                "operador": "1442",
                "almacen": "20096",
                "sku": "2003349815609",
                "canal": "TVI"
              },
              "ref": {
                "comunaId": "5d2f8c2e40ae9d7f94e5b234",
                "ubigeo": "140101"
              }
            },
            {
              "fila": "PQT. F.E. Chimbote",
              "campos": {
                "servicio": "S",
                "metodo": "DP",
                "operador": "1370",
                "almacen": "20026",
                "sku": "2025364075592",
                "canal": "TVI"
              },
              "ref": {
                "comunaId": "5d2f8c1f40ae9d7f94e5ae4e",
                "ubigeo": "021801"
              }
            },
            {
              "fila": "BT. F.E. Chimbote",
              "campos": {
                "servicio": "S",
                "metodo": "DP",
                "operador": "1469",
                "almacen": "20096",
                "sku": "2003349815609",
                "canal": "TVI"
              },
              "ref": {
                "comunaId": "5d2f8c1f40ae9d7f94e5ae4e",
                "ubigeo": "021801"
              }
            },
            {
              "fila": "PQT. F.E. Ica",
              "campos": {
                "servicio": "S",
                "metodo": "DP",
                "operador": "1381",
                "almacen": "20026",
                "sku": "2025364075592",
                "canal": "TVI"
              },
              "ref": {
                "comunaId": "5d2f8c2b40ae9d7f94e5b13b",
                "ubigeo": "110101"
              }
            },
            {
              "fila": "BT. F.E. Ica",
              "campos": {
                "servicio": "S",
                "metodo": "DP",
                "operador": "1480",
                "almacen": "20096",
                "sku": "2003349815609",
                "canal": "TVI"
              },
              "ref": {
                "comunaId": "5d2f8c2b40ae9d7f94e5b13b",
                "ubigeo": "110101"
              }
            },
            {
              "fila": "PQT. F.E. Huancayo",
              "campos": {
                "servicio": "S",
                "metodo": "DP",
                "operador": "1373",
                "almacen": "20026",
                "sku": "2025364075592",
                "canal": "TVI"
              },
              "ref": {
                "comunaId": "5d2f8c2b40ae9d7f94e5b166",
                "ubigeo": "120101"
              }
            },
            {
              "fila": "BT. F.E. Huancayo",
              "campos": {
                "servicio": "S",
                "metodo": "DP",
                "operador": "1472",
                "almacen": "20096",
                "sku": "2003349815609",
                "canal": "TVI"
              },
              "ref": {
                "comunaId": "5d2f8c2b40ae9d7f94e5b166",
                "ubigeo": "120101"
              }
            },
            {
              "fila": "PQT. F.E. Trujillo",
              "campos": {
                "servicio": "S",
                "metodo": "DP",
                "operador": "1339",
                "almacen": "20026",
                "sku": "2025364075592",
                "canal": "TVI"
              },
              "ref": {
                "comunaId": "5d2f8c2d40ae9d7f94e5b1e1",
                "ubigeo": "130101"
              }
            },
            {
              "fila": "BT. F.E. Trujillo",
              "campos": {
                "servicio": "S",
                "metodo": "DP",
                "operador": "1439",
                "almacen": "20096",
                "sku": "2003349815609",
                "canal": "TVI"
              },
              "ref": {
                "comunaId": "5d2f8c2d40ae9d7f94e5b1e1",
                "ubigeo": "130101"
              }
            }
          ]
        },
        {
          "tipo": "despacho",
          "nota": "Agenda de despacho de cada zona",
          "items": [
            {
              "fila": "PQT. F.E. Arequipa",
              "campos": {
                "codigo": "1363",
                "zona": "Zona PQT F.E Arequipa"
              }
            },
            {
              "fila": "BT. F.E. Arequipa",
              "campos": {
                "codigo": "1463",
                "zona": "Zona 1463 - BT Arequipa"
              }
            },
            {
              "fila": "PQT. F.E. Piura",
              "campos": {
                "codigo": "1365",
                "zona": "Zona 1365 - F.E Courrier Piura"
              }
            },
            {
              "fila": "BT. F.E. Piura",
              "campos": {
                "codigo": "1465",
                "zona": "Zona 1465 - Suc Aldea 6 Piura"
              }
            },
            {
              "fila": "PQT. F.E. Chiclayo",
              "campos": {
                "codigo": "1342",
                "zona": "Zona 1342 - F.ECourrier Chiclayo"
              }
            },
            {
              "fila": "BT. F.E. Chiclayo",
              "campos": {
                "codigo": "1442",
                "zona": "Zona 1442 - Suc Aldea 6 Chiclayo"
              }
            },
            {
              "fila": "PQT. F.E. Chimbote",
              "campos": {
                "codigo": "1370",
                "zona": "Zona 1370 - F.E Courier Chimbote"
              }
            },
            {
              "fila": "BT. F.E. Chimbote",
              "campos": {
                "codigo": "1469",
                "zona": "Zona 1469 - Suc Aldea 6 Chimbote"
              }
            },
            {
              "fila": "PQT. F.E. Ica",
              "campos": {
                "codigo": "1381",
                "zona": "Zona 1381 - F.E Courrier Ica"
              }
            },
            {
              "fila": "BT. F.E. Ica",
              "campos": {
                "codigo": "1480",
                "zona": "Zona 1480 - Suc Aldea 6 Ica"
              }
            },
            {
              "fila": "PQT. F.E. Huancayo",
              "campos": {
                "codigo": "1373",
                "zona": "Zona 1373 - F.Ecourrier huancayo"
              }
            },
            {
              "fila": "BT. F.E. Huancayo",
              "campos": {
                "codigo": "1472",
                "zona": "Zona 1472 - Suc Aldea 6 Huancayo"
              }
            },
            {
              "fila": "PQT. F.E. Trujillo",
              "campos": {
                "codigo": "1339",
                "zona": "Zona 1339 - F.ECourrier Trujillo"
              }
            },
            {
              "fila": "BT. F.E. Trujillo",
              "campos": {
                "codigo": "1439",
                "zona": "Zona 1439 - Suc Aldea 6 Trujillo"
              }
            }
          ]
        }
      ]
    },
    {
      "clave": "retiro_cercano",
      "filas": [
        {
          "nombre": "CD VES"
        }
      ],
      "bloques": [
        {
          "tipo": "picking",
          "nota": "Picking RC del CD Villa El Salvador",
          "items": [
            {
              "fila": "CD VES",
              "campos": {
                "codigo": "20026",
                "servicio": "RC"
              },
              "ref": {
                "agendaId": "651b444be69aaf0012c044c6"
              }
            }
          ]
        }
      ]
    },
    {
      "clave": "se_express",
      "filas": [
        {
          "nombre": "CD PICK - SE"
        }
      ],
      "bloques": [
        {
          "tipo": "picking",
          "nota": "Picking SE del CD Villa El Salvador (solo de lunes a viernes)",
          "items": [
            {
              "fila": "CD PICK - SE",
              "campos": {
                "codigo": "20026",
                "servicio": "SE"
              },
              "ref": {
                "agendaId": "6915e6a3659a7b5cc3a12621"
              }
            }
          ]
        }
      ]
    }
  ]
};
