// See: https://rollupjs.org/introduction/

import commonjs from '@rollup/plugin-commonjs'
import nodeResolve from '@rollup/plugin-node-resolve'
import typescript from '@rollup/plugin-typescript'

const config = [
  {
    input: 'src/experiment/index.ts',
    output: {
      esModule: true,
      file: 'dist/experiment/index.js',
      format: 'es',
      sourcemap: true
    },
    plugins: [typescript(), nodeResolve({ preferBuiltins: true }), commonjs()]
  },
  {
    input: 'src/custom-action-example/index.ts',
    output: {
      esModule: true,
      file: 'dist/custom-action-example/index.js',
      format: 'es',
      sourcemap: true
    },
    plugins: [typescript(), nodeResolve({ preferBuiltins: true }), commonjs()]
  }
]

export default config
