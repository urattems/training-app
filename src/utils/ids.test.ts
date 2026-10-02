import { afterEach, describe, expect, it, vi } from 'vitest';
import { DomainError } from '../domain/errors';
import { technicalDetails, toDisplayError } from './errors';
import { createId, uuidFromBytes } from './ids';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const realCrypto = globalThis.crypto;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('createId', () => {
  it('utilise crypto.randomUUID quand il existe (contexte sécurisé)', () => {
    const randomUUID = vi.fn(() => '11111111-1111-4111-8111-111111111111' as const);
    expect(createId({ randomUUID, getRandomValues: realCrypto.getRandomValues.bind(realCrypto) })).toBe('11111111-1111-4111-8111-111111111111');
    expect(randomUUID).toHaveBeenCalledOnce();
  });

  it('sans randomUUID (HTTP sur IP locale) : repli sur getRandomValues, UUID v4 valides et uniques', () => {
    vi.stubGlobal('crypto', { getRandomValues: realCrypto.getRandomValues.bind(realCrypto) });
    expect('randomUUID' in globalThis.crypto).toBe(false);
    const ids = Array.from({ length: 2000 }, () => createId());
    for (const id of ids) expect(id).toMatch(UUID_V4);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('sans Web Crypto du tout : identifiant v4 quand même', () => {
    vi.stubGlobal('crypto', undefined);
    expect(createId()).toMatch(UUID_V4);
  });

  it('pose les bits de version et de variante', () => {
    expect(uuidFromBytes(new Uint8Array(16).fill(0xff))).toBe('ffffffff-ffff-4fff-bfff-ffffffffffff');
    expect(uuidFromBytes(new Uint8Array(16))).toBe('00000000-0000-4000-8000-000000000000');
  });
});

describe('Détails techniques des erreurs', () => {
  it('nom et message, cause comprise', () => {
    const error = new TypeError('crypto.randomUUID is not a function', { cause: new Error('origine') });
    expect(technicalDetails(error)).toEqual(['TypeError: crypto.randomUUID is not a function', 'cause — Error: origine']);
    expect(technicalDetails('texte brut')).toEqual(['texte brut']);
  });

  it('erreur métier → son message ; inattendue → message générique + détails', () => {
    expect(toDisplayError(new DomainError('Séance introuvable.'), 'générique')).toEqual({
      message: 'Séance introuvable.',
      details: ['DomainError: Séance introuvable.'],
    });
    expect(toDisplayError(new TypeError('boom'), 'générique')).toEqual({ message: 'générique', details: ['TypeError: boom'] });
  });
});
