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
  { path: '/potencia', label: 'Potencia y duración', shortLabel: 'Potencia', description: 'Curva observada, modelos, residuos y cobertura de esfuerzos.' },
  { path: '/durabilidad', label: 'Durabilidad', shortLabel: 'Durabilidad', description: 'Cambio del rendimiento después de acumular trabajo.' },
  { path: '/tests', label: 'Tests fisiológicos', shortLabel: 'Tests', description: 'Protocolos guiados y observaciones trazables.' },
  { path: '/sesiones', label: 'Sesiones', shortLabel: 'Sesiones', description: 'Comparación entre trabajo planificado y completado.' },
  { path: '/evolucion', label: 'Evolución', shortLabel: 'Evolución', description: 'Cambios compatibles con su error y protocolo.' },
  { path: '/informes', label: 'Informes', shortLabel: 'Informes', description: 'Versiones aprobadas para entrenador, ciclista y familia.' },
];
