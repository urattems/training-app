// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { App } from '../../app/App';
import { APP_VERSION } from '../../config';
import { resetDatabase } from '../../test/fixtures';

const pkg = JSON.parse(readFileSync(resolve(process.cwd(), 'package.json'), 'utf8')) as { version: string };
const lock = JSON.parse(readFileSync(resolve(process.cwd(), 'package-lock.json'), 'utf8')) as {
  version: string;
  packages: Record<string, { version?: string }>;
};

beforeEach(resetDatabase);
afterEach(cleanup);

describe('Version de l’app', () => {
  it('Paramètres affiche exactement la version de package.json', async () => {
    window.location.hash = '#/settings';
    render(<App />);
    const label = await screen.findByText('Version', { selector: 'dt' });
    expect(label.nextElementSibling).toHaveTextContent(new RegExp(`^${pkg.version.replace(/\./g, '\\.')}$`));
    expect(APP_VERSION).toBe(pkg.version);
  });

  it('package.json et package-lock.json sont alignés, en version sémantique', () => {
    expect(pkg.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(lock.version).toBe(pkg.version);
    expect(lock.packages['']?.version).toBe(pkg.version);
  });
});
