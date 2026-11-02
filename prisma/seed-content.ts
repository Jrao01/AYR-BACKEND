// Contenido de arranque (bootstrap) para `npm run seed`.
// La fuente de verdad en runtime es la BD; en el frontend solo quedan tipos
// y constantes de UI (ver web/src/data/*).
//
// Origen: los archivos estáticos del sitio previos a la migración (F8).

export type Plan = {
  id: string;
  name: string;
  speed: number;
  price: number;
  segment: string;
  use: string;
  devices: string;
  group?: 'hogar' | 'avanzado' | 'empresarial';
};

/** Todos los planes son simétricos (misma velocidad de subida que de bajada) e incluyen IVA. */
export const plans: Plan[] = [
  // Grupo: Planes Hogar
  {
    id: 'hogar-1',
    name: 'Plan Hogar 1',
    speed: 150,
    price: 25,
    segment: 'Hogar',
    use: 'Navegación, streaming HD y videollamadas',
    devices: 'Hasta 6 dispositivos',
    group: 'hogar',
  },
  {
    id: 'hogar-2',
    name: 'Plan Hogar 2',
    speed: 200,
    price: 30,
    segment: 'Hogar',
    use: 'Streaming 4K, teletrabajo y clases en línea',
    devices: 'Hasta 8 dispositivos',
    group: 'hogar',
  },
  {
    id: 'hogar-3',
    name: 'Plan Hogar 3',
    speed: 300,
    price: 35,
    segment: 'Hogar',
    use: '4K, gaming casual y varias personas conectadas',
    devices: 'Hasta 10 dispositivos',
    group: 'hogar',
  },
  // Grupo: Planes Avanzados Hogar
  {
    id: 'avanzado-hogar',
    name: 'Plan Avanzado Hogar',
    speed: 500,
    price: 40,
    segment: 'Hogar Avanzado',
    use: '4K/UHD, gaming competitivo, teletrabajo intensivo',
    devices: 'Hasta 15 dispositivos',
    group: 'avanzado',
  },
  {
    id: 'avanzado-hogar-2',
    name: 'Plan Avanzado Hogar 2',
    speed: 700,
    price: 50,
    segment: 'Hogar Avanzado',
    use: 'Multistream 4K, gaming, servidor casero, domótica',
    devices: 'Hasta 20 dispositivos',
    group: 'avanzado',
  },
  {
    id: 'avanzado-hogar-full',
    name: 'Plan Avanzado Hogar Full',
    speed: 1000,
    price: 70,
    segment: 'Hogar Avanzado',
    use: 'Máximo rendimiento: 4K/8K, VR, backup en nube, todo a la vez',
    devices: 'Hasta 30+ dispositivos',
    group: 'avanzado',
  },
  // Grupo: Plan Empresarial Dedicado
  {
    id: 'empresarial-dedicado',
    name: 'Plan Empresarial Dedicado',
    speed: 0,
    price: 1,
    segment: 'Empresarial',
    use: 'Operación crítica, servidores, videovigilancia, respaldo garantizado',
    devices: 'Ilimitado (según necesidad)',
    group: 'empresarial',
  },
];

export const customPlanNote =
  'El plan empresarial dedicado se cotiza a $1/Mbps. Contacta para diseñar tu velocidad exacta.';

/** Planes agrupados para la sección de inicio (rotación) */
export const planGroups = {
  hogar: plans.filter((p) => p.group === 'hogar'),
  avanzado: plans.filter((p) => p.group === 'avanzado'),
  empresarial: plans.filter((p) => p.group === 'empresarial'),
};

export type Office = {
  id: string;
  municipality: string;
  state: string;
  address: string;
  reference: string;
  phone: string;
  /** Coordenadas confirmadas por el cliente para los marcadores del mapa. */
  coords: [number, number];
  image: string;
};

/** Punto futuro del mapa (type=future en la API): sin tarjeta, teléfono ni popup. */
export type FutureMarker = {
  coords: [number, number];
  label: string;
};

export const offices: Office[] = [
  {
    id: 'miranda',
    municipality: 'Miranda',
    state: 'Carabobo',
    address: 'Av. Bolívar, C.C. Girardot, Sector El Playón',
    reference: 'A una cuadra de la Gran Parada',
    phone: '0412-0189289',
    coords: [10.148869, -68.395657],
    image: '/imgs/miranda.jpg',
  },
  {
    id: 'bejuma',
    municipality: 'Bejuma',
    state: 'Carabobo',
    address: 'Av. Sucre, C.C. Páez, Centro Comercial Bolívar Plaza',
    reference: 'A 20 m de la Plaza Bolívar',
    phone: '0414-4292156',
    coords: [10.173806, -68.259983],
    image: '/imgs/bejuma.jpg',
  },
  {
    id: 'montalban',
    municipality: 'Montalbán',
    state: 'Carabobo',
    address: 'Calle Bolívar, Av. Miranda y Puerto Cabello, Sector Centro',
    reference: 'Centro de Montalbán',
    phone: '0424-4906175',
    coords: [10.213814, -68.326989],
    image: '/imgs/montalban.jpg',
  },
];

export const officeHours = [
  { days: 'Lunes a viernes', time: '8:00 am – 12:00 pm · 1:00 pm – 5:00 pm' },
  { days: 'Sábado', time: '8:00 am – 2:00 pm' },
];

/** Fallback del mapa cuando la API no responde (en la API es /locations?type=future). */
export const futureMarkers: FutureMarker[] = [
  { coords: [10.153012, -68.571615], label: 'Nirgua, Yaracuy' },
];

export type LegalSection = {
  id: string;
  title: string;
  paragraphs?: string[];
  list?: string[];
  note?: string;
};

/** Documento legal tal como lo devuelve GET /api/legal/:slug. */
export type LegalDocument = {
  slug: string;
  type?: string;
  title: string;
  version: number;
  lastModifiedAt: string | null;
  sections: LegalSection[];
};

export const terms: LegalSection[] = [
  {
    id: 'naturaleza-portal',
    title: 'Naturaleza del portal y aceptación',
    paragraphs: [
      'El acceso y uso de este sitio web atribuye la condición de Usuario e implica la aceptación plena de estos Términos y Condiciones.',
      'La información contenida en este portal —planes, tarifas, velocidades y cobertura— es de carácter informativo y publicitario. La contratación efectiva del servicio se rige exclusivamente por el contrato de servicio que el Suscriptor firma con la empresa, conforme al artículo 41 del Reglamento de Protección de los Derechos de los Usuarios y Usuarias en la Prestación de los Servicios de Telecomunicaciones (G.O. N.º 38.235).',
    ],
    note: 'Reglamento de Usuarios, artículo 41.',
  },
  {
    id: 'identificacion',
    title: 'Identificación del prestador',
    paragraphs: [
      'AYR NETWORK XV C.A., RIF J-505663380, prestador habilitado por la Comisión Nacional de Telecomunicaciones (CONATEL) mediante Providencia N.º HGST-00876.',
      'Domicilio fiscal: Av. Bolívar cruce con Girardot, Local N.º 02, Sector Centro, Miranda, estado Carabobo, Zona Postal 2041. Correo de contacto: ayrnetwork15@gmail.com. Oficinas de atención: Miranda (0412-0189289), Bejuma (0414-4292156) y Montalbán (0424-4906175).',
    ],
    note: 'Habilitación General N.º HGST-00876.',
  },
  {
    id: 'servicios',
    title: 'Servicios autorizados y tecnología',
    paragraphs: [
      'El prestador ofrece exclusivamente los servicios comprendidos en su habilitación: acceso a internet sobre fibra óptica hasta el hogar (FTTH) y transporte de datos, con velocidades simétricas en todos los planes: la tasa de subida es igual a la de bajada.',
      'Este sitio no ofrece ni ampara bajo esta habilitación otros servicios de telecomunicaciones, como telefonía fija o televisión por suscripción.',
    ],
    note: 'Servicios aprobados por CONATEL: FTTH hogar y transporte de datos.',
  },
  {
    id: 'contrato-adhesion',
    title: 'Contrato de Adhesión',
    paragraphs: [
      'En cumplimiento del artículo 41 del Reglamento de Usuarios, la contratación del servicio se formaliza en las oficinas de atención del prestador mediante un contrato de servicio que el Suscriptor recibe, lee y firma antes de la instalación, con tipografía legible.',
      'Las condiciones técnicas, económicas y de uso aplicables al abonado son las que constan en ese contrato; la información de este sitio tiene carácter referencial.',
    ],
  },
  {
    id: 'planes',
    title: 'Planes publicados y su vigencia',
    paragraphs: [
      'El catálogo de planes vigentes, con sus velocidades y precios, se publica en la sección “Planes y Cobertura” de este sitio. Todas las velocidades publicadas son simétricas —igual tasa de subida y de bajada— e incluyen el Impuesto al Valor Agregado (IVA).',
      'La instalación tiene un costo único que se informa al Suscriptor antes de la contratación. Los planes a medida se cotizan y formalizan en la oficina del municipio correspondiente.',
      'La publicación en este sitio no constituye una oferta contractual vinculante; las condiciones definitivas son las que constan en el contrato firmado por el Suscriptor.',
    ],
  },
  {
    id: 'tarifas',
    title: 'Transparencia tarifaria, moneda e IVA',
    paragraphs: [
      'Las tarifas publicadas en este sitio se expresan en dólares estadounidenses (USD) como valor de referencia e incluyen el IVA y las contribuciones de ley.',
      'El cobro efectivo al Suscriptor se realiza en bolívares, calculado a la tasa oficial publicada por el Banco Central de Venezuela (BCV) con valor a la fecha de facturación o de pago.',
      'Las tarifas podrán ajustarse previa notificación al Suscriptor y en el cumplimiento de lo exigido al regulador.',
    ],
    note: 'Normativa cambiaria y tributaria aplicable; transparencia tarifaria del Reglamento de Usuarios.',
  },
  {
    id: 'calidad-servicio',
    title: 'Calidad del servicio',
    paragraphs: [
      'El servicio se presta con una velocidad mínima garantizada del ochenta por ciento (80%) de la velocidad máxima contratada, conforme a los parámetros técnicos exigidos por CONATEL.',
      'Las condiciones ajenas a la red del prestador —la cobertura inalámbrica interna del inmueble, los equipos del Usuario o el comportamiento de servicios alojados por terceros— no afectan el compromiso de velocidad de la red de acceso.',
    ],
    note: 'Providencia CONATEL N.º 117 (parámetros mínimos de calidad).',
  },
  {
    id: 'reclamos',
    title: 'Atención de reclamos y ticket correlativo',
    paragraphs: [
      'Todo reclamo, avería o solicitud técnica presentada en las oficinas, por correo a ayrnetwork15@gmail.com o a través de los canales de atención publicados en la sección Contacto genera de forma inmediata un número de ticket correlativo, con indicación de fecha y hora de recepción.',
      'El registro del reporte se conserva por un período mínimo de seis (6) meses, disponible para consulta del abonado y para auditoría del ente regulador.',
      'Horarios de atención: lunes a viernes de 8:00 a 12:00 y de 13:00 a 17:00; sábados de 8:00 a 14:00.',
    ],
    note: 'Reglamento de Usuarios: mecanismos de atención de reclamos y registros.',
  },
  {
    id: 'equipos',
    title: 'Equipos terminales y homologación',
    paragraphs: [
      'Los equipos entregados para la prestación del servicio (ONT y/o módem-router) cuentan con su correspondiente Certificado de Homologación expedido por CONATEL.',
      'El régimen de los equipos —propiedad del Suscriptor o del prestador—, la garantía, las visitas técnicas y las condiciones de retiro o reposición se pactan por escrito en el contrato de servicio al momento de la contratación.',
    ],
    note: 'Homologación de equipos terminales conforme a la normativa de CONATEL.',
  },
  {
    id: 'uso-aceptable',
    title: 'Política de uso aceptable',
    paragraphs: [
      'Queda prohibido utilizar el servicio para: enviar spam o mensajes masivos no solicitados; publicar o distribuir contenido ilícito; realizar ataques, escaneos o intrusiones a sistemas de terceros; saturar la red con tráfico destinado a degradarla; suplantar identidades; revender o redistribuir el servicio sin autorización escrita; o cualquier actividad que vulnere la legislación venezolana.',
      'El incumplimiento faculta al prestador para suspender o dar por terminado el servicio, sin perjuicio de las acciones legales que correspondan. El detalle completo de las condiciones de uso rige en el contrato de servicio.',
    ],
  },
  {
    id: 'propiedad-intelectual',
    title: 'Propiedad intelectual',
    paragraphs: [
      'Todos los logotipos, marcas, textos y diseños gráficos presentes en este sitio son propiedad exclusiva de AYR NETWORK XV C.A. Queda prohibida su reproducción total o parcial sin autorización previa.',
      'El mapa interactivo y sus geodatos provienen de terceros (OpenStreetMap y Mapbox) bajo sus respectivas licencias de uso.',
    ],
  },
  {
    id: 'escalamiento-conatel',
    title: 'Derechos del usuario y escalamiento ante CONATEL',
    paragraphs: [
      'Agotada la vía de reclamo interno sin solución dentro de los lapsos previstos, el Usuario puede acudir ante la Comisión Nacional de Telecomunicaciones (CONATEL) en ejercicio de los derechos reconocidos por la Ley Orgánica de Telecomunicaciones y el Reglamento de Usuarios.',
      'Enlace oficial del ente regulador: https://www.conatel.gob.ve',
    ],
    note: 'LOTEL y Reglamento de Usuarios (G.O. N.º 38.235).',
  },
  {
    id: 'modificaciones',
    title: 'Modificaciones del portal y de estas condiciones',
    paragraphs: [
      'El prestador podrá actualizar estos Términos y Condiciones, el catálogo de planes y el contenido del sitio para adecuarlos a nuevas providencias o directivas de CONATEL y a cambios operativos.',
      'La versión vigente queda publicada en esta misma sección con su fecha de última modificación. Los cambios que afecten condiciones contractuales del abonado le serán notificados por los canales registrados.',
    ],
  },
  {
    id: 'ley-aplicable',
    title: 'Ley aplicable y solución de controversias',
    paragraphs: [
      'Estas condiciones se rigen por las leyes de la República Bolivariana de Venezuela: Constitución de la República (artículo 60), Ley Orgánica de Telecomunicaciones y su Reglamento, Reglamento de Usuarios (G.O. N.º 38.235), Providencias CONATEL N.º 1302 y N.º 117, Ley Especial contra los Delitos Informáticos, y las condiciones de la habilitación N.º HGST-00876.',
      'Las controversias se someten primero a los canales de atención del prestador y, en su defecto, a la jurisdicción competente del estado Carabobo.',
    ],
  },
];

export const privacy: LegalSection[] = [
  {
    id: 'responsable',
    title: 'Ente responsable y habilitación',
    paragraphs: [
      'El responsable del tratamiento de los datos personales recolectados a través de este sitio y con ocasión de la prestación del servicio es AYR NETWORK XV C.A., RIF J-505663380, con domicilio fiscal en Av. Bolívar cruce con Girardot, Local N.º 02, Sector Centro, Miranda, estado Carabobo, Zona Postal 2041, habilitada por CONATEL bajo la Providencia N.º HGST-00876.',
      'Correo para ejercer los derechos de protección de datos: ayrnetwork15@gmail.com, asunto “Protección de datos”.',
    ],
    note: 'Constitución de la República, artículo 60; LOTEL.',
  },
  {
    id: 'alcance',
    title: 'Alcance y aceptación',
    paragraphs: [
      'Esta política rige tanto la navegación por este sitio web como la relación comercial con el abonado.',
      'Al facilitar sus datos mediante el sitio o al contratar el servicio, el titular acepta el tratamiento aquí descrito. Si no está de acuerdo con esta política, debe abstenerse de enviar sus datos.',
    ],
  },
  {
    id: 'datos-recolectados',
    title: 'Datos recolectados y método de captura',
    paragraphs: [
      'El sitio web solo recaba los datos que el Usuario envía voluntariamente a través del contacto: nombre, teléfono, municipio y mensaje.',
      'Para la relación contractual, recolectados en las oficinas de atención:',
    ],
    list: [
      'Cédula de identidad o RIF del titular.',
      'Dirección física donde se instalará el servicio.',
      'Datos de facturación e historial de pagos.',
      'Registros de soporte técnico y reclamos, con su ticket correlativo.',
      'Registros de conexión y de tráfico asociados a la sesión del abonado, generados por el propio servicio de internet.',
    ],
    note: 'Los registros técnicos de la red se tratan bajo el secreto de las telecomunicaciones (LOTEL, artículo 8).',
  },
  {
    id: 'finalidad',
    title: 'Finalidad del tratamiento',
    list: [
      'Verificar la factibilidad técnica y tramitar la solicitud de contratación originada en el sitio.',
      'Prestar, administrar y mantener el servicio contratado.',
      'Gestionar la facturación, el cobro y la emisión de comprobantes fiscales.',
      'Canalizar averías, reclamos y soporte técnico mediante el sistema de tickets.',
      'Enviar notificaciones operativas por correo o WhatsApp: mantenimientos programados, cortes de servicio y avisos de mora.',
      'Remitir información comercial, únicamente con el consentimiento expreso del titular.',
      'Cumplir obligaciones legales frente al regulador y las autoridades competentes.',
    ],
  },
  {
    id: 'confidencialidad',
    title: 'Confidencialidad y requerimientos de autoridad',
    paragraphs: [
      'AYR NETWORK XV C.A. no vende, cede ni comparte los datos personales de sus usuarios con terceros con fines publicitarios o comerciales.',
      'Los datos personales y los registros de tráfico solo se divulgan o entregan mediante orden previa, formal y motivada de un tribunal competente u órgano de investigación penal de la República Bolivariana de Venezuela, en cumplimiento del secreto de las telecomunicaciones previsto en la Ley Orgánica de Telecomunicaciones, la Ley Especial contra los Delitos Informáticos y el artículo 60 de la Constitución.',
    ],
    note: 'LOTEL, artículo 8; Ley Especial contra los Delitos Informáticos.',
  },
  {
    id: 'cookies',
    title: 'Cookies y almacenamiento local',
    paragraphs: [
      'Este sitio no utiliza cookies publicitarias, de perfilado ni de analítica de terceros, y no opera portales de autogestión con sesiones persistentes.',
      'Componentes embebidos de terceros, como el mapa interactivo, pueden emplear almacenamiento técnico local del navegador para caché de recursos. Si en el futuro se incorporan cookies no técnicas (analítica o portal de pagos), esta política se actualizará e informará antes de su uso.',
    ],
  },
  {
    id: 'terceros',
    title: 'Compartición operativa con terceros',
    paragraphs: [
      'Los datos solo se comunican a proveedores que apoyan la operación —conectividad principal y herramientas de gestión de tickets—, bajo deber de confidencialidad y en la medida necesaria para prestar el servicio. También pueden comunicarse por obligación legal, requerimiento de autoridad competente o mandato judicial.',
      'No se realizan transferencias internacionales de datos con fines de tratamiento; la circulación del tráfico de internet por rutas de interconexión no implica cesión de datos de identificación.',
    ],
  },
  {
    id: 'seguridad',
    title: 'Seguridad de la información',
    paragraphs: [
      'La empresa aplica medidas técnicas y organizativas razonables: control de acceso a la base de datos de gestión, respaldos periódicos, credenciales protegidas y restricción del personal a los datos necesarios para su función.',
      'Ningún sistema es completamente seguro: el Usuario debe custodiar sus credenciales de acceso y notificar de inmediato cualquier uso no autorizado.',
    ],
  },
  {
    id: 'conservacion',
    title: 'Plazo de conservación',
    paragraphs: [
      'Los datos se conservan mientras dure la relación contractual y, después, durante los lapsos que exigen las normativas tributaria y de telecomunicaciones, incluido el registro de tickets por un mínimo de seis (6) meses y los plazos de conservación de registros de tráfico previstos en la ley.',
      'Vencidos dichos lapsos, la información se elimina o se anonimiza de forma segura.',
    ],
  },
  {
    id: 'derechos',
    title: 'Derechos del titular',
    paragraphs: [
      'El titular puede solicitar el acceso, la rectificación, la actualización, la supresión, la oposición al tratamiento y la revocación del consentimiento, escribiendo al correo indicado en la sección 1 con asunto “Protección de datos”.',
      'La respuesta se emite dentro de los lapsos legalmente previstos. Si el titular considera que sus derechos no fueron atendidos, puede presentar reclamo ante CONATEL (https://www.conatel.gob.ve), sin perjuicio de la vía judicial.',
      'Al finalizar la relación contractual, la supresión de los datos de la base comercial se tramita a solicitud del titular, salvo aquellos cuya conservación impone la ley.',
    ],
  },
  {
    id: 'menores',
    title: 'Menores de edad',
    paragraphs: [
      'El servicio se contrata por personas mayores de edad con capacidad legal. La información de menores se trata únicamente cuando resulta necesaria para la prestación del servicio y con autorización de su representante legal. Este sitio no recaba intencionalmente datos de menores.',
    ],
  },
  {
    id: 'base-legal',
    title: 'Base legal y actualizaciones',
    paragraphs: [
      'El tratamiento se sustenta en el consentimiento del titular, en la ejecución del contrato de servicio y en el cumplimiento de obligaciones legales, conforme a la Constitución de la República (artículo 60), la Ley Orgánica de Telecomunicaciones y su Reglamento, el Reglamento de Usuarios (G.O. N.º 38.235), las Providencias CONATEL aplicables y la Ley Especial contra los Delitos Informáticos.',
      'Esta política puede actualizarse por cambios normativos u operativos; la versión vigente se publica en esta página con su fecha de última modificación.',
    ],
  },
  {
    id: 'contacto',
    title: 'Cómo contactarnos',
    paragraphs: [
      'Correo: ayrnetwork15@gmail.com (asunto “Protección de datos”). Oficinas de atención: Miranda (0412-0189289), Bejuma (0414-4292156) y Montalbán (0424-4906175), estado Carabobo, en los horarios publicados en la sección Contacto. Domicilio fiscal: Av. Bolívar cruce con Girardot, Local N.º 02, Sector Centro, Miranda, Carabobo, Zona Postal 2041.',
    ],
  },
];

export const legalNotice =
  'Este documento tiene carácter informativo y refleja la estructura y las buenas prácticas observadas en el sector. No constituye asesoría legal. La versión final de los Términos y Condiciones y del Aviso de Privacidad debe ser revisada y validada conforme a la Ley Orgánica de Telecomunicaciones, su Reglamento, la Ley Especial contra los Delitos Informáticos y las condiciones de la habilitación N.º HGST-00876 otorgada por CONATEL.';
