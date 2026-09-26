// Configuración del marcador. Este es el único archivo del sitio que editas.
//
// Ojo: los PIN de Daniel, Kevin y Anddy NO van aquí. Viven en el servidor,
// dentro de apps-script/Code.gs. Aquí solo van los nombres, el PIN del admin
// y la dirección del script.

export const CONFIG = {
  // Dirección del despliegue de Apps Script. Termina en /exec.
  // Sin esto, el marcador no puede leer ni sumar puntos.
  apiUrl: "https://script.google.com/macros/s/AKfycbzcRor2NWCw-AAIJ14OgPAtDSL2xoOu1kIS5OjFNlCG14WbR_eH_9biZgw8dRs-pPLB3Q/exec",

  // Nombres para la pantalla de acceso. Los PIN se validan en el servidor.
  participants: [
    { id: "daniel", name: "Daniel" },
    { id: "kevin", name: "Kevin" },
    { id: "anddy", name: "Anddy" },
  ],

  // La amiga admin: entra al panel en modo solo lectura.
  viewer: {
    name: "Admin",
    pinHash: "9af15b336e6a9619928537df30b2e6a2376569fcf9d7e773eccede65606529a0", // 0000
  },
};
