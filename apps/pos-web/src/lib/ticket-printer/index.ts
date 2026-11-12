/**
 * Impresión de tickets.
 *
 * Era un archivo de mil líneas con cinco cosas dentro: los tipos, los formateadores, el
 * ticket de venta, el informe Z y la comanda de cocina. Cada una se toca por motivos
 * distintos —un cambio en la comanda no debería obligar a abrir el archivo donde vive el
 * cierre de caja— así que ahora son cinco archivos y este índice, que mantiene intactos los
 * imports que ya existían.
 */

export * from './types';
export * from './format';
export * from './sale-ticket';
export * from './z-report';
export * from './kitchen-ticket';
