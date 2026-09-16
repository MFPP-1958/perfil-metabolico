import { describe, expect, it } from 'vitest';
import { VLAMAX_REFERENCE_BANDS, VLAMAX_BANDS_VERSION, bandFor, EVENT_PROFILE_LABELS } from './bands';

describe('bandas de referencia de VLa máx', () => {
  it('nombra la versión del conjunto', () => {
    expect(VLAMAX_BANDS_VERSION).toBe('vlamax-reference-bands@1.0.0');
  });

  it('acompaña cada banda de población y referencia con DOI', () => {
    for (const band of VLAMAX_REFERENCE_BANDS) {
      expect(band.population.length).toBeGreaterThan(10);
      expect(band.reference).toMatch(/doi/i);
      expect(band.lower).toBeGreaterThan(0);
      expect(band.upper).toBeGreaterThan(band.lower);
    }
  });

  it('no repite un perfil de prueba', () => {
    const profiles = VLAMAX_REFERENCE_BANDS.map((band) => band.profile);
    expect(new Set(profiles).size).toBe(profiles.length);
  });

  it('devuelve indefinido para un perfil sin banda sustentada', () => {
    const sinBanda = (['explosiva', 'rodador', 'escalador', 'fondo'] as const)
      .filter((profile) => !VLAMAX_REFERENCE_BANDS.some((band) => band.profile === profile));
    for (const profile of sinBanda) expect(bandFor(profile)).toBeUndefined();
  });

  it('etiqueta los cuatro perfiles de prueba en español', () => {
    expect(Object.keys(EVENT_PROFILE_LABELS).sort()).toEqual(['escalador', 'explosiva', 'fondo', 'rodador']);
  });
});
