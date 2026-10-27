import { describe, expect, it } from 'vitest';
import type { Rollup } from 'vite';
import { dynamicMainPreloads } from './preload-dynamic-main.ts';

function chunk(
  fileName: string,
  opts: {
    imports?: string[];
    dynamicImports?: string[];
    facadeModuleId?: string;
    css?: string[];
  } = {},
): Rollup.OutputChunk {
  return {
    type: 'chunk',
    fileName,
    imports: opts.imports ?? [],
    dynamicImports: opts.dynamicImports ?? [],
    facadeModuleId: opts.facadeModuleId ?? null,
    viteMetadata: { importedCss: new Set(opts.css ?? []), importedAssets: new Set() },
  } as unknown as Rollup.OutputChunk;
}

function bundleOf(...chunks: Rollup.OutputChunk[]): Rollup.OutputBundle {
  return Object.fromEntries(chunks.map((c) => [c.fileName, c])) as Rollup.OutputBundle;
}

describe('dynamicMainPreloads', () => {
  it('共有の依存は 1 回だけ、importer より前に並ぶ', () => {
    const entry = chunk('index.js', { dynamicImports: ['main.js'] });
    const main = chunk('main.js', {
      facadeModuleId: '/repo/src/main.ts',
      imports: ['a.js', 'b.js'],
    });
    const a = chunk('a.js', { imports: ['shared.js'] });
    const b = chunk('b.js', { imports: ['shared.js'] });
    const shared = chunk('shared.js');
    const { js } = dynamicMainPreloads(bundleOf(entry, main, a, b, shared), entry, '/src/main.ts');
    expect(js).toEqual(['shared.js', 'a.js', 'b.js', 'main.js']);
  });

  it('エントリ自身とその静的な依存は除く', () => {
    const entry = chunk('index.js', { imports: ['helper.js'], dynamicImports: ['main.js'] });
    const helper = chunk('helper.js');
    const main = chunk('main.js', {
      facadeModuleId: '/repo/src/main.ts',
      imports: ['index.js', 'helper.js', 'dep.js'],
    });
    const dep = chunk('dep.js');
    const { js } = dynamicMainPreloads(bundleOf(entry, helper, main, dep), entry, '/src/main.ts');
    expect(js).toEqual(['dep.js', 'main.js']);
  });

  it('CSS は走査順で重複なく並ぶ', () => {
    const entry = chunk('index.js', { dynamicImports: ['main.js'] });
    const main = chunk('main.js', {
      facadeModuleId: '/repo/src/main.ts',
      imports: ['a.js', 'b.js'],
      css: ['main.css', 'a.css'],
    });
    const a = chunk('a.js', { css: ['a.css'] });
    const b = chunk('b.js', { css: ['b.css', 'a.css'] });
    const { css } = dynamicMainPreloads(bundleOf(entry, main, a, b), entry, '/src/main.ts');
    expect(css).toEqual(['a.css', 'b.css', 'main.css']);
  });

  it('エントリの静的な依存が持つ CSS は除く', () => {
    const entry = chunk('index.js', { imports: ['shared.js'], dynamicImports: ['main.js'] });
    const shared = chunk('shared.js', { css: ['shared.css'] });
    const main = chunk('main.js', {
      facadeModuleId: '/repo/src/main.ts',
      imports: ['shared.js', 'dep.js'],
      css: ['main.css'],
    });
    const dep = chunk('dep.js', { css: ['dep.css'] });
    const { css } = dynamicMainPreloads(bundleOf(entry, shared, main, dep), entry, '/src/main.ts');
    expect(css).toEqual(['dep.css', 'main.css']);
  });

  it('エントリ側のチャンクと同じ CSS ファイルは別チャンクが持っていても除く', () => {
    const entry = chunk('index.js', { imports: ['shared.js'], dynamicImports: ['main.js'] });
    const shared = chunk('shared.js', { css: ['common.css'] });
    const main = chunk('main.js', {
      facadeModuleId: '/repo/src/main.ts',
      imports: ['dep.js'],
      css: ['main.css'],
    });
    const dep = chunk('dep.js', { css: ['common.css', 'dep.css'] });
    const { css } = dynamicMainPreloads(bundleOf(entry, shared, main, dep), entry, '/src/main.ts');
    expect(css).toEqual(['dep.css', 'main.css']);
  });

  it('一致する動的 import が無ければ例外を投げる', () => {
    const entry = chunk('index.js', { dynamicImports: ['other.js'] });
    const other = chunk('other.js', { facadeModuleId: '/repo/src/other.ts' });
    expect(() => dynamicMainPreloads(bundleOf(entry, other), entry, '/src/main.ts')).toThrow();
  });
});
