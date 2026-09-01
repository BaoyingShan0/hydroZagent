const fs = require('node:fs');
const path = require('node:path');
const sharp = require('sharp');
const { Icns, IcnsImage } = require('@fiahfy/icns');
const pngToIcoModule = require('png-to-ico');
const pngToIco = pngToIcoModule.default ?? pngToIcoModule;

// 品牌统一：所有图标与应用内品牌标都源自同一枚浙水智能体主标（swoosh + 小机器人）。
// 主标是横版透明 PNG；小尺寸方形图标里直接铺满会糊、透明浅色部分在浅底上会发虚，
// 因此统一「白底圆角整标」构图：裁掉透明边 → 居中缩放 → 白底方块 → 圆角遮罩。
const master = path.join(__dirname, '..', 'build', 'brand', 'logo.png');
if (!fs.existsSync(master)) {
  throw new Error(`missing brand master ${master}; put the HydroZagent logo there first`);
}

const out = path.join(__dirname, '..', 'build');
const iconsDir = path.join(out, 'icons');
const rendererAssets = path.join(__dirname, '..', 'src', 'renderer', 'src', 'assets');
const rendererBrand = path.join(rendererAssets, 'brand');
const pngSizes = [16, 24, 32, 48, 64, 128, 256, 512, 1024];
const icnsSources = [
  [16, 'icp4'],
  [32, 'icp5'],
  [32, 'ic11'],
  [64, 'icp6'],
  [64, 'ic12'],
  [128, 'ic07'],
  [256, 'ic08'],
  [256, 'ic13'],
  [512, 'ic09'],
  [512, 'ic14'],
  [1024, 'ic10'],
];

// 裁掉主标四周透明边，避免居中时被大片透明留白挤小。缓存一次，全尺寸复用。
let trimmedLogoPromise = null;
function trimmedLogo() {
  trimmedLogoPromise ??= sharp(master)
    .ensureAlpha()
    .trim({ threshold: 12 })
    .toBuffer({ resolveWithObject: true });
  return trimmedLogoPromise;
}

/**
 * 白底方形品牌标。
 * @param size 输出边长
 * @param rounded 是否烘焙圆角（系统图标要，渲染层交给 CSS rounded-* 不烘焙）
 * @param contentRatio 主标内容占方块的比例（图标留白多一点更像 app icon，内联标铺满一点）
 */
async function buildTile(size, { rounded, contentRatio }) {
  const { data, info } = await trimmedLogo();
  const box = Math.max(1, Math.round(size * contentRatio));
  const scale = Math.min(box / info.width, box / info.height);
  const w = Math.max(1, Math.round(info.width * scale));
  const h = Math.max(1, Math.round(info.height * scale));
  const logo = await sharp(data).resize(w, h).png().toBuffer();

  let tile = await sharp({
    create: {
      width: size,
      height: size,
      channels: 4,
      background: { r: 255, g: 255, b: 255, alpha: 1 },
    },
  })
    .composite([
      {
        input: logo,
        left: Math.round((size - w) / 2),
        top: Math.round((size - h) / 2),
      },
    ])
    .png()
    .toBuffer();

  if (rounded) {
    const radius = Math.round(size * 0.22);
    const mask = Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><rect width="${size}" height="${size}" rx="${radius}" ry="${radius}" fill="#fff"/></svg>`,
    );
    tile = await sharp(tile).composite([{ input: mask, blend: 'dest-in' }]).png().toBuffer();
  }

  return tile;
}

async function writeIcns(target) {
  const icns = new Icns();
  for (const [size, osType] of icnsSources) {
    const file = path.join(iconsDir, `${size}x${size}.png`);
    const buffer = await fs.promises.readFile(file);
    icns.append(IcnsImage.fromPNG(buffer, osType));
  }
  await fs.promises.writeFile(target, icns.data);

  const header = await fs.promises.readFile(target, { encoding: null });
  if (header.subarray(0, 4).toString('ascii') !== 'icns') {
    throw new Error('generated icon.icns is invalid: missing icns file header');
  }
}

async function main() {
  fs.mkdirSync(iconsDir, { recursive: true });
  fs.mkdirSync(rendererBrand, { recursive: true });

  // 系统图标：白底圆角整标，多尺寸 PNG + Windows .ico + macOS .icns。
  await Promise.all(
    pngSizes.map(async size => {
      const tile = await buildTile(size, { rounded: true, contentRatio: 0.78 });
      await fs.promises.writeFile(path.join(iconsDir, `${size}x${size}.png`), tile);
    }),
  );

  await fs.promises.copyFile(path.join(iconsDir, '512x512.png'), path.join(out, 'icon.png'));
  const ico = await pngToIco([16, 24, 32, 48, 64, 128, 256].map(size => path.join(iconsDir, `${size}x${size}.png`)));
  await fs.promises.writeFile(path.join(out, 'icon.ico'), ico);
  await writeIcns(path.join(out, 'icon.icns'));

  // 应用内小尺寸品牌标（侧栏/空态/来源徽章）：白底方块，圆角交给 CSS，主标铺满多一点。
  const brandMark = await buildTile(256, { rounded: false, contentRatio: 0.86 });
  await fs.promises.writeFile(path.join(rendererAssets, 'brand-mark.png'), brandMark);

  // 大尺寸品牌区（启动页/新会话页）直接用透明主标，铺在各自水墨背景上。
  await fs.promises.copyFile(master, path.join(rendererBrand, 'hydrozagent-logo.png'));

  console.log(
    'wrote build/icon.png, build/icon.ico, build/icon.icns, build/icons/*.png, ' +
      'src/renderer/src/assets/brand-mark.png and src/renderer/src/assets/brand/hydrozagent-logo.png',
  );
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
