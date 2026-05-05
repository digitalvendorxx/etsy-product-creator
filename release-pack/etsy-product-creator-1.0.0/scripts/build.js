const esbuild = require('esbuild');
const path = require('path');

const root = path.resolve(__dirname, '..');

const external = [
  'better-sqlite3',
  'sharp',
  'playwright',
  '@ffmpeg-installer/ffmpeg',
  '@imgly/background-removal-node',
  'bcryptjs',
  'dotenv',
];

async function build() {
  await esbuild.build({
    entryPoints: [
      path.join(root, 'server.js'),
      path.join(root, 'create.js'),
    ],
    outdir: path.join(root, 'dist'),
    entryNames: '[name]',
    bundle: true,
    platform: 'node',
    target: 'node18',
    format: 'cjs',
    minify: true,
    treeShaking: true,
    legalComments: 'none',
    sourcemap: false,
    external,
    banner: {
      js: '// flowiqa.com - etsy-product-creator (bundled)',
    },
  });
}

build().catch((err) => {
  console.error(err);
  process.exit(1);
});
