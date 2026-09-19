import type { ReactNode } from 'react';

export interface AppRoute {
  path: string;
  label: string;
  shortLabel: string;
  description: string;
  content?: ReactNode;
}

export const appRoutes: readonly AppRoute[] = [
  { path: '/', label: 'Mesa de análisis', shortLabel: 'Análisis', description: 'Estado fisiológico, calidad de datos y decisiones pendientes.' },
  { path: '/perfil', label: 'Perfil metabólico', shortLabel: 'Perfil', description: 'Lo que se sabía del ciclista en una fecha, con fuente y antigüedad.' },
  { path: '/datos', label: 'Datos y fuentes', shortLabel: 'Datos', description: 'Valores de Intervals.icu, WKO5 y tests, con su procedencia.' },
  { path: '/potencia', label: 'Potencia y duración', shortLabel: 'Potencia', description: 'Curva observada, modelos, residuos y cobertura de esfuerzos.' },
  { path: '/durabilidad', label: 'Durabilidad', shortLabel: 'Durabilidad', description: 'Cambio del rendimiento después de acumular trabajo.' },
  { path: '/tests', label: 'Tests fisiológicos', shortLabel: 'Tests', description: 'Protocolos guiados y observaciones trazables.' },
  { path: '/sesiones', label: 'Sesiones', shortLabel: 'Sesiones', description: 'Comparación entre trabajo planificado y completado.' },
];
