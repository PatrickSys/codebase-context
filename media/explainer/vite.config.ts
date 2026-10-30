import ffmpegImport from '@motion-canvas/ffmpeg';
import motionCanvasImport from '@motion-canvas/vite-plugin';
import {defineConfig, type PluginOption} from 'vite';

function pluginFactory(mod: unknown): () => PluginOption {
  if (typeof mod === 'function') {
    return mod as () => PluginOption;
  }
  if (mod && typeof mod === 'object' && 'default' in mod) {
    const nested = (mod as {default: unknown}).default;
    if (typeof nested === 'function') {
      return nested as () => PluginOption;
    }
  }
  throw new Error('Motion Canvas plugin export was not a function');
}

export default defineConfig({
  plugins: [pluginFactory(motionCanvasImport)(), pluginFactory(ffmpegImport)()],
});
