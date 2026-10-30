import {InferenceSession, Tensor} from 'onnxruntime-react-native';

import type {
  OrtAdapter,
  OrtSessionLike,
  OrtTensorData,
  OrtTensorLike,
} from './gsvPipeline';

function wrap(t: Tensor): OrtTensorLike {
  return {data: t.data as OrtTensorData, dims: t.dims as readonly number[]};
}

/**
 * onnxruntime-react-native binding for the GSV pipeline.
 *
 * Models are loaded from absolute file paths under the app documents dir
 * (same pattern as the super-res service). CPU execution provider only —
 * NNAPI silently produces wrong outputs for these graphs.
 */
export const rnOrtAdapter: OrtAdapter = {
  createSession: async (path: string) => {
    const session = await InferenceSession.create(path, {
      executionProviders: ['cpu'],
    });
    const inputTypes: Record<string, string> = {};
    for (const meta of session.inputMetadata) {
      // ValueMetadata is a union; tensor members carry the type string
      inputTypes[meta.name] = 'type' in meta ? (meta.type as string) : '';
    }
    const like: OrtSessionLike = {
      inputNames: session.inputNames,
      outputNames: session.outputNames,
      inputTypes,
      run: async feeds => {
        const map: Record<string, Tensor> = {};
        for (const [k, v] of Object.entries(feeds)) {
          const type =
            v.data instanceof Float32Array
              ? 'float32'
              : v.data instanceof Uint16Array
                ? 'float16'
                : v.data instanceof BigInt64Array
                  ? 'int64'
                  : 'int32';
          map[k] = new Tensor(type, v.data as never, v.dims as never);
        }
        const out = await session.run(map);
        const wrapped: Record<string, OrtTensorLike> = {};
        for (const [k, v] of Object.entries(out)) {
          wrapped[k] = wrap(v);
        }
        return wrapped;
      },
      release: () => session.release(),
    };
    return like;
  },
  tensorFloat32: (data, dims) => ({data, dims}),
  tensorFloat16: (data, dims) => ({data, dims}),
  tensorInt64: (data, dims) => ({data, dims}),
};
