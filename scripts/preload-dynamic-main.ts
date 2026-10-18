import type { HtmlTagDescriptor, Plugin, Rollup } from 'vite';

type Bundle = Rollup.OutputBundle;
type Chunk = Rollup.OutputChunk;

export interface DynamicMainPreloads {
  js: string[];
  css: string[];
}

export function dynamicMainPreloads(
  bundle: Bundle,
  entry: Chunk,
  facadeSuffix: string,
): DynamicMainPreloads {
  const chunkOf = (file: string): Chunk | undefined => {
    const item = bundle[file];
    return item && item.type === 'chunk' ? item : undefined;
  };
  const mainFile = entry.dynamicImports.find((file) =>
    chunkOf(file)?.facadeModuleId?.endsWith(facadeSuffix),
  );
  if (!mainFile) {
    throw new Error(`エントリの動的 import に ${facadeSuffix} のチャンクが無い`);
  }
  // Vite の getImportedChunks と同じ順序（依存を先に、各ファイル 1 回）
  const walk = (file: string, seen: Set<string>): string[] => {
    const out: string[] = [];
    for (const dep of chunkOf(file)?.imports ?? []) {
      if (!seen.has(dep)) {
        seen.add(dep);
        out.push(...walk(dep, seen), dep);
      }
    }
    return out;
  };
  const staticOfEntry = new Set([entry.fileName, ...walk(entry.fileName, new Set())]);
  const files = [...walk(mainFile, new Set()), mainFile];
  const js = files.filter((file) => !staticOfEntry.has(file));
  // Vite がエントリの CSS を自前で出すので、CSS はチャンク単位でなくファイル単位で除く
  const entryCss = new Set(
    [...staticOfEntry].flatMap((file) => [...(chunkOf(file)?.viteMetadata?.importedCss ?? [])]),
  );
  const css = [
    ...new Set(files.flatMap((file) => [...(chunkOf(file)?.viteMetadata?.importedCss ?? [])])),
  ].filter((file) => !entryCss.has(file));
  return { js, css };
}

export function preloadDynamicMain(): Plugin {
  let base = '/';
  return {
    name: 'aoiko-preload-dynamic-main',
    apply: 'build',
    configResolved(config) {
      base = config.base;
    },
    transformIndexHtml: {
      order: 'post',
      handler(_html, ctx) {
        if (!ctx.bundle || !ctx.chunk) {
          throw new Error('transformIndexHtml に bundle / chunk が渡されていない');
        }
        // エントリの動的 import が main の依存を Vite の HTML preload から隠すので、ここで補う（初回表示が 1 往復遅れる）
        const { js, css } = dynamicMainPreloads(ctx.bundle, ctx.chunk, '/src/main.ts');
        const tags: HtmlTagDescriptor[] = [
          ...js.map((file) => ({
            tag: 'link',
            attrs: { rel: 'modulepreload', crossorigin: true, href: base + file },
            injectTo: 'head' as const,
          })),
          ...css.map((file) => ({
            tag: 'link',
            attrs: { rel: 'stylesheet', crossorigin: true, href: base + file },
            injectTo: 'head' as const,
          })),
        ];
        return tags;
      },
    },
  };
}
